/** Steps: complete, undo, reassign, extension requests. */
import type { Flow, FlowStep } from "../../lib/flow-types.ts";
import { effectiveAssignee } from "../../lib/flow-shared.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { decideChecklistTime } from "./checklist-time.ts";
import { decideCheckoutRequest } from "./attendance.ts";
import { allows, reachOf, scopeOfGrant } from "../../lib/permissions.ts";
import { calendarFor, planTasks, refreshItemStatus } from "./engine.ts";
import { coerceField, parseData } from "./entries.ts";
import { dtMs, normDT } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

interface Parts { task: Rec; item: Rec; flow: Flow; step: FlowStep | undefined; tasks: Rec[] }
async function parts(ctx: Ctx, taskId: string): Promise<Parts> {
  const all = await ctx.tx.rows("Flow_Tasks");
  const task = all.find((t) => t.taskId === taskId);
  require_(task, "Unknown task");
  const item = (await ctx.tx.rows("Flow_Items")).find((i) => i.itemId === task.itemId);
  require_(item, "Unknown entry");
  const { flow } = await ctx.flow(String(task.flowId));
  return { task, item, flow, step: flow.steps.find((s) => s.stepId === task.stepId), tasks: all.filter((t) => t.itemId === task.itemId).sort((a, b) => Number(a.seq) - Number(b.seq)) };
}

export async function absenceRows(ctx: Ctx) {
  return (await ctx.tx.rows("Absences")).filter((a) => a.deleted !== "Y") as unknown as { userId: string; fromDate: string; toDate: string; backupUserId: string }[];
}

/** Admin, the assignee, or the backup covering the assignee right now. */
export async function canActOnTask(ctx: Ctx, task: Rec): Promise<boolean> {
  if (ctx.isSuper) return true;
  if (await ctx.manages(String(task.assigneeId), "fms")) return true; // a manager acts for the people in their reach
  if (task.assigneeId === ctx.actorId) return true;
  const eff = effectiveAssignee({ assigneeId: String(task.assigneeId), planned: String(task.planned), actual: String(task.actual), status: task.status as "Pending" }, await absenceRows(ctx), ctx.clock.date);
  return eff.userId === ctx.actorId;
}

export async function completeTask(ctx: Ctx, d: Record<string, unknown>) {
  const { task, item, flow, step, tasks } = await parts(ctx, str(d.taskId));
  require_(task.status === "Pending", task.status === "Done" ? "This step is already done" : "This step does not apply to this entry");
  if (!(await canActOnTask(ctx, task))) fail("FORBIDDEN", "This step is assigned to someone else");
  require_(item.status === "Open", `This entry is ${String(item.status).toLowerCase()}`);
  if (step?.sequential) {
    const prevs = tasks.filter((t) => Number(t.seq) < Number(task.seq) && t.status !== "Skipped");
    require_(!prevs.length || prevs[prevs.length - 1].status === "Done", "Finish the previous step first");
  }
  // someone else may have finished it a moment ago — look at the sheet itself, not our cached copy
  if (!d._bulk) {
    const fresh = await ctx.tx.freshRow("Flow_Tasks", task);
    require_(fresh && !fresh.actual, "This step was just completed by someone else. Refresh to see it.");
  }
  const actual = str(d.actual) ? normDT(d.actual) : ctx.clock.dt;
  require_(actual && actual.length === 16, "Enter the completion date and time");
  require_(dtMs(actual) <= dtMs(ctx.clock.dt) + 5 * 60000, "Completion time cannot be in the future");

  const given = (d.data ?? {}) as Record<string, unknown>;
  const stepData: Record<string, string | number> = {};
  for (const f of step?.completionFields ?? []) stepData[f.key] = coerceField(f, given[f.key], true);

  task.status = "Done";
  task.actual = actual;
  task.doneBy = ctx.actorId;
  if (d.remarks !== undefined) task.remarks = str(d.remarks);
  if (Object.keys(stepData).length) task.dataJson = JSON.stringify(stepData);
  task.updatedAt = ctx.clock.stamp;

  const cal = calendarFor(flow, await ctx.tx.rows("Holidays"));
  planTasks(flow, item, parseData(item), tasks, cal, false).forEach((t) => (t.updatedAt = ctx.clock.stamp)); // steps timed from this one's completion
  const finished = refreshItemStatus(item, tasks, ctx.clock.stamp) && String(item.status) === "Completed";
  ctx.tx.audit("Step done", "Flow_Tasks", String(task.taskId), null, { item: item.title, step: step?.name ?? task.stepId, actual });
  if (finished) ctx.notice({ userId: String(item.createdBy), type: "completed", title: `${flow.doneLabel}: ${item.title}`, body: `${flow.name} — all steps are done.`, link: `/flows/${flow.flowId}?item=${item.itemId}`, itemId: String(item.itemId) });
  return pub("Flow_Tasks", task);
}

