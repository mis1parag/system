// Rules shared by the server and the browser (task state, delay, absence cover). No path aliases, no Node APIs.
import { dtMs } from "../server/domain/time.ts";
import type { Absence, FlowTask } from "./flow-types.ts";

export { parseFlow } from "./flow-parse.ts";

type TaskLike = Pick<FlowTask, "assigneeId" | "planned" | "actual" | "status">;
type AbsenceLike = Pick<Absence, "userId" | "fromDate" | "toDate" | "backupUserId">;

export type TaskState = "done" | "skipped" | "overdue" | "today" | "upcoming" | "unplanned";
export function taskState(t: TaskLike, now: string): TaskState {
  if (t.status === "Skipped") return "skipped";
  if (t.actual) return "done";
  if (!t.planned) return "unplanned";
  if (t.planned < now) return "overdue";
  return t.planned.slice(0, 10) === now.slice(0, 10) ? "today" : "upcoming";
}

/** Minutes late. Finished steps: actual vs planned. Open steps: how long it has been overdue. */
export function delayMinutes(t: Pick<FlowTask, "planned" | "actual" | "status">, now: string): number {
  if (!t.planned || t.status === "Skipped") return 0;
  return Math.max(0, Math.round((dtMs(t.actual || now) - dtMs(t.planned)) / 60000));
}

export function absentOn<A extends AbsenceLike>(absences: A[], userId: string, date: string): A | undefined {
  return absences.find((a) => a.userId === userId && a.fromDate <= date && a.toDate >= date);
}

/** Open task → who currently owns it: the assignee, or the backup while the assignee is away (on the planned day, or today if already due). */
export function effectiveAssignee(t: TaskLike, absences: AbsenceLike[], today: string): { userId: string; covering: boolean } {
  if (t.actual || t.status === "Skipped" || !t.assigneeId) return { userId: t.assigneeId, covering: false };
  const planDate = t.planned ? t.planned.slice(0, 10) : today;
  let a = absentOn(absences, t.assigneeId, planDate);
  if (!a && planDate <= today) a = absentOn(absences, t.assigneeId, today);
  return a ? { userId: a.backupUserId, covering: true } : { userId: t.assigneeId, covering: false };
}
