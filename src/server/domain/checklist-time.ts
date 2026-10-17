/**
 * "More time" for a checklist task, decided the same way as for an FMS step.
 * It uses the same Requests table (kind = "checklist"; taskId = the dated checklist entry, itemId = the checklist task), so the Approvals page shows both.
 * The doer asks; the doer's reporting manager, the Super Admin, or someone who manages the checklist for that person decides.
 */
import { allows, reachOf, scopeOfGrant } from "../../lib/permissions.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { addDays, isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export async function checklistApprovers(ctx: Ctx, doerId: string): Promise<string[]> {
  const users = await ctx.tx.rows("Users");
  const out = new Set<string>();
  const doer = users.find((u) => u.userId === doerId);
  if (doer?.managerId) out.add(String(doer.managerId));
  for (const u of users.filter((x) => x.status === "Active" && x.deleted !== "Y" && x.role !== "STAFF")) {
    if (u.role === "SUPER_ADMIN") { out.add(String(u.userId)); continue; }
    const perms = ctx.permsOf(u);
    if (!allows(perms, "checklist", "manage")) continue;
    const r = reachOf({ userId: String(u.userId), role: String(u.role), department: String(u.department ?? "") }, users as never, scopeOfGrant(perms, "checklist"));
    if (r.all || r.ids.has(doerId)) out.add(String(u.userId));
  }
  out.delete(doerId);
  return [...out];
}

export async function requestChecklistTime(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("checklist", "view", "The checklist is not available to you");
  const e = (await ctx.tx.rows("Checklist_Log")).find((l) => l.clId === str(d.clId));
  require_(e && e.status === "Pending", "Only a task that is still waiting can get more time");
  const task = (await ctx.tx.rows("Checklist_Tasks")).find((t) => t.ctId === e.ctId);
  require_(e.doerId === ctx.actorId || (task && task.backupId === ctx.actorId), "This task belongs to someone else");
  const date = str(d.newDate);
  require_(isDate(date), "Pick the new date");
  require_(date > String(e.plannedDate) && date <= addDays(String(e.plannedDate), 60), "Pick a day after the planned day (up to 60 days later)");
  require_(str(d.reason), "Give a reason");
  const reqs = await ctx.tx.rows("Requests");
  require_(!reqs.some((r) => r.kind === "checklist" && r.taskId === e.clId && r.status === "Pending"), "There is already a pending request for this task");
  const r = ctx.tx.insert("Requests", {
    requestId: newId("REQ"), taskId: e.clId, itemId: e.ctId, flowId: "", requestedBy: ctx.actorId, newPlanned: date, reason: str(d.reason).slice(0, 300),
    status: "Pending", decidedBy: "", decidedAt: "", note: "", createdAt: ctx.clock.stamp, kind: "checklist",
  });
  ctx.tx.audit("Checklist time requested", "Requests", String(r.requestId), { plannedDate: e.plannedDate }, { newDate: date, reason: r.reason });
  for (const u of await checklistApprovers(ctx, String(e.doerId))) ctx.notice({ userId: u, type: "request", title: `${ctx.actor.name} asks for more time`, body: `${task?.title ?? "Checklist task"} → ${date}. ${r.reason}`, link: "/flows/approvals" });
  return pub("Requests", r);
}

/** Called by decideRequest for a request of kind "checklist". */
export async function decideChecklistTime(ctx: Ctx, r: Rec, d: Record<string, unknown>) {
  const e = (await ctx.tx.rows("Checklist_Log")).find((l) => l.clId === r.taskId);
  require_(e, "That checklist entry no longer exists");
  const task = (await ctx.tx.rows("Checklist_Tasks")).find((t) => t.ctId === e.ctId);
  if (!(await checklistApprovers(ctx, String(r.requestedBy))).includes(ctx.actorId)) fail("FORBIDDEN", "Only the doer's reporting manager, the Super Admin, or someone who manages their checklist can decide this");
  const approve = d.approve === true;
  if (approve) {
    require_(e.status === "Pending", "That task is no longer waiting");
  }
  r.status = approve ? "Approved" : "Rejected";
  r.decidedBy = ctx.actorId; r.decidedAt = ctx.clock.stamp; r.note = str(d.note);
  if (approve) { e.origDate = String(e.origDate || e.plannedDate); e.plannedDate = r.newPlanned; e.movedBy = ctx.actorId; e.remindedAt = ""; e.updatedAt = ctx.clock.stamp; }
  ctx.tx.audit(approve ? "Checklist time approved" : "Checklist time rejected", "Requests", String(r.requestId), null, { newDate: r.newPlanned, note: r.note });
  ctx.notice({ userId: String(r.requestedBy), type: "request_decided", title: `More time ${approve ? "approved" : "declined"}: ${task?.title ?? "checklist task"}`, body: `${approve ? `Now due ${r.newPlanned}` : "Keeps its date"}${r.note ? `. ${r.note}` : ""}`, link: "/flows/checklist" });
  return pub("Requests", r);
}
