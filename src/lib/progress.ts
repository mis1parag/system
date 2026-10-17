// How much of a person's work is done — one definition, used by the manager dashboard, the scorecard cards and the tests.
//   FMS progress   = steps done ÷ steps assigned (a step of a cancelled entry is not counted)
//   overdue        = a step still waiting whose planned time has passed
//   nothing assigned → progress is "no FMS assigned" (null), never 0 % and never "overdue"
import type { ChecklistEntry, FlowItem, FlowTask } from "./flow-types.ts";

export interface FmsProgress { assigned: number; done: number; open: number; overdue: number; pct: number | null; state: "none" | "overdue" | "working" | "done" }

export function fmsProgress(tasks: FlowTask[], items: FlowItem[], userId: string, nowDT: string): FmsProgress {
  const live = new Set(items.filter((i) => i.status !== "Cancelled").map((i) => i.itemId));
  const mine = tasks.filter((t) => t.assigneeId === userId && live.has(t.itemId));
  const done = mine.filter((t) => t.status === "Done").length;
  const waiting = mine.filter((t) => t.status === "Pending");
  const overdue = waiting.filter((t) => t.planned && t.planned < nowDT).length;
  const assigned = done + waiting.length;
  return { assigned, done, open: waiting.length, overdue, pct: assigned ? Math.round((done / assigned) * 100) : null, state: !assigned ? "none" : overdue ? "overdue" : waiting.length ? "working" : "done" };
}

export interface ChecklistToday { due: number; done: number; pending: number; late: number }
/** Checklist for one person up to today: what was due, what is done, what is still waiting (late = planned before today). */
export function checklistToday(log: ChecklistEntry[], userId: string, today: string): ChecklistToday {
  const mine = log.filter((l) => l.doerId === userId && l.plannedDate <= today && l.status !== "Cancelled" && l.status !== "Skipped");
  const done = mine.filter((l) => l.status === "Done").length;
  const pending = mine.filter((l) => l.status === "Pending");
  return { due: mine.length, done, pending: pending.length, late: pending.filter((l) => l.plannedDate < today).length };
}
