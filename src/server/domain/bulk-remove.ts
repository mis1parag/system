/**
 * Super Admin: take whole sets of FMS entries / checklist tasks out of everybody's lists in one go.
 * Nothing is erased: an FMS entry becomes Cancelled (and can be restored), a checklist task becomes Archived and its
 * unfinished entries Cancelled; finished work stays in the history. Every use is written to the activity log with the numbers.
 * The caller must type REMOVE (checked here too, so a stray click or a script cannot do it by accident).
 */
import { MidapError, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { cancelEntry } from "./entries.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const sure = (d: Record<string, unknown>) => require_(str(d.confirm).toUpperCase() === "REMOVE", "Type REMOVE to confirm");

/** What would be removed — shown in the dialog before anything is done. */
export async function previewRemoval(ctx: Ctx, d: Record<string, unknown>) {
  const kind = str(d.kind);
  require_(kind === "fms" || kind === "checklist", "Choose FMS or checklist");
  if (kind === "fms") {
    const flowId = str(d.flowId);
    const items = (await ctx.tx.rows("Flow_Items")).filter((i) => i.flowId === flowId);
    return { total: items.length, open: items.filter((i) => i.status === "Open").length, completed: items.filter((i) => i.status === "Completed").length, cancelled: items.filter((i) => i.status === "Cancelled").length };
  }
  const doerId = str(d.doerId);
  const tasks = (await ctx.tx.rows("Checklist_Tasks")).filter((t) => t.status !== "Archived" && (!doerId || t.doerId === doerId));
  const ids = new Set(tasks.map((t) => String(t.ctId)));
  const log = (await ctx.tx.rows("Checklist_Log")).filter((l) => ids.has(String(l.ctId)));
  return { tasks: tasks.length, pending: log.filter((l) => l.status === "Pending").length, done: log.filter((l) => l.status === "Done").length };
}

/** Cancel the entries of one FMS: scope "open" = only the open ones, "everything" = also the finished ones. */
export async function removeFlowEntries(ctx: Ctx, d: Record<string, unknown>) {
  sure(d);
  const flowId = str(d.flowId);
  require_((await ctx.tx.rows("Flows")).some((f) => f.flowId === flowId), "Choose the FMS");
  const scope = str(d.scope) || "open";
  require_(scope === "open" || scope === "everything", "Choose what to remove");
  const items = (await ctx.tx.rows("Flow_Items")).filter((i) => i.flowId === flowId && (scope === "everything" ? i.status !== "Cancelled" : i.status === "Open"));
  for (const i of items) { i.status = "Cancelled"; i.completedAt = ""; i.updatedAt = ctx.clock.stamp; }
  ctx.tx.audit("FMS entries removed (bulk)", "Flow_Items", flowId, null, { scope, count: items.length, reason: str(d.reason).slice(0, 120) });
  return { removed: items.length };
}

/** Bring back every cancelled entry of one FMS (undo of the above). */
export async function restoreFlowEntries(ctx: Ctx, d: Record<string, unknown>) {
  const flowId = str(d.flowId);
  require_((await ctx.tx.rows("Flows")).some((f) => f.flowId === flowId), "Choose the FMS");
  const items = (await ctx.tx.rows("Flow_Items")).filter((i) => i.flowId === flowId && i.status === "Cancelled");
  let restored = 0;
  for (const i of items) {
    try { await cancelEntry(ctx, { itemId: i.itemId, cancel: false }); restored++; } catch (e) { if (!(e instanceof MidapError)) throw e; }
  }
  ctx.tx.audit("FMS entries restored (bulk)", "Flow_Items", flowId, null, { count: restored });
  return { restored };
}

/** Archive checklist tasks (everyone's, or one person's) and cancel their unfinished entries. Finished entries stay as history. */
export async function removeChecklistTasks(ctx: Ctx, d: Record<string, unknown>) {
  sure(d);
  const doerId = str(d.doerId);
  if (doerId) require_((await ctx.tx.rows("Users")).some((u) => u.userId === doerId), "Choose the person");
  const tasks = (await ctx.tx.rows("Checklist_Tasks")).filter((t) => t.status !== "Archived" && (!doerId || t.doerId === doerId));
  const ids = new Set(tasks.map((t) => String(t.ctId)));
  for (const t of tasks) { t.status = "Archived"; t.updatedAt = ctx.clock.stamp; }
  let cancelled = 0;
  for (const l of await ctx.tx.rows("Checklist_Log")) if (ids.has(String(l.ctId)) && l.status === "Pending") { l.status = "Cancelled"; l.updatedAt = ctx.clock.stamp; cancelled++; }
  ctx.tx.audit("Checklist tasks removed (bulk)", "Checklist_Tasks", doerId || "everyone", null, { tasks: tasks.length, entriesCancelled: cancelled, reason: str(d.reason).slice(0, 120) });
  return { tasks: tasks.length, entriesCancelled: cancelled };
}
