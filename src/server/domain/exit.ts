/**
 * People leaving the company: record an exit (with the last working day), switch someone off, bring them back, or delete a person who was added by mistake.
 *  · Exit / switch off / reinstate need "Employees · delete" (Admin and Super Admin by default — not Managers) and the person inside your reach.
 *    Only the Super Admin touches Admins and Super Admins; nobody does it to themselves; the last Super Admin cannot go.
 *  · Delete (Super Admin only) is for a person who never did anything in the app. Anyone with history is switched off instead, so old attendance,
 *    work and reports keep their name.
 * A switched-off person cannot sign in (every request re-reads the account), keeps their history, and their open work can be handed to someone.
 */
import { MidapError, fail, forbid, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { addEntries } from "./entries.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
export const EXIT_TYPES = ["Resigned", "Terminated", "Retired", "Contract ended", "Absconded", "Other"] as const;

async function target(ctx: Ctx, id: string): Promise<Rec> {
  ctx.require("employees", "delete", "Only an Admin or the Super Admin can do this");
  const u = (await ctx.tx.rows("Users")).find((x) => x.userId === id && x.deleted !== "Y");
  require_(u, "Unknown person");
  forbid(id !== ctx.actorId, "You cannot do this to your own account");
  await ctx.requireInReach(id, "employees");
  forbid(ctx.isSuper || ["STAFF", "MANAGER"].includes(String(u.role)), "Only the Super Admin can do this to an Admin or the Super Admin");
  return u;
}
async function notLastSuper(ctx: Ctx, u: Rec) {
  if (u.role !== "SUPER_ADMIN") return;
  require_((await ctx.tx.rows("Users")).some((x) => x !== u && x.role === "SUPER_ADMIN" && x.status === "Active" && x.deleted !== "Y"), "There must be at least one active Super Admin");
}

/** What a person still has on their plate. Shown before the exit and returned after it. */
export async function openWorkOf(ctx: Ctx, userId: string) {
  const openItems = new Set((await ctx.tx.rows("Flow_Items")).filter((i) => i.status === "Open").map((i) => String(i.itemId)));
  const steps = (await ctx.tx.rows("Flow_Tasks")).filter((t) => t.assigneeId === userId && t.status === "Pending" && openItems.has(String(t.itemId)));
  const checklist = (await ctx.tx.rows("Checklist_Tasks")).filter((c) => c.doerId === userId && c.status === "Active");
  const reports = (await ctx.tx.rows("Users")).filter((x) => x.managerId === userId && x.status === "Active" && x.deleted !== "Y");
  const vault = (await ctx.tx.rows("Vault_Access")).filter((a) => a.userId === userId && a.deleted !== "Y");
  return { steps, checklist, reports, vault };
}

/** The exit takes effect: switch the account off and hand the work over. Used when the exit is recorded for today or earlier, and by the daily tick when the last day arrives. */
export async function applyExit(ctx: Ctx, u: Rec) {
  const successorId = String(u.exitHandover || "");
  const successor = successorId ? (await ctx.tx.rows("Users")).find((x) => x.userId === successorId && x.status === "Active" && x.deleted !== "Y") : undefined;
  const work = await openWorkOf(ctx, String(u.userId));
  u.status = "Inactive"; u.exitDone = "Y";
  // pending leave requests of someone who has left are closed
  for (const l of await ctx.tx.rows("Leaves")) if (l.userId === u.userId && l.status === "Pending") { l.status = "Cancelled"; l.decidedBy = ctx.actorId; l.decidedAt = ctx.clock.stamp; l.note = "Employee exited"; }
  for (const a of work.vault) a.deleted = "Y"; // logins they could open are closed to them
  // people who reported to them move up to the successor (or to the leaver's own manager)
  const newBoss = successor ? String(successor.userId) : String(u.managerId || "");
  for (const r of work.reports) r.managerId = newBoss;
  let moved = 0;
  if (successor) {
    for (const t of work.steps) { t.assigneeId = successor.userId; t.updatedAt = ctx.clock.stamp; t.remindedAt = ""; moved++; }
    for (const c of work.checklist) { c.doerId = successor.userId; c.updatedAt = ctx.clock.stamp; }
    for (const l of await ctx.tx.rows("Checklist_Log")) if (l.doerId === u.userId && l.status === "Pending") { l.doerId = successor.userId; l.updatedAt = ctx.clock.stamp; }
    for (const c of await ctx.tx.rows("Checklist_Tasks")) if (c.backupId === u.userId) c.backupId = "";
    if (moved || work.checklist.length) ctx.notice({ userId: String(successor.userId), type: "cover", title: `${u.name} has left — their work is now yours`, body: `${moved} FMS step${moved === 1 ? "" : "s"} and ${work.checklist.length} checklist task${work.checklist.length === 1 ? "" : "s"} moved to you.`, link: "/flows/tasks" });
  }
  ctx.tx.audit("Exit applied", "Users", String(u.userId), { status: "Active" }, { status: "Inactive", handedTo: successor?.name ?? "", steps: moved, checklist: successor ? work.checklist.length : 0, reportsMoved: work.reports.length, vaultClosed: work.vault.length });
  return { stepsMoved: moved, checklistMoved: successor ? work.checklist.length : 0, stepsLeft: successor ? 0 : work.steps.length, checklistLeft: successor ? 0 : work.checklist.length, reportsMoved: work.reports.length };
}

/** Record that someone is leaving / has left. A last day in the future keeps the person active until that day (the daily tick then switches them off). */
export async function recordExit(ctx: Ctx, d: Record<string, unknown>) {
  const u = await target(ctx, str(d.userId));
  await notLastSuper(ctx, u);
  require_(!u.exitDate || u.exitDone !== "Y", "This person has already left. Reinstate them first if they are coming back.");
  const date = str(d.exitDate), type = str(d.exitType) || "Resigned";
  require_(isDate(date), "Enter the last working day");
  require_((EXIT_TYPES as readonly string[]).includes(type), "Choose the type of exit");
  require_(date >= "2000-01-01" && date <= `${Number(ctx.clock.date.slice(0, 4)) + 1}-12-31`, "That date is not possible (a past date is fine; at most until the end of next year)");
  const reason = str(d.reason).slice(0, 500);
  const successorId = str(d.handoverToId);
  if (successorId) {
    const s = (await ctx.tx.rows("Users")).find((x) => x.userId === successorId && x.status === "Active" && x.deleted !== "Y");
    require_(s && successorId !== u.userId, "Choose an active colleague to take over the work");
  }
  const before = { status: u.status, exitDate: u.exitDate };
  Object.assign(u, { exitDate: date, exitType: type, exitReason: reason, exitHandover: successorId, exitBy: ctx.actorId, exitAt: ctx.clock.stamp, exitDone: "" });
  ctx.tx.audit("Exit recorded", "Users", String(u.userId), before, { exitDate: date, type, handedTo: successorId });

  let result = { stepsMoved: 0, checklistMoved: 0, stepsLeft: 0, checklistLeft: 0, reportsMoved: 0 };
  if (date <= ctx.clock.date) result = await applyExit(ctx, u);
  else ctx.notice({ userId: ctx.actorId, type: "access", title: `${u.name} leaves on ${date}`, body: "The account is switched off on that day and the work is handed over then.", link: "/flows/users", self: true });

  // the "Employee Exit" FMS (accept resignation, handover, assets, access, settlement …) gets its entry, when the company has that FMS
  let flowEntry = "";
  const flow = (await ctx.tx.rows("Flows")).find((f) => f.name === "Employee Exit" && f.status === "Active");
  if (flow) {
    try {
      const succ = successorId ? await ctx.user(successorId) : undefined;
      const { added } = await addEntries(ctx, String(flow.flowId), [{ data: { employee: u.name, department: u.department || "—", email: u.email, lastDay: date, handoverTo: succ?.name ?? "", reason: [type, reason].filter(Boolean).join(" — ") }, source: "exit" }], { lenient: true });
      flowEntry = added[0] ? String(added[0].itemId) : "";
    } catch (e) { if (!(e instanceof MidapError)) throw e; ctx.warnings.push(`The exit is recorded, but the "Employee Exit" FMS entry could not be made: ${e.message}`); }
  }
  if (date <= ctx.clock.date && (result.stepsLeft || result.checklistLeft)) ctx.warnings.push(`${u.name} still had ${result.stepsLeft} open FMS step(s) and ${result.checklistLeft} checklist task(s). Choose someone to hand them to, or move them one by one.`);
  return { user: pub("Users", u), applied: date <= ctx.clock.date, flowEntry, ...result };
}

/** Switch a person off (or on) without recording an exit — a long absence, a suspension. History is kept. */
export async function setUserStatus(ctx: Ctx, d: Record<string, unknown>) {
  const u = await target(ctx, str(d.userId));
  const status = str(d.status);
  require_(["Active", "Inactive"].includes(status), "Status must be Active or Inactive");
  if (status === "Inactive") await notLastSuper(ctx, u);
  if (status === "Active") require_(!(u.exitDone === "Y"), "This person has left the company. Use Reinstate.");
  if (u.status === status) return pub("Users", u);
  const before = { status: u.status };
  u.status = status;
  ctx.tx.audit(status === "Inactive" ? "User switched off" : "User switched on", "Users", String(u.userId), before, { status, note: str(d.note).slice(0, 200) });
  return pub("Users", u);
}

/** Someone who left comes back (or an exit was recorded by mistake): active again, exit details cleared (the activity log keeps the history). */
export async function reinstateUser(ctx: Ctx, d: Record<string, unknown>) {
  const u = await target(ctx, str(d.userId));
  const before = { status: u.status, exitDate: u.exitDate, exitType: u.exitType };
  Object.assign(u, { status: "Active", exitDate: "", exitType: "", exitReason: "", exitHandover: "", exitBy: "", exitAt: "", exitDone: "" });
  ctx.tx.audit("User reinstated", "Users", String(u.userId), before, { status: "Active", note: str(d.note).slice(0, 200) });
  return pub("Users", u);
}

/** Does this person appear in anything the app keeps? Then they can only be switched off, never deleted. */
async function history(ctx: Ctx, id: string): Promise<string[]> {
  const t = (name: string) => ctx.tx.rows(name);
  const found: string[] = [];
  const any = (label: string, rows: Rec[], f: (r: Rec) => boolean) => { if (rows.some(f)) found.push(label); };
  any("attendance", await t("Attendance"), (r) => r.userId === id && r.deleted !== "Y");
  any("leave", await t("Leaves"), (r) => r.userId === id);
  any("FMS work", await t("Flow_Tasks"), (r) => r.assigneeId === id || r.doneBy === id);
  any("FMS entries", await t("Flow_Items"), (r) => r.createdBy === id);
  any("checklist", await t("Checklist_Tasks"), (r) => r.doerId === id || r.createdBy === id);
  any("checklist history", await t("Checklist_Log"), (r) => r.doerId === id);
  any("salary slips", await t("Salary_Slips"), (r) => r.userId === id && r.deleted !== "Y");
  any("comments", await t("Comments"), (r) => r.userId === id);
  any("vault logins", await t("Vault_Items"), (r) => r.createdBy === id && r.deleted !== "Y");
  any("reminders", await t("Reminders"), (r) => r.fromId === id || r.toId === id);
  any("people reporting to them", await t("Users"), (r) => r.managerId === id && r.deleted !== "Y");
  return found;
}

/** Super Admin only. A person with history must be switched off first and have nobody reporting to them; the old records keep their name. */
export async function deleteUser(ctx: Ctx, d: Record<string, unknown>) {
  forbid(ctx.isSuper, "Only the Super Admin can delete a person");
  const u = await target(ctx, str(d.userId));
  await notLastSuper(ctx, u);
  require_(str(d.confirmName) === String(u.name), `Type the person's name exactly (${u.name}) to confirm`);
  const used = await history(ctx, String(u.userId));
  if (used.includes("people reporting to them")) fail("HAS_REPORTS", `${u.name} still has people reporting to them. Give those people a new reporting manager first (recording an exit with a hand-over person does this for you).`, { used });
  if (used.length && u.status === "Active") fail("HAS_HISTORY", `${u.name} has history in the app (${used.slice(0, 4).join(", ")}${used.length > 4 ? " and more" : ""}). Switch them off or record their exit first — then you can delete them, and their name stays on the old records.`, { used });
  const before = { name: u.name, role: u.role, department: u.department, empCode: u.empCode };
  // the sign-in details are freed so they can be used again; the row stays (rows are never physically deleted)
  Object.assign(u, { deleted: "Y", status: "Inactive", mobile: "", email: "", empCode: "", pinHash: "", managerId: "", permsJson: "", roleId: "" });
  for (const a of (await ctx.tx.rows("Vault_Access")).filter((x) => x.userId === u.userId)) a.deleted = "Y";
  ctx.tx.audit("User deleted", "Users", String(u.userId), before, null);
  return { userId: u.userId };
}

/** Daily: people whose last working day has come are switched off and their work is handed over. */
export async function settleExits(ctx: Ctx): Promise<number> {
  let n = 0;
  for (const u of await ctx.tx.rows("Users")) {
    if (u.deleted === "Y" || !u.exitDate || u.exitDone === "Y" || String(u.exitDate) > ctx.clock.date || u.status !== "Active") continue;
    await applyExit(ctx, u); n++;
  }
  return n;
}
