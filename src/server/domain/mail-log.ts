/**
 * Salary-slip e-mails with a delivery log.
 *  - Publishing a slip only QUEUES a row in Mail_Log (status Pending) inside the same save, so a slip and its mail never get out of step.
 *  - One row per slip VERSION (dedupeKey = slip + a fingerprint of its figures): publishing again, regenerating a draft with the same figures,
 *    retrying a request or running the scheduler twice never mails the same slip twice. A corrected slip (different figures) is a new version and is mailed.
 *  - Sending claims the row first (Sending), so two runs at the same moment do not both send it. A claim older than CLAIM_MINUTES is treated as lost.
 *  - A failure keeps the row (Failed) with the reason and tries again later (15 min, 1 h, 4 h, 12 h, 24 h — then it stops and waits for a person to press Retry).
 *  - No salary figure is kept in the log: the document is built from the slip at the moment of sending.
 *  - The mail carries a private link (/api/slip/<id>) that only opens after sign-in as that employee (or payroll), and — unless PAY_EMAIL_ATTACH=N — the slip as an attachment.
 */
import { createHash } from "node:crypto";
import { fmtMonth } from "../../lib/dates.ts";
import { slipHtml, type SlipDoc } from "../../lib/slip-html.ts";
import { forbid, newId, pub, require_, type Db, type Rec } from "../sheets/db.ts";
import { Ctx, makeCtx } from "./ctx.ts";
import type { DeliveryConfig } from "./notify.ts";
import { addMinutes, minutesBetween } from "./time.ts";
import { runsPayrollFor, slipDoc } from "./payroll.ts";

export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [15, 60, 240, 720, 1440];
const CLAIM_MINUTES = 10;
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** The same figures give the same fingerprint, whatever happens around them (regenerating, republishing, retrying). */
export const slipFingerprint = (s: Rec): string =>
  createHash("sha1").update([s.userId, s.period, s.gross, s.totalDeductions, s.net, s.daysPaid ?? "", s.earningsJson, s.deductionsJson].join("|")).digest("hex").slice(0, 12);

export interface MailSender { sendMail(m: { from?: string; to: string; subject: string; text: string; html?: string; attachments?: { filename: string; content: string; contentType: string }[] }): Promise<unknown> }
let mailer: { url: string; t: MailSender } | null = null;
let override: MailSender | null = null;
/** tests only: send through this instead of a real SMTP server */
export function setMailTransport(t: MailSender | null) { override = t; }
async function transport(cfg: DeliveryConfig): Promise<MailSender> {
  if (override) return override;
  if (!mailer || mailer.url !== cfg.smtpUrl) { const nm = await import("nodemailer"); mailer = { url: String(cfg.smtpUrl), t: nm.createTransport(cfg.smtpUrl) as unknown as MailSender }; }
  return mailer.t;
}
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

/** Queue the mail for a slip that has just been published. Returns the log row to send now, or null when this version is already queued / sent (no duplicate). */
export async function queueSlipMail(ctx: Ctx, s: Rec, opts: { resend?: boolean } = {}): Promise<Rec | null> {
  if (ctx.setting("PAY_EMAIL_SLIPS", "Y") === "N") return null;
  const key = `slip|${s.slipId}|${slipFingerprint(s)}`;
  const log = await ctx.tx.rows("Mail_Log");
  const same = log.find((m) => m.dedupeKey === key);
  if (same && !opts.resend) {
    if (same.status === "Failed" || same.status === "Cancelled") { // not delivered yet: put it back in line, now
      if (same.status === "Cancelled") same.attempts = 0;
      same.status = "Pending"; same.nextTry = ctx.clock.dt; same.lastError = "";
      return same;
    }
    return null; // Pending, Sending or Sent — it is already on its way / delivered
  }
  const user = await ctx.user(String(s.userId));
  const rec = ctx.tx.insert("Mail_Log", {
    mailId: newId("MAL"), kind: "salary_slip", refId: String(s.slipId), dedupeKey: opts.resend ? `${key}|resend|${ctx.clock.stamp}` : key, userId: String(s.userId), toEmail: String(user?.email ?? ""),
    subject: `[${ctx.setting("COMPANY_NAME", "MIDAP")}] Your salary slip for ${fmtMonth(String(s.period))}`, status: "Pending", attempts: 0, lastError: "", nextTry: ctx.clock.dt, claimedAt: "", createdAt: ctx.clock.stamp, sentAt: "", createdBy: ctx.actorId,
  });
  return rec;
}

