/** Things that are not user actions: first-time setup, the scheduler tick, and the Google-Form intake. */
import type { Flow } from "../../lib/flow-types.ts";
import { Db, MidapError, newId, require_ } from "./../sheets/db.ts";
import { hashPin } from "./auth.ts";
import { loadSettings, makeCtx } from "./ctx.ts";
import { processMailQueue } from "./mail-log.ts";
import { tick, type TickResult } from "./cron.ts";
import { addEntries } from "./entries.ts";
import { deliver, deliveryFromEnv, type DeliveryConfig } from "./notify.ts";
import { clockNow } from "./time.ts";

const digits10 = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; };

export async function setupStatus(db: Db): Promise<{ ready: boolean; hasUsers: boolean }> {
  try {
    const tabs = await db.client.listTabs();
    if (!tabs.some((t) => t.title === "Users")) return { ready: true, hasUsers: false };
    const { Users } = await db.load(["Users"], { fresh: true });
    return { ready: true, hasUsers: Users.length > 0 };
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Create the tabs and the first Super Admin. Refuses to run when users already exist. */
export async function runSetup(db: Db, d: { name: string; mobile: string; email?: string; pin: string; demo?: boolean }) {
  const st = await setupStatus(db);
  if (st.hasUsers) throw new MidapError("FORBIDDEN", "Setup is already done.");
  require_(String(d.name || "").trim(), "Name is required");
  require_(digits10(d.mobile).length === 10, "Enter a valid 10-digit mobile number");
  require_(/^\d{4,8}$/.test(String(d.pin || "")), "PIN must be 4-8 digits");
  await db.ensureSchema();
  const clock = clockNow((await loadSettings(db)).TIMEZONE);
  const tx = db.begin("setup");
  tx.stamp = clock.stamp;
  await tx.load("Users");
  const mk = (name: string, role: string, mobile: string, email: string, pin: string, managerId = "") =>
    tx.insert("Users", { userId: newId("USR"), name, role, mobile, email, status: "Active", managerId, notify: "app", pinHash: hashPin(pin), failCount: 0, lockedUntil: "", createdAt: clock.stamp });
  const admin = mk(String(d.name).trim(), "SUPER_ADMIN", digits10(d.mobile), String(d.email || "").toLowerCase(), String(d.pin));
  if (d.demo) {
    const priya = mk("Priya Coordinator", "ADMIN", "9000000009", "priya@example.com", "2222");
    mk("Kunal", "STAFF", "9000000011", "kunal@example.com", "3333", String(priya.userId));
    mk("Nidhi", "STAFF", "9000000012", "nidhi@example.com", "3333", String(priya.userId));
  }
  tx.audit("Setup completed", "Users", String(admin.userId));
  await tx.commit();
  return { userId: String(admin.userId) };
}

/** Run the scheduler once (reminders, overdue alerts, escalations, recurring entries, digest) and send any email / WhatsApp. */
export async function runTick(db: Db, cfg: DeliveryConfig = deliveryFromEnv(), now?: Date): Promise<TickResult & { errors: string[]; mails: { sent: number; failed: number } }> {
  const ctx = await makeCtx(db, "cron", now);
  const result = await tick(ctx);
  await ctx.tx.commit();
  let errors: string[] = [];
  if (ctx.outbox.length) {
    const { Users } = await db.load(["Users"]);
    errors = (await deliver(cfg, ctx.deliverable(Users), Users, ctx.setting("COMPANY_NAME", "MIDAP"))).errors;
  }
  // salary-slip e-mails that are due again (failed earlier, or waiting for e-mail to be set up)
  const mails = await processMailQueue(db, cfg, { now }).catch((e) => ({ sent: 0, failed: 0, waiting: 0, notes: [String(e?.message ?? e)] }));
  errors = errors.concat(mails.notes.filter((n) => !/not set up/.test(n)));
  return { ...result, errors, mails: { sent: mails.sent, failed: mails.failed } };
}

/** Create an entry from outside the app (Google Form, another system). Keys may be field keys or field labels. */
export async function intakeEntry(db: Db, flowId: string, token: string, body: Record<string, unknown>) {
  const flows = (await db.load(["Flows"])).Flows;
  const rec = flows.find((f) => f.flowId === flowId);
  if (!rec || !rec.intakeToken || String(rec.intakeToken) !== token) throw new MidapError("UNAUTHORIZED", "Wrong flow or token");
  const ctx = await makeCtx(db, "intake");
  const { flow } = await ctx.flow(flowId);
  const raw = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const data = mapKeys(flow, raw);
  const { added } = await addEntries(ctx, flowId, [{ data, source: "intake", createdBy: "intake", priority: typeof body.priority === "string" ? body.priority : undefined, tags: typeof body.tags === "string" ? body.tags : undefined }]);
  await ctx.tx.commit();
  return { itemId: String(added[0].itemId), title: String(added[0].title) };
}

function mapKeys(flow: Flow, raw: Record<string, unknown>): Record<string, unknown> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = flow.fields.find((x) => x.key === k) ?? flow.fields.find((x) => norm(x.label) === norm(k));
    if (f) out[f.key] = Array.isArray(v) ? v.join(", ") : v; // Google Forms sends checkbox answers as arrays
  }
  return out;
}
