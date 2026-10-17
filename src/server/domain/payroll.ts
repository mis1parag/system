/**
 * Salary slips. A slip is shown to its owner only once it is Published; payroll people (module "payroll") prepare and publish them for the people in their reach.
 * Nothing here trusts the screen: every action looks at the slip itself — is it yours, or are you payroll for that person?
 * Reporting managers get nothing from the reporting line alone.
 */
import { allows, reachOf, scopeOfGrant } from "../../lib/permissions.ts";
import { fail, forbid, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");
const money = (n: number) => Math.round(n * 100) / 100;
export const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p) && Number(p.slice(0, 4)) >= 2000;
const DENIED = "You cannot open this salary slip";

type Line = { label: string; amount: number };
function lines(v: unknown, what: string): Line[] {
  const list = Array.isArray(v) ? v : [];
  require_(list.length <= 25, `Too many ${what} lines (25 at most)`);
  const out: Line[] = [];
  for (const x of list as { label?: unknown; amount?: unknown }[]) {
    const label = str(x?.label).slice(0, 40), raw = str(x?.amount);
    if (raw === "") continue; // a row left empty on the form (the suggested names stay, the amount was not filled)
    const amount = Number(raw.replace(/,/g, ""));
    require_(label, `Name each ${what} line (for example Basic)`);
    require_(!isNaN(amount) && amount >= 0 && amount < 1e9, `"${label}": enter the amount as a number (0 or more)`);
    out.push({ label, amount: money(amount) });
  }
  return out;
}
const parseLines = (json: unknown): Line[] => { try { const v = JSON.parse(String(json || "[]")); return Array.isArray(v) ? v : []; } catch { return []; } };

/** The whole slip as the person it belongs to (or payroll) sees it. */
function view(s: Rec) {
  return { ...pub("Salary_Slips", s), earnings: parseLines(s.earningsJson), deductions: parseLines(s.deductionsJson) };
}

/** Are you payroll for this person? Needs a payroll right beyond "view own", and the person inside your payroll reach. */
async function runsPayrollFor(ctx: Ctx, userId: string): Promise<boolean> {
  if (ctx.isSuper) return true;
  if (userId === ctx.actorId) return false;
  if (!["create", "edit", "approve", "manage", "import", "view"].some((a) => ctx.allow("payroll", a as never))) return false;
  const r = await ctx.reach("payroll");
  return r.all || r.ids.has(userId);
}
const preparesFor = async (ctx: Ctx, userId: string) => (await runsPayrollFor(ctx, userId)) && (ctx.isSuper || ["create", "edit", "approve", "manage", "import"].some((a) => ctx.allow("payroll", a as never)));

/** Slips you may see: your own published ones, and — if you run payroll — those of the people in your payroll reach (drafts only when you may prepare them). */
export async function listSlips(ctx: Ctx, d: Record<string, unknown>) {
  const period = str(d.period), year = str(d.year), wanted = str(d.userId);
  const prepare = ctx.isSuper || ["create", "edit", "approve", "manage", "import"].some((a) => ctx.allow("payroll", a as never));
  const reach = await ctx.reach("payroll");
  if (wanted && wanted !== ctx.actorId) forbid(await runsPayrollFor(ctx, wanted), DENIED);
  const wide = d.everyone === true;
  const rows = alive(await ctx.tx.rows("Salary_Slips")).filter((s) => {
    const mine = s.userId === ctx.actorId;
    if (wanted) { if (s.userId !== wanted) return false; }
    else if (wide) { if (!(reach.all || reach.ids.has(String(s.userId)))) return false; }
    else if (!mine) return false;
    // a draft is never for the employee; payroll people who prepare slips see drafts of others
    if (s.status !== "Published" && !ctx.isSuper && (mine || !prepare)) return false;
    return (!period || s.period === period) && (!year || String(s.period).slice(0, 4) === year);
  }).sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(a.userId).localeCompare(String(b.userId)));
  return { slips: rows.slice(0, 600).map(view), canPrepare: prepare, wide: wide || !!wanted };
}