/** A slip taken back to draft, or removed: whatever was waiting to be mailed for it is cancelled (what was already sent stays in the log). */
export async function cancelSlipMails(ctx: Ctx, slipId: string) {
  for (const m of await ctx.tx.rows("Mail_Log")) if (m.refId === slipId && (m.status === "Pending" || m.status === "Failed")) { m.status = "Cancelled"; m.lastError = "Slip was taken back to draft or removed"; }
}

export interface MailRun { sent: number; failed: number; waiting: number; notes: string[] }

/**
 * Send what is due. `ids` limits it to those rows (and sends them even if their retry time has not come — used right after publishing / by the Retry button).
 * Without ids it is the scheduler's retry pass: only rows whose time has come and that are under the attempt limit.
 */
let queueChain: Promise<unknown> = Promise.resolve();
/** Runs one after the other inside this server, so two runs at the same moment never pick the same row. (Several servers at once rely on the claim below.) */
export function processMailQueue(db: Db, cfg: DeliveryConfig, opts: { ids?: string[]; now?: Date } = {}): Promise<MailRun> {
  const next = queueChain.then(() => processNow(db, cfg, opts));
  queueChain = next.catch(() => undefined);
  return next;
}

async function processNow(db: Db, cfg: DeliveryConfig, opts: { ids?: string[]; now?: Date }): Promise<MailRun> {
  const run: MailRun = { sent: 0, failed: 0, waiting: 0, notes: [] };
  // phase 1 — pick the rows and claim them (saved before anything is sent)
  const pick = await makeCtx(db, "cron", opts.now);
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const claimed: string[] = [];
  for (const m of await pick.tx.rows("Mail_Log")) {
    if (wanted && !wanted.has(String(m.mailId))) continue;
    const st = String(m.status);
    const stuck = st === "Sending" && minutesBetween(String(m.claimedAt).slice(0, 16), pick.clock.dt) >= CLAIM_MINUTES;
    if (!(st === "Pending" || st === "Failed" || stuck)) continue;
    if (!wanted && (Number(m.attempts) >= MAX_ATTEMPTS || (m.nextTry && String(m.nextTry) > pick.clock.dt))) continue;
    if (!cfg.smtpUrl) { run.waiting++; m.lastError = "E-mail is not set up on this server (SMTP_URL) — the mail waits here and goes out once it is"; continue; }
    m.status = "Sending"; m.claimedAt = pick.clock.stamp; claimed.push(String(m.mailId));
  }
  await pick.tx.commit();
  if (run.waiting) run.notes.push("E-mail is not set up on this server (SMTP_URL), so nothing was e-mailed — people can still download their slips in the app.");
  if (!claimed.length) return run;

  // phase 2 — send, one by one
  const ctx = await makeCtx(db, "cron", opts.now);
  const { Users } = await db.load(["Users"]);
  const byId = new Map(Users.map((u) => [String(u.userId), u]));
  for (const m of await ctx.tx.rows("Mail_Log")) {
    if (!claimed.includes(String(m.mailId))) continue;
    const fail = (why: string, final = false) => { m.status = "Failed"; m.attempts = Number(m.attempts) + 1; m.lastError = why.slice(0, 300); m.claimedAt = ""; m.nextTry = final || Number(m.attempts) >= MAX_ATTEMPTS ? "" : addMinutes(ctx.clock.dt, BACKOFF_MIN[Math.min(Number(m.attempts) - 1, BACKOFF_MIN.length - 1)]); run.failed++; };
    const slip = alive(await ctx.tx.rows("Salary_Slips")).find((x) => x.slipId === m.refId);
    if (!slip || slip.status !== "Published") { m.status = "Cancelled"; m.claimedAt = ""; m.lastError = "Slip is not published any more"; continue; }
    const u = byId.get(String(m.userId));
    if (!u || !u.email) { fail(`${u?.name ?? m.userId} has no e-mail address — add it in their profile, then press Retry`, true); run.notes.push(`${u?.name ?? m.userId} has no e-mail address, so their slip was not e-mailed`); continue; }
    try {
      const doc = (await slipDoc(ctx, slip)) as unknown as SlipDoc & { employee: { name: string } };
      const name = String(doc.employee.name), month = fmtMonth(String(slip.period));
      const link = cfg.appUrl ? `${cfg.appUrl}/api/slip/${slip.slipId}` : "";
      const attach = ctx.setting("PAY_EMAIL_ATTACH", "Y") !== "N";
      const text = `Dear ${name},\n\nYour salary slip for ${month} is ready.${attach ? " It is attached (open the file, then print / save as PDF)." : ""}${link ? `\nYou can also open it here after signing in: ${link}` : "\nYou can also download it in the app: Attendance → Salary slips."}\n\nThis is a private message — please do not forward it.`;
      const html = attach ? slipHtml(doc) : "";
      const body = `<p>Dear ${name.replace(/[<>&]/g, "")},</p><p>Your salary slip for <b>${month}</b> is ready.${attach ? " It is attached to this e-mail (open the file, then print or save as PDF)." : ""}</p>${link ? `<p><a href="${link}">Open it in the app</a> (you will be asked to sign in as yourself)</p>` : "<p>You can download it in the app under Attendance → Salary slips.</p>"}<p style="color:#697386;font-size:12px">This is a private message — please do not forward it.</p>`;
      await withTimeout((await transport(cfg)).sendMail({ from: cfg.mailFrom, to: String(u.email), subject: String(m.subject), text, html: body, attachments: attach ? [{ filename: `salary-slip-${slip.period}.html`, content: html, contentType: "text/html; charset=utf-8" }] : [] }), 20000, "e-mail");
      m.status = "Sent"; m.attempts = Number(m.attempts) + 1; m.sentAt = ctx.clock.stamp; m.lastError = ""; m.claimedAt = ""; m.nextTry = ""; m.toEmail = String(u.email);
      slip.emailedAt = ctx.clock.stamp; run.sent++;
    } catch (e) { fail(e instanceof Error ? e.message : String(e)); run.notes.push(`e-mail to ${u.name}: ${e instanceof Error ? e.message : e}`); }
  }
  ctx.tx.audit("Salary slip e-mails sent", "Mail_Log", "", null, { sent: run.sent, failed: run.failed });
  await ctx.tx.commit();
  return run;
}

