/** Client-side FMS helpers: parsing, display state, dashboard stats, performance scorecards. Pure functions. */
import { dtMs } from "../server/domain/time.ts";
import { delayMinutes, taskState } from "./flow-shared.ts";
import type { Flow, FlowItem, FlowStep, FlowTask, Priority } from "./flow-types.ts";

export { parseFlow, absentOn, delayMinutes, effectiveAssignee, taskState, type TaskState } from "./flow-shared.ts";

const dataCache = new WeakMap<FlowItem, Record<string, string | number>>();
export function itemData(item: FlowItem): Record<string, string | number> {
  const hit = dataCache.get(item);
  if (hit) return hit;
  let d: Record<string, string | number> = {};
  try { d = JSON.parse(item.dataJson) ?? {}; } catch { /* leave empty */ }
  dataCache.set(item, d);
  return d;
}
export function taskData(t: FlowTask): Record<string, string | number> {
  try { return JSON.parse(t.dataJson || "{}") ?? {}; } catch { return {}; }
}
export const tagList = (item: FlowItem) => item.tags.split(",").map((x) => x.trim()).filter(Boolean);

export const PRIORITY_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export function itemStatusLabel(flow: Flow, item: FlowItem): string {
  return item.status === "Completed" ? flow.doneLabel : item.status === "Cancelled" ? "Cancelled" : flow.openLabel;
}

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}

/** Working-day SLA: the entry should be finished by the planned time of its last step, or `slaDays` after it was added, whichever is later. */
export function slaState(flow: Flow, item: FlowItem, tasks: FlowTask[], now: string): { due: string; breached: boolean; daysLeft: number } | null {
  if (!flow.slaDays) return null;
  const last = tasks.filter((t) => t.status !== "Skipped" && t.planned).map((t) => t.planned).sort().pop() ?? "";
  const due = (last || item.createdAt.slice(0, 16));
  const done = item.status === "Completed" ? item.completedAt : now;
  return { due, breached: done > due && item.status !== "Cancelled", daysLeft: Math.ceil((dtMs(due) - dtMs(now)) / 86400000) };
}

export interface FlowStats {
  entries: number; open: number; completed: number; cancelled: number; tasksOpen: number; overdue: number; dueToday: number;
  tasksDone: number; onTime: number; onTimePct: number; avgDelayMin: number; postponed: number; extended: number; avgCycleDays: number;
  byStep: { step: FlowStep; open: number; overdue: number; done: number; late: number; avgDelayMin: number; avgTatMin: number }[];
  byPerson: { userId: string; open: number; overdue: number; done: number; late: number }[];
  byGroup: { label: string; entries: number; overdue: number; late: number }[];
  trend: { label: string; done: number; late: number }[];
}

