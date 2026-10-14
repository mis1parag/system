// Weekly scorecard, the way the owner's "Scorecard" Drive sheet works: for every person and every system
// (Daily checklist, Non-daily checklist, One-time checklist, and each FMS step) it counts what was planned in the week,
// what is done, and what was done on time — and turns that into "% work not done" and "% work not done on time".
// Pure functions; used by the browser and by the tests. No path aliases.
import { addDays, weekday } from "../server/domain/time.ts";
import { freqGroup } from "./checklist-shared.ts";
import type { ChecklistEntry, ChecklistTask, Flow, FlowItem, FlowTask } from "./flow-types.ts";

/** Monday of the week that contains `date`. */
export const weekStartOf = (date: string): string => addDays(date, -((weekday(date) + 6) % 7));
export const weekEndOf = (weekStart: string): string => addDays(weekStart, 6);

export type SystemGroup = "DC" | "NDC" | "OT" | "FMS";
/** One piece of planned work, from a checklist entry or an FMS step. */
export interface Unit { who: string; system: string; group: SystemGroup; planned: string; done: boolean; onTime: boolean }

export const SYSTEM_NAME: Record<"DC" | "NDC" | "OT", string> = { DC: "Daily checklist", NDC: "Non-daily checklist", OT: "One-time checklist" };
const GROUP_ORDER: Record<SystemGroup, number> = { DC: 0, NDC: 1, OT: 2, FMS: 3 };

export interface UnitSource { flows: Flow[]; items: FlowItem[]; tasks: FlowTask[]; checklistTasks: ChecklistTask[]; checklistLog: ChecklistEntry[] }

export function buildUnits(src: UnitSource): Unit[] {
  const out: Unit[] = [];
  const clTask = new Map(src.checklistTasks.map((t) => [t.ctId, t]));
  for (const e of src.checklistLog) {
    if (e.status !== "Pending" && e.status !== "Done") continue; // skipped / cancelled entries do not count
    const t = clTask.get(e.ctId);
    if (!t) continue;
    const g = freqGroup(t.freq);
    const done = e.status === "Done";
    out.push({ who: done ? e.doneBy || e.doerId : e.doerId, system: SYSTEM_NAME[g], group: g, planned: e.plannedDate, done, onTime: done && e.actual.slice(0, 10) <= e.plannedDate });
  }
  const flowById = new Map(src.flows.map((f) => [f.flowId, f]));
  const itemById = new Map(src.items.map((i) => [i.itemId, i]));
  for (const t of src.tasks) {
    if (t.status === "Skipped" || !t.planned) continue;
    const item = itemById.get(t.itemId), flow = flowById.get(t.flowId);
    if (!item || !flow || item.status === "Cancelled") continue;
    const step = flow.steps.find((s) => s.stepId === t.stepId);
    if (!step || step.autoDone) continue; // steps ticked off automatically would only pad the numbers
    const done = t.status === "Done";
    out.push({ who: done ? t.doneBy || t.assigneeId : t.assigneeId, system: `${flow.name} · ${step.name}`, group: "FMS", planned: t.planned.slice(0, 10), done, onTime: done && t.actual <= t.planned });
  }
  return out;
}

export interface Tally { planned: number; due: number; done: number; doneOnTime: number; upcoming: number }
const zero = (): Tally => ({ planned: 0, due: 0, done: 0, doneOnTime: 0, upcoming: 0 });
function tally(units: Unit[], from: string, to: string, today: string): Tally {
  const t = zero();
  for (const u of units) {
    if (u.planned < from || u.planned > to) continue;
    t.planned++;
    if (u.planned > today) { t.upcoming++; continue; } // not due yet: neither done nor not done
    t.due++;
    if (u.done) t.done++;
    if (u.onTime) t.doneOnTime++;
  }
  return t;
}
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export interface ScoreRow {
  system: string; group: SystemGroup; planned: number; due: number; done: number; doneOnTime: number; upcoming: number;
  notDone: number; notOnTime: number; notDonePct: number; notOnTimePct: number;
  /** same percentages one week earlier (null when nothing was due then) */
  lastNotDonePct: number | null; lastNotOnTimePct: number | null; nextPlanned: number;
}
function row(system: string, group: SystemGroup, units: Unit[], ws: string, today: string): ScoreRow {
  const cur = tally(units, ws, weekEndOf(ws), today);
  const last = tally(units, addDays(ws, -7), addDays(ws, -1), today);
  const next = tally(units, addDays(ws, 7), addDays(ws, 13), today);
  return {
    system, group, ...cur, notDone: cur.due - cur.done, notOnTime: cur.due - cur.doneOnTime, notDonePct: pct(cur.due - cur.done, cur.due), notOnTimePct: pct(cur.due - cur.doneOnTime, cur.due),
    lastNotDonePct: last.due ? pct(last.due - last.done, last.due) : null, lastNotOnTimePct: last.due ? pct(last.due - last.doneOnTime, last.due) : null, nextPlanned: next.planned,
  };
}

export interface WeekCard { person: string; weekStart: string; weekEnd: string; rows: ScoreRow[]; total: ScoreRow; /** 100 − % not done on time; null when nothing was due */ score: number | null }

/** One person's week, one row per system plus a total. */
export function weekCard(units: Unit[], person: string, weekStart: string, today: string): WeekCard {
  const mine = units.filter((u) => u.who === person);
  const bySystem = new Map<string, Unit[]>();
  for (const u of mine) (bySystem.get(u.system) ?? bySystem.set(u.system, []).get(u.system)!).push(u);
  const lo = addDays(weekStart, -7), hi = addDays(weekStart, 13);
  const rows = [...bySystem.entries()]
    .filter(([, us]) => us.some((u) => u.planned >= lo && u.planned <= hi))
    .map(([system, us]) => row(system, us[0].group, us, weekStart, today))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.system.localeCompare(b.system));
  const total = row("All work", "FMS", mine, weekStart, today);
  return { person, weekStart, weekEnd: weekEndOf(weekStart), rows, total, score: total.due ? Math.round((100 - total.notOnTimePct) * 10) / 10 : null };
}

export interface TeamRow { person: string; total: ScoreRow; score: number | null; /** % not done on time, oldest → newest, for the weeks before and including this one */ trend: (number | null)[] }

/** Everybody's totals for a week, with a small trend of the last weeks. */
export function teamWeek(units: Unit[], weekStart: string, today: string, trendWeeks = 6): TeamRow[] {
  const by = new Map<string, Unit[]>();
  for (const u of units) (by.get(u.who) ?? by.set(u.who, []).get(u.who)!).push(u);
  const rows: TeamRow[] = [];
  for (const [person, us] of by) {
    const total = row("All work", "FMS", us, weekStart, today);
    if (!total.planned && !total.lastNotOnTimePct && !total.nextPlanned) continue;
    const trend: (number | null)[] = [];
    for (let k = trendWeeks - 1; k >= 0; k--) {
      const t = tally(us, addDays(weekStart, -7 * k), addDays(weekStart, -7 * k + 6), today);
      trend.push(t.due ? pct(t.due - t.doneOnTime, t.due) : null);
    }
    rows.push({ person, total, score: total.due ? Math.round((100 - total.notOnTimePct) * 10) / 10 : null, trend });
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.total.due - a.total.due);
}

/** green: within the benchmark · amber: up to 2× · red: worse */
export function scoreTone(notPct: number, benchmark: number): "green" | "amber" | "red" {
  return notPct <= benchmark ? "green" : notPct <= benchmark * 2 ? "amber" : "red";
}