// ------------------------------------------------------------------------------------------------ actions (payroll people)

/** The delivery log, for the people payroll may see. */
export async function listMailLog(ctx: Ctx, d: Record<string, unknown>) {
  forbid(["create", "edit", "approve", "manage", "import"].some((a) => ctx.allow("payroll", a as never)), "You cannot see the salary e-mail log"); // payroll people only — an employee's own "view" is not enough
  const reach = await ctx.reach("payroll");
  const period = str(d.period), status = str(d.status);
  const slips = new Map(alive(await ctx.tx.rows("Salary_Slips")).map((s) => [String(s.slipId), s]));
  const users = new Map((await ctx.tx.rows("Users")).map((u) => [String(u.userId), u]));
  const rows = (await ctx.tx.rows("Mail_Log")).filter((m) => (reach.all || reach.ids.has(String(m.userId))) && (!status || m.status === status) && (!period || slips.get(String(m.refId))?.period === period))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300);
  const counts: Record<string, number> = {};
  for (const m of rows) counts[String(m.status)] = (counts[String(m.status)] ?? 0) + 1;
  return { mails: rows.map((m) => ({ ...pub("Mail_Log", m), name: String(users.get(String(m.userId))?.name ?? ""), period: String(slips.get(String(m.refId))?.period ?? ""), maxAttempts: MAX_ATTEMPTS })), counts };
}

/** Put failed / waiting mails back in line (Retry button). Sending itself happens right after the save. */
export async function retryMails(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "approve", "Only people who may publish salary slips can retry the e-mails");
  const ids = new Set((Array.isArray(d.mailIds) ? d.mailIds : []).map(str).filter(Boolean));
  const reach = await ctx.reach("payroll");
  let queued = 0;
  for (const m of await ctx.tx.rows("Mail_Log")) {
    if (ids.size ? !ids.has(String(m.mailId)) : !(m.status === "Failed" || m.status === "Pending")) continue;
    if (!(reach.all || reach.ids.has(String(m.userId)))) continue;
    if (m.status !== "Failed" && m.status !== "Pending") continue;
    m.status = "Pending"; m.attempts = 0; m.nextTry = ctx.clock.dt; m.lastError = ""; ctx.mailIds.push(String(m.mailId)); queued++;
  }
  ctx.tx.audit("Salary e-mails retried", "Mail_Log", "", null, { queued });
  return { queued };
}

/** Send a published slip again on purpose (the employee lost it). Not blocked by the duplicate rule, because a person asked for it. */
export async function resendSlipMail(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "approve", "Only people who may publish salary slips can send them again");
  const s = alive(await ctx.tx.rows("Salary_Slips")).find((x) => x.slipId === str(d.slipId));
  forbid(s && (await runsPayrollFor(ctx, String(s.userId))), "You cannot send this salary slip");
  require_(s!.status === "Published", "Only a published slip can be e-mailed");
  const m = await queueSlipMail(ctx, s!, { resend: true });
  require_(m, "E-mailing salary slips is switched off in Settings (PAY_EMAIL_SLIPS)");
  ctx.mailIds.push(String(m!.mailId));
  ctx.tx.audit("Salary slip e-mailed again", "Salary_Slips", String(s!.slipId), null, { employee: s!.userId, period: s!.period });
  return { queued: 1 };
}