export function flowStats(flow: Flow, items: FlowItem[], tasks: FlowTask[], now: string): FlowStats {
  const itemById = new Map(items.map((i) => [i.itemId, i]));
  const live = tasks.filter((t) => t.status !== "Skipped" && itemById.get(t.itemId)?.status !== "Cancelled");
  const isOpen = (t: FlowTask) => t.status === "Pending" && itemById.get(t.itemId)?.status === "Open";
  const open = live.filter(isOpen);
  const done = live.filter((t) => t.status === "Done" && t.planned);
  const onTime = done.filter((t) => t.actual <= t.planned).length;
  const delays = done.map((t) => delayMinutes(t, now)).filter((m) => m > 0);
  const byStep = flow.steps.map((step) => {
    const mine = live.filter((t) => t.stepId === step.stepId);
    const d = mine.filter((t) => t.status === "Done" && t.planned);
    const late = d.filter((t) => t.actual > t.planned);
    const tat = d.map((t) => Math.abs(dtMs(t.actual) - dtMs(t.planned)) / 60000);
    return {
      step, open: mine.filter(isOpen).length, overdue: mine.filter((t) => isOpen(t) && taskState(t, now) === "overdue").length, done: mine.filter((t) => t.status === "Done").length,
      late: late.length, avgDelayMin: late.length ? late.reduce((a, t) => a + delayMinutes(t, now), 0) / late.length : 0, avgTatMin: tat.length ? tat.reduce((a, b) => a + b, 0) / tat.length : 0,
    };
  });
  const people = new Map<string, { userId: string; open: number; overdue: number; done: number; late: number }>();
  for (const t of live) {
    const uid = t.status === "Done" ? t.doneBy || t.assigneeId : t.assigneeId;
    const p = people.get(uid) ?? people.set(uid, { userId: uid, open: 0, overdue: 0, done: 0, late: 0 }).get(uid)!;
    if (t.status === "Done") { p.done++; if (t.planned && t.actual > t.planned) p.late++; }
    else if (isOpen(t)) { p.open++; if (taskState(t, now) === "overdue") p.overdue++; }
  }
  const groups = new Map<string, { label: string; entries: number; overdue: number; late: number }>();
  if (flow.groupField) {
    const labelOf = (it: FlowItem) => String(itemData(it)[flow.groupField] ?? "").trim() || "—";
    for (const it of items) if (it.status !== "Cancelled") (groups.get(labelOf(it)) ?? groups.set(labelOf(it), { label: labelOf(it), entries: 0, overdue: 0, late: 0 }).get(labelOf(it))!).entries++;
    for (const t of live) {
      const g = groups.get(labelOf(itemById.get(t.itemId)!));
      if (!g) continue;
      if (isOpen(t) && taskState(t, now) === "overdue") g.overdue++;
      if (t.status === "Done" && t.planned && t.actual > t.planned) g.late++;
    }
  }
  // last 14 days: steps finished per day, and how many of them were late
  const trend: FlowStats["trend"] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(dtMs(now) - i * 86400000).toISOString().slice(0, 10);
    const ds = done.filter((t) => t.actual.slice(0, 10) === day);
    trend.push({ label: day.slice(5), done: ds.length, late: ds.filter((t) => t.actual > t.planned).length });
  }
  const finished = items.filter((i) => i.status === "Completed" && i.completedAt);
  return {
    entries: items.filter((i) => i.status !== "Cancelled").length, open: items.filter((i) => i.status === "Open").length,
    completed: finished.length, cancelled: items.filter((i) => i.status === "Cancelled").length,
    tasksOpen: open.length, overdue: open.filter((t) => taskState(t, now) === "overdue").length, dueToday: open.filter((t) => taskState(t, now) === "today").length,
    tasksDone: done.length, onTime, onTimePct: done.length ? (onTime / done.length) * 100 : 0,
    avgDelayMin: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0, postponed: items.filter((i) => i.postponeCount > 0).length,
    extended: live.filter((t) => t.extCount > 0).length,
    avgCycleDays: finished.length ? finished.reduce((a, i) => a + (dtMs(i.completedAt) - dtMs(i.createdAt)) / 86400000, 0) / finished.length : 0,
    byStep, byPerson: [...people.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    byGroup: [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.entries - a.entries), trend,
  };
}

// ---------- performance scorecards ----------
export interface Scorecard {
  userId: string; due: number; doneOnTime: number; doneLate: number; pending: number; overdue: number; skippedCover: number;
  onTimePct: number; completionPct: number; avgDelayMin: number; score: number;
}

/**
 * Per person, for steps whose planned time falls in [from, to] (dates, inclusive):
 *   Score = on-time steps ÷ steps that were due, ×100  (open steps that are already overdue count as not on time).
 * Steps done by a backup count for the backup; steps cancelled or skipped are ignored.
 */
export function scorecards(flows: Flow[], items: FlowItem[], tasks: FlowTask[], from: string, to: string, now: string): Scorecard[] {
  const itemById = new Map(items.map((i) => [i.itemId, i]));
  const flowIds = new Set(flows.map((f) => f.flowId));
  const rows = new Map<string, Scorecard & { delays: number[] }>();
  const card = (u: string) => rows.get(u) ?? rows.set(u, { userId: u, due: 0, doneOnTime: 0, doneLate: 0, pending: 0, overdue: 0, skippedCover: 0, onTimePct: 0, completionPct: 0, avgDelayMin: 0, score: 0, delays: [] }).get(u)!;
  for (const t of tasks) {
    const it = itemById.get(t.itemId);
    if (!it || it.status === "Cancelled" || t.status === "Skipped" || !t.planned || !flowIds.has(t.flowId)) continue;
    const day = t.planned.slice(0, 10);
    if (day < from || day > to) continue;
    const who = t.status === "Done" ? t.doneBy || t.assigneeId : t.assigneeId;
    const c = card(who);
    c.due++;
    if (t.status === "Done") {
      if (t.actual <= t.planned) c.doneOnTime++; else { c.doneLate++; c.delays.push(delayMinutes(t, now)); }
    } else {
      c.pending++;
      if (t.planned < now) { c.overdue++; c.delays.push(delayMinutes(t, now)); }
    }
  }
  return [...rows.values()].map((c) => {
    const { delays, ...rest } = c;
    return {
      ...rest, onTimePct: c.due ? (c.doneOnTime / c.due) * 100 : 0, completionPct: c.due ? ((c.doneOnTime + c.doneLate) / c.due) * 100 : 0,
      avgDelayMin: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0, score: c.due ? Math.round((c.doneOnTime / c.due) * 100) : 0,
    };
  }).sort((a, b) => b.score - a.score || b.due - a.due);
}

export function makeFieldKey(label: string, used: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "field";
  let key = base, n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  return key;
}

