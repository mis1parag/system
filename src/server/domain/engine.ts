/**
 * The planning engine: planned times, conditional steps, assignment rules, item status.
 * Pure functions over plain records — no I/O.
 */
import type { Flow, FlowStep, StepCondition } from "../../lib/flow-types.ts";
import type { Rec } from "../sheets/db.ts";
import { addMinutes, addWorkdays, splitDT, type Calendar } from "./time.ts";

export type Data = Record<string, string | number | boolean | null | undefined>;

export function calendarFor(flow: Flow, holidays: Rec[]): Calendar {
  const set = new Set<string>();
  for (const h of holidays) if (h.deleted !== "Y" && (!h.flowId || h.flowId === flow.flowId)) set.add(String(h.date));
  return { off: new Set(flow.weeklyOff), holidays: set };
}

// ---------- conditions ----------
export function conditionMet(c: StepCondition | undefined, data: Data): boolean {
  if (!c || !c.field) return true;
  const raw = data[c.field];
  const v = raw === undefined || raw === null ? "" : String(raw).trim();
  const want = String(c.value ?? "").trim();
  switch (c.op) {
    case "filled": return v !== "" && v !== "false";
    case "empty": return v === "" || v === "false";
    case "eq": return v.toLowerCase() === want.toLowerCase();
    case "neq": return v.toLowerCase() !== want.toLowerCase();
    case "in": return want.split(",").map((x) => x.trim().toLowerCase()).includes(v.toLowerCase());
    case "gt": return Number(v) > Number(want);
    case "lt": return Number(v) < Number(want);
    default: return true;
  }
}

// ---------- planning ----------
/** The step before `i` that actually applies (skipped steps are passed over). */
function previousApplicable(tasks: Rec[], i: number): Rec | null {
  for (let k = i - 1; k >= 0; k--) if (tasks[k].status !== "Skipped") return tasks[k];
  return null;
}

export function planStep(flow: Flow, step: FlowStep, item: Rec, data: Data, prev: Rec | null, cal: Calendar): string {
  const rule = step.rule ?? { base: "none" };
  let base = "";
  if (rule.base === "anchor") base = String(item.anchorDate ?? "");
  else if (rule.base === "field") base = String(data[rule.field ?? ""] ?? "");
  else if (rule.base === "created") base = String(item.createdAt ?? "").slice(0, 16);
  else if (rule.base === "prev_actual") base = prev && prev.actual ? String(prev.actual) : "";
  if (!base) return "";
  const p = splitDT(base);
  const date = addWorkdays(p.date, Number(rule.offsetDays) || 0, cal);
  let out = `${date} ${rule.timeOfDay || p.time || flow.workEnd}`;
  if (Number(rule.offsetHours)) out = addMinutes(out, Number(rule.offsetHours) * 60);
  return out;
}

/** Recompute planned times for one entry's tasks (sorted by seq). Done tasks are only touched when includeDone. Returns changed tasks. */
export function planTasks(flow: Flow, item: Rec, data: Data, tasks: Rec[], cal: Calendar, includeDone: boolean): Rec[] {
  const changed: Rec[] = [];
  flow.steps.forEach((step) => {
    const i = tasks.findIndex((t) => t.stepId === step.stepId);
    if (i < 0) return;
    const t = tasks[i];
    if (t.status === "Done" && !includeDone) return;
    const planned = t.status === "Skipped" ? "" : planStep(flow, step, item, data, previousApplicable(tasks, i), cal);
    if (t.planned !== planned) {
      t.planned = planned;
      // the first plan is remembered so approved extensions can be measured against it
      if (planned && !t.origPlanned) t.origPlanned = planned;
      changed.push(t);
    }
  });
  return changed;
}

/** Apply conditional steps: tasks whose condition fails become Skipped, and come back when it holds again. Returns changed tasks. */
export function syncConditions(flow: Flow, data: Data, tasks: Rec[]): Rec[] {
  const changed: Rec[] = [];
  for (const step of flow.steps) {
    const t = tasks.find((x) => x.stepId === step.stepId);
    if (!t || t.status === "Done" || !step.condition) continue;
    const ok = conditionMet(step.condition, data);
    if (!ok && t.status !== "Skipped") { t.status = "Skipped"; t.planned = ""; changed.push(t); }
    else if (ok && t.status === "Skipped") { t.status = "Pending"; changed.push(t); }
  }
  return changed;
}

// ---------- status ----------
/** An entry is complete when every applicable step is done. Returns true when item fields changed. */
export function refreshItemStatus(item: Rec, tasks: Rec[], stamp: string): boolean {
  if (item.status === "Cancelled") return false;
  const live = tasks.filter((t) => t.status !== "Skipped");
  const allDone = tasks.length > 0 && live.every((t) => t.status === "Done");
  const status = allDone ? "Completed" : "Open";
  const completedAt = allDone ? live.reduce((m, t) => (String(t.actual) > m ? String(t.actual) : m), "") : "";
  if (item.status !== status || item.completedAt !== completedAt) {
    item.status = status;
    item.completedAt = completedAt;
    item.updatedAt = stamp;
    return true;
  }
  return false;
}

// ---------- assignment ----------
/**
 * Who should do this step for this entry. `openLoad` = number of open tasks per user for the flow (for least-load),
 * `stepCount` = tasks already created for this step (for round robin).
 */
export function pickAssignee(step: FlowStep, data: Data, load: { openLoad: Map<string, number>; stepCount: number }, activeUsers: Set<string>): string {
  const a = step.assign;
  const ok = (id: string | undefined) => !!id && activeUsers.has(id);
  if (a?.type === "field" && a.field) {
    const v = String(data[a.field] ?? "").trim();
    const hit = a.map && Object.entries(a.map).find(([k]) => k.trim().toLowerCase() === v.toLowerCase());
    if (hit && ok(hit[1])) return hit[1];
  } else if (a?.type === "pool" && a.pool?.length) {
    const pool = a.pool.filter((id) => ok(id));
    if (pool.length) {
      if (a.poolMode === "least_load") {
        return [...pool].sort((x, y) => (load.openLoad.get(x) ?? 0) - (load.openLoad.get(y) ?? 0))[0];
      }
      return pool[load.stepCount % pool.length];
    }
  }
  return step.assigneeId;
}
