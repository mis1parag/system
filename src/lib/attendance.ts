// Attendance rules, the way the owner's "Attendance System" sheet works (and its "Calculate attendance" script):
//  • working days = every day except the weekly-off days and holidays;
//  • hours of a day = all check-in → check-out pairs added up; ≥ 6 h = full day, ≥ 4 h = half day, less = absent;
//  • late = first check-in after 09:30, early = last check-out before 17:00; Sunday (off-day) work of 4 h+ = overtime;
//  • attendance % = (full days + ½ × half days) ÷ working days; on-time arrival % = (days present − late days) ÷ days present.
// Pure functions shared by the browser and the tests. No path aliases, no Node APIs.
import { addDays, minutesBetween, weekday } from "../server/domain/time.ts";
import type { AttendanceRow, LeaveRow, LeaveType } from "./flow-types.ts";

export interface AttSettings { lateAfter: string; earlyBefore: string; fullHours: number; halfHours: number; stdHours: number }
export const attSettings = (s: Record<string, string> = {}): AttSettings => ({
  lateAfter: s.ATT_LATE_AFTER || "09:30", earlyBefore: s.ATT_EARLY_BEFORE || "17:00", fullHours: Number(s.ATT_FULL_HOURS) || 6, halfHours: Number(s.ATT_HALF_HOURS) || 4, stdHours: Number(s.ATT_STD_HOURS) || 9,
});

export interface Cal { off: Set<number>; holidays: Set<string> }
export function calFrom(settings: Record<string, string> = {}, holidays: { date: string; flowId?: string }[] = []): Cal {
  const off = new Set(String(settings.WEEKLY_OFF ?? "0").split(",").map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).map(Number));
  return { off, holidays: new Set(holidays.filter((h) => !h.flowId).map((h) => h.date)) };
}
const isHoliday = (d: string, c: Cal) => c.holidays.has(d);
const isOff = (d: string, c: Cal) => c.off.has(weekday(d));
const hm = (dt: string) => dt.slice(11, 16);

export type DayStatus = "present" | "half" | "absent" | "leave" | "off" | "holiday" | "pending" | "future";
export interface DayInfo {
  date: string; status: DayStatus; hours: number; firstIn: string; lastOut: string; late: boolean; early: boolean; overtime: boolean; missingOut: boolean;
  leaveType?: LeaveType; punches: number;
}

/** Days from `from` to `to` for one person. `nowDT` is the current wall-clock time (to count the hours of a running check-in). */
export function personDays(rows: AttendanceRow[], leaves: LeaveRow[], userId: string, from: string, to: string, nowDT: string, cal: Cal, set: AttSettings): DayInfo[] {
  const today = nowDT.slice(0, 10);
  const byDate = new Map<string, AttendanceRow[]>();
  for (const r of rows) if (r.userId === userId && r.date >= from && r.date <= to) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  const mine = leaves.filter((l) => l.userId === userId && l.status === "Approved");
  const out: DayInfo[] = [];
  for (let d = from, g = 0; d <= to && g++ < 800; d = addDays(d, 1)) {
    const list = (byDate.get(d) ?? []).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    let mins = 0, missingOut = false;
    for (const r of list) {
      if (r.checkOut) mins += Math.max(0, minutesBetween(r.checkIn, r.checkOut));
      else if (d === today) mins += Math.max(0, minutesBetween(r.checkIn, nowDT));
      else missingOut = true; // a past day that was never closed: the hours are unknown
    }
    const hours = Math.round((mins / 60) * 100) / 100;
    const firstIn = list[0]?.checkIn ?? "";
    const closed = [...list].reverse().find((r) => r.checkOut);
    const lastOut = list.some((r) => !r.checkOut) && d === today ? "" : closed?.checkOut ?? "";
    const base: DayInfo = { date: d, status: "future", hours, firstIn, lastOut, late: false, early: false, overtime: false, missingOut, punches: list.length };
    if (d > today) { out.push(base); continue; }
    if (isHoliday(d, cal) || isOff(d, cal)) {
      out.push({ ...base, status: isHoliday(d, cal) ? "holiday" : "off", overtime: isOff(d, cal) && hours >= set.halfHours });
      continue;
    }
    const leave = mine.find((l) => l.startDate <= d && l.endDate >= d);
    let status: DayStatus;
    if (hours >= set.fullHours) status = "present";
    else if (hours >= set.halfHours) status = "half";
    else if (leave && leave.type === "Full Day") status = "leave";
    else if (leave && (leave.type === "First Half Day" || leave.type === "Second Half Day")) status = "half";
    else if (d === today && (list.some((r) => !r.checkOut) || nowDT.slice(11, 16) < "18:30")) status = "pending";
    else status = "absent";
    const present = status === "present" || status === "half";
    out.push({
      ...base, status, leaveType: leave?.type, late: present && !!firstIn && hm(firstIn) > set.lateAfter,
      early: present && !!lastOut && hm(lastOut) < set.earlyBefore,
    });
  }
  return out;
}