/** Open one slip. The first time the employee opens it is remembered (and the opening of anyone else's slip is written to the activity log). */
export async function getSlip(ctx: Ctx, d: Record<string, unknown>) {
  const s = alive(await ctx.tx.rows("Salary_Slips")).find((x) => x.slipId === str(d.slipId));
  forbid(s, DENIED); // a wrong id and a slip that is not yours look the same
  const mine = s.userId === ctx.actorId;
  if (mine) forbid(s.status === "Published" || ctx.isSuper, DENIED);
  else forbid(await runsPayrollFor(ctx, String(s.userId)), DENIED);
  if (mine && !s.viewedAt && s.status === "Published") s.viewedAt = ctx.clock.stamp;
  if (!mine) ctx.tx.audit("Salary slip opened", "Salary_Slips", String(s.slipId), null, { employee: s.userId, period: s.period });
  const user = await ctx.user(String(s.userId));
  const det = (await ctx.tx.rows("Employee_Details")).find((x) => x.userId === s.userId);
  return { slip: view(s), employee: { userId: s.userId, name: user?.name ?? "", empCode: user?.empCode ?? "", department: user?.department ?? "", designation: det?.designation ?? "", joinDate: det?.joinDate ?? "" }, company: ctx.setting("COMPANY_NAME", "MIDAP") };
}

export async function saveSlip(ctx: Ctx, d: Record<string, unknown>) {
  const id = str(d.slipId);
  ctx.require("payroll", id ? "edit" : "create", "You cannot prepare salary slips");
  const all = await ctx.tx.rows("Salary_Slips");
  const existing = id ? alive(all).find((s) => s.slipId === id) : undefined;
  require_(!id || existing, "Unknown salary slip");
  const userId = existing ? String(existing.userId) : str(d.userId);
  const user = await ctx.user(userId);
  require_(user && user.status === "Active", "Choose the employee");
  forbid(userId !== ctx.actorId || ctx.isSuper, "You cannot prepare your own salary slip");
  forbid(await preparesFor(ctx, userId), "That person is outside your payroll access");
  const period = existing ? String(existing.period) : str(d.period);
  require_(isPeriod(period), "Choose the month (for example 2026-10)");
  const dup = alive(all).find((s) => s.userId === userId && s.period === period && s !== existing);
  require_(!dup, `There is already a salary slip for ${user.name} for ${period}`);
  const earnings = lines(d.earnings, "earnings"), deductions = lines(d.deductions, "deductions");
  require_(earnings.length > 0, "Add at least one earning (for example Basic)");
  const gross = money(earnings.reduce((a, x) => a + x.amount, 0)), ded = money(deductions.reduce((a, x) => a + x.amount, 0));
  require_(ded <= gross, "The deductions are more than the earnings");
  const days = str(d.daysPaid) === "" ? null : Number(d.daysPaid);
  require_(days === null || (!isNaN(days) && days >= 0 && days <= 31), "Days paid must be between 0 and 31");
  if (existing?.status === "Published") ctx.require("payroll", "approve", "A published slip can only be changed by someone who may publish");
  const fields = { daysPaid: days, earningsJson: JSON.stringify(earnings), deductionsJson: JSON.stringify(deductions), gross, totalDeductions: ded, net: money(gross - ded), note: str(d.note).slice(0, 300) };
  let rec: Rec;
  if (existing) {
    const before = { gross: existing.gross, net: existing.net, status: existing.status };
    Object.assign(existing, fields);
    rec = existing;
    ctx.tx.audit("Salary slip edited", "Salary_Slips", String(rec.slipId), before, { gross, net: fields.net, employee: userId, period });
  } else {
    rec = ctx.tx.insert("Salary_Slips", { slipId: newId("SLP"), userId, period, ...fields, status: "Draft", createdBy: ctx.actorId, createdAt: ctx.clock.stamp, publishedBy: "", publishedAt: "", viewedAt: "", deleted: "" });
    ctx.tx.audit("Salary slip prepared", "Salary_Slips", String(rec.slipId), null, { employee: userId, period });
  }
  return view(rec);
}