export async function reopenTask(ctx: Ctx, d: Record<string, unknown>) {
  const { task, item, flow, tasks } = await parts(ctx, str(d.taskId));
  if (!(await ctx.manages(String(task.assigneeId), "fms"))) fail("FORBIDDEN", "Only a manager can undo a completed step");
  require_(task.status === "Done", "This step is not done");
  const old = String(task.actual);
  task.status = "Pending"; task.actual = ""; task.doneBy = ""; task.dataJson = ""; task.remindedAt = ""; task.overdueAt = ""; task.escalatedAt = ""; task.updatedAt = ctx.clock.stamp;
  const cal = calendarFor(flow, await ctx.tx.rows("Holidays"));
  planTasks(flow, item, parseData(item), tasks, cal, false).forEach((t) => (t.updatedAt = ctx.clock.stamp));
  if (item.status === "Completed") { item.status = "Open"; item.completedAt = ""; item.updatedAt = ctx.clock.stamp; }
  ctx.tx.audit("Step reopened", "Flow_Tasks", String(task.taskId), { actual: old }, { actual: "" });
  return pub("Flow_Tasks", task);
}

export async function reassignTask(ctx: Ctx, d: Record<string, unknown>) {
  const { task, item, flow, step } = await parts(ctx, str(d.taskId));
  require_(task.status === "Pending", "This step is not open");
  if (!(await canActOnTask(ctx, task))) fail("FORBIDDEN", "This step is assigned to someone else");
  const to = str(d.assigneeId);
  const u = await ctx.user(to);
  require_(u && u.status === "Active", "Choose an active person");
  const old = String(task.assigneeId);
  task.assigneeId = to; task.updatedAt = ctx.clock.stamp; task.remindedAt = ""; task.overdueAt = ""; task.escalatedAt = "";
  ctx.tx.audit("Step reassigned", "Flow_Tasks", String(task.taskId), { assignee: old }, { assignee: to });
  ctx.notice({ userId: to, type: "assigned", title: `Assigned to you: ${step?.name ?? "step"}`, body: `${item.title} · ${flow.name}`, link: `/flows/${flow.flowId}?item=${item.itemId}`, itemId: String(item.itemId), taskId: String(task.taskId) });
  return pub("Flow_Tasks", task);
}

// ---------- extension requests ----------
/** People who can approve a request for this task: the doer's manager, the step's escalation person, and all admins. */
export async function approversFor(ctx: Ctx, task: Rec, step: FlowStep | undefined): Promise<string[]> {
  const users = await ctx.tx.rows("Users");
  const out = new Set<string>();
  const me = users.find((u) => u.userId === task.assigneeId);
  if (me?.managerId) out.add(String(me.managerId));
  if (step?.escalateToId) out.add(step.escalateToId);
  // every Super Admin, and anyone who is allowed to approve in FMS and whose reach includes the doer
  for (const u of users.filter((x) => x.status === "Active" && x.role !== "STAFF")) {
    if (u.role === "SUPER_ADMIN") { out.add(String(u.userId)); continue; }
    const perms = ctx.permsOf(u);
    if (!allows(perms, "fms", "approve")) continue;
    const r = reachOf({ userId: String(u.userId), role: String(u.role), department: String(u.department ?? "") }, users as never, scopeOfGrant(perms, "fms"));
    if (r.all || r.ids.has(String(task.assigneeId))) out.add(String(u.userId));
  }
  return [...out];
}

