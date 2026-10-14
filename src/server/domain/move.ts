/** Moving work: push unfinished tasks to another day, or hand them to someone else. The Super Admin decides who is allowed (capability "moveWork"). */
import { fail, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { checklistCalendar } from "./checklist.ts";
import { addDays, isDate, isOffDay, type Calendar } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** "today" = today (or the next working day if today is off), "next" = the next working day after today, otherwise a date. */
function target(when: string, today: string, cal: Calendar): string {
  if (when === "today" || when === "next") {
    let d = when === "next" ? addDays(today, 1) : today;
    for (let i = 0; i < 14 && isOffDay(d, cal); i++) d = addDays(d, 1);
    return d;
  }
  require_(isDate(when), "Pick the day to move it to");
  return when;
}

export async function moveWork(ctx: Ctx, d: Record<string, unknown>) {
  const kind = str(d.kind);
  require_(kind === "checklist" || kind === "fms", "Choose what to move");
  ctx.require(kind === "fms" ? "fms" : "checklist", "assign", "You cannot move or hand over work");
  const ids = (Array.isArray(d.ids) ? d.ids : []).map(str).filter(Boolean);
  require_(ids.length > 0, "Nothing selected");
  require_(ids.length <= 300, "Move at most 300 at a time");
  const when = str(d.when), toUserId = str(d.toUserId);
  require_(when || toUserId, "Choose a new day, a new person, or both");
  const note = str(d.note).slice(0, 200);
  const scope = await ctx.reach(kind === "fms" ? "fms" : "checklist");
  if (toUserId) {
    const to = await ctx.user(toUserId);
    require_(to && to.status === "Active", "Choose an active person");
    require_(scope.all || scope.ids.has(toUserId), "That person is outside your access");
  }
  const today = ctx.clock.date;
  const skipped: { id: string; reason: string }[] = [];
  let moved = 0;
  const bump = (userId: string, what: string, detail: string) => ctx.notice({ userId, type: "moved", title: what, body: `${detail}${note ? ` — ${note}` : ""}` });

  if (kind === "checklist") {
    const cal = await checklistCalendar(ctx);
    const newDate = when ? target(when, today, cal) : "";
    const log = await ctx.tx.rows("Checklist_Log");
    const tasks = new Map((await ctx.tx.rows("Checklist_Tasks")).map((t) => [String(t.ctId), t]));
    for (const id of ids) {
      const e = log.find((l) => l.clId === id);
      if (!e || e.status !== "Pending") { skipped.push({ id, reason: "Not an open task any more" }); continue; }
      if (String(e.doerId) !== ctx.actorId && !(await ctx.manages(String(e.doerId), "checklist"))) { skipped.push({ id, reason: "Belongs to someone outside your reach" }); continue; }
      const title = String(tasks.get(String(e.ctId))?.title ?? "Checklist task");
      const before = { plannedDate: e.plannedDate, doerId: e.doerId };
      if (newDate && newDate !== e.plannedDate) { e.origDate = String(e.origDate || e.plannedDate); e.plannedDate = newDate; }
      if (toUserId && toUserId !== e.doerId) e.doerId = toUserId;
      e.movedBy = ctx.actorId; e.remindedAt = ""; e.updatedAt = ctx.clock.stamp;
      ctx.tx.audit("Checklist moved", "Checklist_Log", String(e.clId), before, { plannedDate: e.plannedDate, doerId: e.doerId, note });
      if (toUserId) bump(toUserId, `Checklist task handed to you: ${title}`, `Due ${e.plannedDate}`);
      else bump(String(e.doerId), `Checklist task moved: ${title}`, `Now due ${e.plannedDate}`);
      moved++;
    }
  } else {
    const items = new Map((await ctx.tx.rows("Flow_Items")).map((i) => [String(i.itemId), i]));
    const tasks = await ctx.tx.rows("Flow_Tasks");
    for (const id of ids) {
      const t = tasks.find((x) => x.taskId === id);
      const item = t ? items.get(String(t.itemId)) : undefined;
      if (!t || !item || t.status !== "Pending" || item.status !== "Open") { skipped.push({ id, reason: "Not an open step any more" }); continue; }
      if (!(scope.all || scope.ids.has(String(t.assigneeId)))) { skipped.push({ id, reason: "Belongs to someone outside your reach" }); continue; }
      const { flow } = await ctx.flow(String(t.flowId));
      const cal = await ctx.calendar(flow);
      const before = { planned: t.planned, assigneeId: t.assigneeId };
      if (when) {
        const day = target(when, today, cal);
        const time = String(t.planned).slice(11, 16) || flow.workEnd || "18:00";
        const np = `${day} ${time}`;
        if (np !== t.planned) { t.origPlanned = String(t.origPlanned || t.planned); t.planned = np; t.extCount = Number(t.extCount) + 1; }
      }
      if (toUserId && toUserId !== t.assigneeId) t.assigneeId = toUserId;
      t.remindedAt = ""; t.overdueAt = ""; t.escalatedAt = ""; t.updatedAt = ctx.clock.stamp;
      const step = flow.steps.find((s) => s.stepId === t.stepId);
      ctx.tx.audit("Step moved", "Flow_Tasks", String(t.taskId), before, { planned: t.planned, assigneeId: t.assigneeId, note });
      const what = `${step?.name ?? "Step"} · ${item.title}`;
      if (toUserId) bump(toUserId, `Step handed to you: ${step?.name ?? "step"}`, `${what} · due ${t.planned}`);
      else bump(String(t.assigneeId), `Step moved: ${step?.name ?? "step"}`, `${what} · now due ${t.planned}`);
      moved++;
    }
  }
  if (!moved && skipped.length) fail("VALIDATION", skipped[0].reason);
  return { moved, skipped };
}