/** Publish (or take back to draft) slips. Publishing tells the employee — without any amount in the message. */
export async function publishSlips(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "approve", "Only people who may publish salary slips can do this");
  const ids = new Set((Array.isArray(d.slipIds) ? d.slipIds : []).map(str).filter(Boolean));
  require_(ids.size > 0 && ids.size <= 500, "Choose the slips");
  const publish = d.publish !== false;
  let changed = 0;
  for (const s of alive(await ctx.tx.rows("Salary_Slips")).filter((x) => ids.has(String(x.slipId)))) {
    if (!(await preparesFor(ctx, String(s.userId)))) continue; // outside your payroll access: skipped, not an error for the others
    const to = publish ? "Published" : "Draft";
    if (s.status === to) continue;
    s.status = to; changed++;
    if (publish) { for (const q of await ctx.tx.rows("Slip_Requests")) if (q.userId === s.userId && q.period === s.period && q.status === "Pending") { q.status = "Done"; q.handledBy = ctx.actorId; q.handledAt = ctx.clock.stamp; q.reply = "Published"; } }
    if (publish) { s.publishedBy = ctx.actorId; s.publishedAt = ctx.clock.stamp; ctx.notice({ userId: String(s.userId), type: "payroll", title: `Your salary slip for ${s.period} is ready`, body: "Open Salary slips to view or print it.", link: "/flows/attendance?tab=salary" }); }
    else { s.publishedBy = ""; s.publishedAt = ""; s.viewedAt = ""; }
  }
  ctx.tx.audit(publish ? "Salary slips published" : "Salary slips unpublished", "Salary_Slips", "", null, { requested: ids.size, changed });
  return { changed };
}

export async function deleteSlip(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "delete", "You cannot delete salary slips");
  const s = alive(await ctx.tx.rows("Salary_Slips")).find((x) => x.slipId === str(d.slipId));
  require_(s, "Unknown salary slip");
  forbid(await preparesFor(ctx, String(s.userId)), "That person is outside your payroll access");
  require_(s.status !== "Published" || ctx.allow("payroll", "approve"), "A published slip can only be deleted by someone who may publish");
  s.deleted = "Y";
  ctx.tx.audit("Salary slip deleted", "Salary_Slips", String(s.slipId), { employee: s.userId, period: s.period, status: s.status }, null);
  return { slipId: s.slipId };
}

/** Prepare many drafts at once. Rows: { empCode | userId, period, daysPaid, earnings:[{label,amount}], deductions:[{label,amount}] } — an existing slip is not overwritten. */
export async function importSlips(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "import", "You cannot import salary slips");
  const input = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  require_(input.length > 0 && input.length <= 500, "Import between 1 and 500 rows");
  const users = (await ctx.tx.rows("Users")).filter((u) => u.status === "Active");
  const all = await ctx.tx.rows("Salary_Slips");
  const have = new Set(alive(all).map((s) => `${s.userId}|${s.period}`));
  let added = 0; const problems: string[] = [];
  for (const [i, r] of input.entries()) {
    try {
      const u = users.find((x) => (str(r.userId) && x.userId === str(r.userId)) || (str(r.empCode) && String(x.empCode).toLowerCase() === str(r.empCode).toLowerCase()));
      require_(u, `row ${i + 1}: no active person with that Employee ID`);
      const userId = String(u.userId), period = str(r.period);
      require_(isPeriod(period), `row ${i + 1}: month must look like 2026-10`);
      forbid(userId !== ctx.actorId || ctx.isSuper, `row ${i + 1}: you cannot prepare your own slip`);
      forbid(await preparesFor(ctx, userId), `row ${i + 1}: ${u.name} is outside your payroll access`);
      require_(!have.has(`${userId}|${period}`), `row ${i + 1}: ${u.name} already has a slip for ${period}`);
      const earnings = lines(r.earnings, "earnings"), deductions = lines(r.deductions, "deductions");
      require_(earnings.length > 0, `row ${i + 1}: no earnings`);
      const gross = money(earnings.reduce((a, x) => a + x.amount, 0)), ded = money(deductions.reduce((a, x) => a + x.amount, 0));
      require_(ded <= gross, `row ${i + 1}: deductions are more than the earnings`);
      have.add(`${userId}|${period}`);
      ctx.tx.insert("Salary_Slips", { slipId: newId("SLP"), userId, period, daysPaid: str(r.daysPaid) === "" ? null : Number(r.daysPaid), earningsJson: JSON.stringify(earnings), deductionsJson: JSON.stringify(deductions), gross, totalDeductions: ded, net: money(gross - ded), note: str(r.note).slice(0, 300), status: "Draft", createdBy: ctx.actorId, createdAt: ctx.clock.stamp, publishedBy: "", publishedAt: "", viewedAt: "", deleted: "" });
      added++;
    } catch (e) { if (problems.length < 8) problems.push(e instanceof Error ? e.message : String(e)); }
  }
  ctx.tx.audit("Salary slips imported", "Salary_Slips", "", null, { added, problems: problems.length });
  if (!added && problems.length) fail("VALIDATION", problems[0]);
  return { added, problems };
}

