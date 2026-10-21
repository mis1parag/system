/**
 * Monthly leaderboard: who arrived on time and who finished their work (FMS steps + checklist) — shown to everybody as a friendly ranking.
 * Only totals are shared (days, counts, a score), never a punch, a task title or a salary figure.
 *   arrival %   = days checked in on time ÷ days that counted (present, half day or absent; leave, weekly off and holidays do not count)
 *   work %      = tasks finished by their planned time ÷ tasks that were due (FMS steps + checklist tasks planned in the month, up to today)
 *   score       = 40 % arrival + 60 % work (when one of them has nothing to measure, the other counts fully)
 */
import { attSettings, calFrom, personDays } from "../../lib/attendance.ts";
import type { AttendanceRow, LeaveRow } from "../../lib/flow-types.ts";
import { require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

export interface BoardRow {
  userId: string; name: string; department: string; rank: number | null;
  days: number; onTime: number; late: number; arrivalPct: number | null;
  fmsDue: number; fmsDone: number; fmsOnTime: number; clDue: number; clDone: number; clOnTime: number; workPct: number | null; score: number | null;
}

export async function getLeaderboard(ctx: Ctx, d: Record<string, unknown>) {
  const month = str(d.month) || ctx.clock.date.slice(0, 7);
  require_(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), "Choose a month");
  const from = `${month}-01`, endOfMonth = monthEnd(month);
  const to = endOfMonth < ctx.clock.date ? endOfMonth : ctx.clock.date;
  const users = (await ctx.tx.rows("Users")).filter((u) => u.deleted !== "Y" && (u.status === "Active" || (u.exitDate && String(u.exitDate) >= from)));
  const holidays = (await ctx.tx.rows("Holidays")).filter((h) => h.deleted !== "Y" && h.published !== "N");
  const cal = calFrom(ctx.settings, holidays as unknown as { date: string; flowId?: string }[]);
  const set = attSettings(ctx.settings);
  const att = (await ctx.tx.rows("Attendance")).filter((a) => a.deleted !== "Y" && String(a.date) >= from && String(a.date) <= to) as unknown as AttendanceRow[];
  const leaves = (await ctx.tx.rows("Leaves")).filter((l) => l.status === "Approved") as unknown as LeaveRow[];
  const offFlows = new Set((await ctx.tx.rows("Flows")).filter((f) => f.status === "Archived").map((f) => String(f.flowId)));
  const openItems = new Set((await ctx.tx.rows("Flow_Items")).filter((i) => i.status !== "Cancelled" && !offFlows.has(String(i.flowId))).map((i) => String(i.itemId)));
  const steps = (await ctx.tx.rows("Flow_Tasks")).filter((t) => t.status !== "Skipped" && t.planned && String(t.planned).slice(0, 10) >= from && String(t.planned).slice(0, 10) <= to && openItems.has(String(t.itemId)));
  const archivedTasks = new Set((await ctx.tx.rows("Checklist_Tasks")).filter((c) => c.status === "Archived").map((c) => String(c.ctId)));
  const cl = (await ctx.tx.rows("Checklist_Log")).filter((l) => l.status !== "Cancelled" && l.status !== "Skipped" && !archivedTasks.has(String(l.ctId)) && String(l.plannedDate) >= from && String(l.plannedDate) <= to);

  const nowDT = ctx.clock.dt;
  const rows: BoardRow[] = users.map((u) => {
    const id = String(u.userId);
    // somebody who never punched in this month (not yet on the attendance system, or the month is long gone) is not judged on arrival
    const tracked = att.some((a) => a.userId === id);
    const days = (tracked ? personDays(att, leaves, id, from, to, nowDT, cal, set) : []).filter((x) => x.status === "present" || x.status === "half" || x.status === "absent");
    const onTime = days.filter((x) => (x.status === "present" || x.status === "half") && !x.late).length;
    const late = days.filter((x) => (x.status === "present" || x.status === "half") && x.late).length;
    const mine = (r: Rec) => String(r.assigneeId) === id;
    const f = steps.filter(mine);
    const fmsDone = f.filter((t) => t.status === "Done");
    const fmsOnTime = fmsDone.filter((t) => String(t.actual) <= String(t.planned)).length;
    const c = cl.filter((l) => String(l.status === "Done" ? l.doneBy || l.doerId : l.doerId) === id);
    const clDone = c.filter((l) => l.status === "Done");
    const clOnTime = clDone.filter((l) => String(l.actual).slice(0, 10) <= String(l.plannedDate)).length;
    const due = f.length + c.length;
    const arrivalPct = days.length ? Math.round((onTime / days.length) * 100) : null;
    const workPct = due ? Math.round(((fmsOnTime + clOnTime) / due) * 100) : null;
    const score = arrivalPct === null && workPct === null ? null : arrivalPct === null ? workPct : workPct === null ? arrivalPct : Math.round(arrivalPct * 0.4 + workPct * 0.6);
    return { userId: id, name: String(u.name), department: String(u.department ?? ""), rank: null, days: days.length, onTime, late, arrivalPct, fmsDue: f.length, fmsDone: fmsDone.length, fmsOnTime, clDue: c.length, clDone: clDone.length, clOnTime, workPct, score };
  });
  const ranked = rows.filter((r) => r.score !== null && (r.days > 0 || r.fmsDue + r.clDue > 0))
    .sort((a, b) => (b.score! - a.score!) || ((b.fmsDone + b.clDone) - (a.fmsDone + a.clDone)) || (b.onTime - a.onTime) || a.name.localeCompare(b.name));
  let last = -1, lastRank = 0;
  ranked.forEach((r, i) => { r.rank = r.score === last ? lastRank : i + 1; last = r.score!; lastRank = r.rank; });
  const rest = rows.filter((r) => r.rank === null).sort((a, b) => a.name.localeCompare(b.name));
  return { month, from, to, board: [...ranked, ...rest], rule: "Score = 40% arrived on time + 60% tasks finished by their planned time (FMS steps and checklist together)." };
}