export async function requestExtension(ctx: Ctx, d: Record<string, unknown>) {
  const { task, item, flow, step } = await parts(ctx, str(d.taskId));
  require_(task.status === "Pending", "Only open steps can be extended");
  require_(item.status === "Open", "This entry is not open");
  if (!(await canActOnTask(ctx, task))) fail("FORBIDDEN", "This step is assigned to someone else");
  const np = normDT(d.newPlanned);
  require_(np && np.length === 16, "Pick the new date and time");
  require_(!task.planned || np > String(task.planned), "The new time must be later than the current planned time");
  require_(str(d.reason), "Give a reason");
  const reqs = await ctx.tx.rows("Requests");
  require_(!reqs.some((r) => r.taskId === task.taskId && r.status === "Pending"), "There is already a pending request for this step");
  const r = ctx.tx.insert("Requests", {
    requestId: newId("REQ"), taskId: task.taskId, itemId: item.itemId, flowId: flow.flowId, requestedBy: ctx.actorId, newPlanned: np, reason: str(d.reason),
    status: "Pending", decidedBy: "", decidedAt: "", note: "", createdAt: ctx.clock.stamp,
  });
  ctx.tx.audit("Extension requested", "Requests", String(r.requestId), { planned: task.planned }, { newPlanned: np, reason: r.reason });
  for (const u of await approversFor(ctx, task, step)) {
    ctx.notice({ userId: u, type: "request", title: `${ctx.actor.name} asks for more time`, body: `${step?.name ?? "Step"} · ${item.title} → ${np}. ${r.reason}`, link: "/flows/approvals", itemId: String(item.itemId), taskId: String(task.taskId) });
  }
  return pub("Requests", r);
}

export async function decideRequest(ctx: Ctx, d: Record<string, unknown>) {
  const r = (await ctx.tx.rows("Requests")).find((x) => x.requestId === str(d.requestId));
  require_(r, "Unknown request");
  require_(r.status === "Pending", `This request was already ${String(r.status).toLowerCase()}`);
  if (r.kind === "checklist") return decideChecklistTime(ctx, r, d);
  if (r.kind === "checkout") return decideCheckoutRequest(ctx, r, d);
  ctx.require("fms", "view", "You do not have access to this");
  const { task, item, flow, step } = await parts(ctx, String(r.taskId));
  const allowed = (await approversFor(ctx, task, step)).includes(ctx.actorId);
  if (!allowed) fail("FORBIDDEN", "Only the doer's reporting manager, or someone allowed to decide for this department, can decide this");
  const approve = d.approve === true;
  r.status = approve ? "Approved" : "Rejected";
  r.decidedBy = ctx.actorId; r.decidedAt = ctx.clock.stamp; r.note = str(d.note);
  if (approve && task.status === "Pending") {
    task.origPlanned = task.origPlanned || task.planned;
    task.planned = r.newPlanned;
    task.extCount = Number(task.extCount) + 1;
    task.remindedAt = ""; task.overdueAt = ""; task.escalatedAt = ""; task.updatedAt = ctx.clock.stamp;
  }
  ctx.tx.audit(approve ? "Extension approved" : "Extension rejected", "Requests", String(r.requestId), null, { newPlanned: r.newPlanned, note: r.note });
  ctx.notice({
    userId: String(r.requestedBy), type: "request_decided", title: `More time ${approve ? "approved" : "declined"}: ${step?.name ?? "step"}`,
    body: `${item.title}${approve ? ` → ${r.newPlanned}` : ""}${r.note ? `. ${r.note}` : ""}`, link: `/flows/${flow.flowId}?item=${item.itemId}`, itemId: String(item.itemId), taskId: String(task.taskId),
  });
  return pub("Requests", r);
}