// ---------------- "please send me my salary slip" ----------------

/** The people who prepare slips for this person: the Super Admin and everyone with a payroll right whose payroll reach includes them. */
async function payrollPeopleFor(ctx: Ctx, userId: string): Promise<string[]> {
  const users = await ctx.tx.rows("Users");
  const out: string[] = [];
  for (const u of users.filter((x) => x.status === "Active" && x.deleted !== "Y" && x.userId !== userId)) {
    if (u.role === "SUPER_ADMIN") { out.push(String(u.userId)); continue; }
    const perms = ctx.permsOf(u);
    if (!["create", "edit", "approve", "manage"].some((a) => allows(perms, "payroll", a as never))) continue;
    const r = reachOf({ userId: String(u.userId), role: String(u.role), department: String(u.department ?? "") }, users as never, scopeOfGrant(perms, "payroll"));
    if (r.all || r.ids.has(userId)) out.push(String(u.userId));
  }
  return out;
}

export async function requestSlip(ctx: Ctx, d: Record<string, unknown>) {
  const period = str(d.period);
  require_(isPeriod(period), "Choose the month");
  require_(period <= ctx.clock.date.slice(0, 7), "That month has not come yet");
  const have = alive(await ctx.tx.rows("Salary_Slips")).some((s) => s.userId === ctx.actorId && s.period === period && s.status === "Published");
  require_(!have, "Your slip for that month is already there — open it from the list");
  const reqs = await ctx.tx.rows("Slip_Requests");
  require_(!reqs.some((q) => q.userId === ctx.actorId && q.period === period && q.status === "Pending"), "You have already asked for that month");
  const q = ctx.tx.insert("Slip_Requests", { reqId: newId("SRQ"), userId: ctx.actorId, period, note: str(d.note).slice(0, 200), status: "Pending", createdAt: ctx.clock.stamp, handledBy: "", handledAt: "", reply: "" });
  ctx.tx.audit("Salary slip requested", "Slip_Requests", String(q.reqId), null, { period });
  for (const p of await payrollPeopleFor(ctx, ctx.actorId)) ctx.notice({ userId: p, type: "payroll", title: `${ctx.actor.name} asks for the salary slip of ${period}`, body: str(d.note).slice(0, 120), link: "/flows/attendance?tab=salary" });
  return pub("Slip_Requests", q);
}

/** Mine: everything I asked. Payroll people also get the waiting requests of the people in their payroll reach. */
export async function listSlipRequests(ctx: Ctx) {
  const reach = await ctx.reach("payroll");
  const prepares = ctx.isSuper || ["create", "edit", "approve", "manage"].some((a) => ctx.allow("payroll", a as never));
  const rows = (await ctx.tx.rows("Slip_Requests")).filter((q) => q.userId === ctx.actorId || (prepares && q.userId !== ctx.actorId && (reach.all || reach.ids.has(String(q.userId)))))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200);
  return { requests: rows.map((q) => pub("Slip_Requests", q)) };
}

export async function declineSlipRequest(ctx: Ctx, d: Record<string, unknown>) {
  const q = (await ctx.tx.rows("Slip_Requests")).find((x) => x.reqId === str(d.reqId));
  require_(q && q.status === "Pending", "That request is not waiting any more");
  forbid(await preparesFor(ctx, String(q.userId)), "That person is outside your payroll access");
  require_(str(d.reply), "Write a short reason for the person");
  q.status = "Declined"; q.handledBy = ctx.actorId; q.handledAt = ctx.clock.stamp; q.reply = str(d.reply).slice(0, 200);
  ctx.tx.audit("Salary slip request declined", "Slip_Requests", String(q.reqId), null, { period: q.period });
  ctx.notice({ userId: String(q.userId), type: "payroll", title: `Your salary slip request for ${q.period}: not available`, body: String(q.reply), link: "/flows/attendance?tab=salary" });
  return pub("Slip_Requests", q);
}
