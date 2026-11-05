// Salary from attendance — one set of rules for the preview, the slips and the tests.
//
//   FIXED 30-DAY MONTH (company policy): per day = monthly salary ÷ 30, whatever the calendar month has (28, 29, 30 or 31 days).
//   A person with no loss of pay gets exactly the monthly salary; every deduction is counted in days of that 30.
//
//   Deduction for a working day (nobody waived it):
//     full day present  → none                       (hours ≥ ATT_FULL_HOURS)
//     half day          → half a day's salary        (hours ≥ ATT_HALF_HOURS)
//     absent            → one full day's salary
//     PAY_PRORATE = Y   → instead of the flat half / full: the share of the full-day hours that was NOT worked (3 of 6 hours = half a day …)
//   Weekly offs, holidays, paid (approved) leave and days still to come are paid days.
//   Late marks: with a limit set (PAY_LATE_MARKS = n) every n late arrivals that were not waived cost half a day.
//   "Waived off": payroll can waive a single absent / half / late day with a reason — it is paid, and the slip says so.
//
//   Hours: required hours = working days × PAY_REQ_HOURS (default ATT_STD_HOURS); worked hours = everything punched.
//   Overtime: the hours beyond the required hours of a working day, and all hours worked on a weekly off / holiday — only when the extra is at least
//   PAY_OT_MIN_MINUTES. Overtime pay = overtime hours × hourly rate (per-day salary ÷ required hours per day) × PAY_OT_MULTIPLIER (0 = tracked, not paid).
import { hoursSummary, type DayInfo } from "./attendance.ts";

/** The salary month of this company is always 30 days. */
export const PAY_MONTH_DAYS = 30;

export interface PayWaiver { date: string; kind: "absent" | "late"; reason: string }
export interface PayRules {
  /** one in this many late arrivals = half a day (0 = late arrivals never cost pay) */
  lateMarksPerHalf: number;
  /** required working hours of one working day */
  reqHours: number;
  /** hours of work that make a full day (ATT_FULL_HOURS) — used by the proportional rule */
  fullHours: number;
  /** deduct in proportion to the hours NOT worked instead of a flat half / full day */
  prorate: boolean;
  /** overtime pay = hourly rate × this (0 = overtime is tracked but not paid) */
  otMultiplier: number;
  /** extra time shorter than this is not overtime */
  otMinMinutes: number;
}
export const DEFAULT_RULES: PayRules = { lateMarksPerHalf: 0, reqHours: 9, fullHours: 6, prorate: false, otMultiplier: 1, otMinMinutes: 30 };

export interface PayCalc {
  daysInMonth: number; payDays: number; present: number; half: number; leave: number; offDays: number; absentDates: string[]; halfDates: string[]; lateDates: string[];
  waived: PayWaiver[]; lopDays: number; lateDeductDays: number; paidDays: number; perDay: number; lopAmount: number; lateAmount: number;
  /** hours */
  reqHoursPerDay: number; reqHours: number; workedHours: number; overtimeHours: number; hourlyRate: number; otMultiplier: number; overtimeAmount: number; prorate: boolean;
}

export const daysInMonthOf = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcPay(args: { period: string; days: DayInfo[]; gross: number; waivers: PayWaiver[]; rules?: Partial<PayRules>; lateMarksPerHalf?: number }): PayCalc {
  const { period, days, gross, waivers } = args;
  const rules: PayRules = { ...DEFAULT_RULES, ...(args.rules ?? {}) };
  if (args.lateMarksPerHalf !== undefined) rules.lateMarksPerHalf = args.lateMarksPerHalf;
  const wAbsent = new Map(waivers.filter((w) => w.kind === "absent").map((w) => [w.date, w]));
  const wLate = new Map(waivers.filter((w) => w.kind === "late").map((w) => [w.date, w]));
  const absentDates = days.filter((d) => d.status === "absent").map((d) => d.date);
  const halfDates = days.filter((d) => d.status === "half").map((d) => d.date);
  const lateDates = days.filter((d) => (d.status === "present" || d.status === "half") && d.late).map((d) => d.date);
  const hoursOf = new Map(days.map((d) => [d.date, d.hours]));

  // loss of pay, in days of the 30-day month
  const lossOf = (date: string, flat: number) => {
    if (!rules.prorate) return flat;
    const h = hoursOf.get(date) ?? 0;
    return rules.fullHours > 0 ? Math.min(1, Math.max(0, 1 - h / rules.fullHours)) : flat;
  };
  const lopDays = round2(absentDates.filter((d) => !wAbsent.has(d)).reduce((a, d) => a + lossOf(d, 1), 0) + halfDates.filter((d) => !wAbsent.has(d)).reduce((a, d) => a + lossOf(d, 0.5), 0));
  const lateCounted = lateDates.filter((d) => !wLate.has(d)).length;
  const lateDeductDays = rules.lateMarksPerHalf > 0 ? Math.floor(lateCounted / rules.lateMarksPerHalf) * 0.5 : 0;
  const perDay = gross / PAY_MONTH_DAYS;
  const hourly = rules.reqHours > 0 ? perDay / rules.reqHours : 0;

  // hours: what was required, what was worked, what was beyond it (the same rule as the monthly report)
  const hrs = hoursSummary(days, rules.reqHours, rules.otMinMinutes);
  const reqHours = hrs.reqHours, worked = hrs.workedHours, overtime = hrs.overtimeHours;

  const used = [...absentDates, ...halfDates].filter((d) => wAbsent.has(d)).map((d) => wAbsent.get(d)!).concat(lateDates.filter((d) => wLate.has(d)).map((d) => wLate.get(d)!));
  return {
    daysInMonth: daysInMonthOf(period), payDays: PAY_MONTH_DAYS, present: days.filter((d) => d.status === "present").length, half: halfDates.length, leave: days.filter((d) => d.status === "leave").length,
    offDays: days.filter((d) => d.status === "off" || d.status === "holiday").length, absentDates, halfDates, lateDates, waived: used,
    lopDays, lateDeductDays, paidDays: round2(PAY_MONTH_DAYS - lopDays - lateDeductDays), perDay: round2(perDay), lopAmount: round2(perDay * lopDays), lateAmount: round2(perDay * lateDeductDays),
    reqHoursPerDay: rules.reqHours, reqHours: round2(reqHours), workedHours: round2(worked), overtimeHours: overtime, hourlyRate: round2(hourly), otMultiplier: rules.otMultiplier,
    overtimeAmount: round2(overtime * hourly * rules.otMultiplier), prorate: rules.prorate,
  };
}