export interface PersonReport {
  userId: string; workingDays: number; present: number; half: number; absent: number; leave: number; late: number; early: number; overtime: number; totalHours: number;
  /** (full + ½ half) ÷ working days, % */ attendancePct: number;
  /** (days present − late days) ÷ days present, % */ onTimePct: number;
  /** hours worked ÷ (working days × normal hours), % */ hoursPct: number;
  missingOut: number; days: DayInfo[];
}

export function personReport(userId: string, days: DayInfo[], set: AttSettings): PersonReport {
  let present = 0, half = 0, absent = 0, leave = 0, late = 0, early = 0, overtime = 0, hours = 0, missing = 0, working = 0;
  for (const d of days) {
    if (d.overtime) overtime++;
    if (d.missingOut) missing++;
    if (d.status === "present") present++;
    else if (d.status === "half") half++;
    else if (d.status === "absent") absent++;
    else if (d.status === "leave") leave++;
    if (d.status === "present" || d.status === "half" || d.status === "absent" || d.status === "leave") { working++; hours += d.hours; }
    if (d.late) late++;
    if (d.early) early++;
  }
  const attended = present + half;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    userId, workingDays: working, present, half, absent, leave, late, early, overtime, totalHours: Math.round(hours * 100) / 100,
    attendancePct: working ? r1(((present + 0.5 * half) / working) * 100) : 0, onTimePct: attended ? r1(((attended - late) / attended) * 100) : 0,
    hoursPct: working ? r1((hours / (working * set.stdHours)) * 100) : 0, missingOut: missing, days,
  };
}

/** Everyone's report for a date range. */
export function teamReport(userIds: string[], rows: AttendanceRow[], leaves: LeaveRow[], from: string, to: string, nowDT: string, cal: Cal, set: AttSettings): PersonReport[] {
  return userIds.map((id) => personReport(id, personDays(rows, leaves, id, from, to, nowDT, cal, set), set));
}

/** Days a leave takes off the balance: working days of a Full Day leave, ½ for a half day, nothing for a short leave. */
export function leaveDays(type: LeaveType | string, start: string, end: string, cal: Cal): number {
  if (type === "Short Leave") return 0;
  if (type === "First Half Day" || type === "Second Half Day") return 0.5;
  let n = 0;
  for (let d = start, g = 0; d <= end && g++ < 400; d = addDays(d, 1)) if (!isOff(d, cal) && !isHoliday(d, cal)) n++;
  return n;
}

export interface LeaveBalance { allot: number; used: number; pending: number; left: number }
export function leaveBalance(allot: number, leaves: LeaveRow[], userId: string, year: string): LeaveBalance {
  const mine = leaves.filter((l) => l.userId === userId && l.startDate.slice(0, 4) === year);
  const used = mine.filter((l) => l.status === "Approved").reduce((a, l) => a + l.days, 0);
  const pending = mine.filter((l) => l.status === "Pending").reduce((a, l) => a + l.days, 0);
  return { allot, used, pending, left: allot - used };
}

export const STATUS_LABEL: Record<DayStatus, string> = { present: "Present", half: "Half day", absent: "Absent", leave: "On leave", off: "Weekly off", holiday: "Holiday", pending: "Not yet", future: "" };
export const fmtHours = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
