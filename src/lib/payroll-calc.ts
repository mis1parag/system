// Salary from attendance — one set of rules for the preview, the slips and the tests.
//   per day  = monthly gross ÷ days in the month (weekly offs and holidays are paid days)
//   loss of pay (LOP) = an absent working day (1) or a half day (½) that nobody waived
//   late marks: with a limit set (PAY_LATE_MARKS = n) every n late arrivals that were not waived cost half a day
//   paid leave, holidays, weekly offs and days still to come are paid
//   "waived off": payroll can waive a single absent / half / late day with a reason — it is paid, and the slip says so
import type { DayInfo } from "./attendance.ts";

export interface PayWaiver { date: string; kind: "absent" | "late"; reason: string }
export interface PayCalc {
  daysInMonth: number; present: number; half: number; leave: number; offDays: number; absentDates: string[]; halfDates: string[]; lateDates: string[];
  waived: PayWaiver[]; lopDays: number; lateDeductDays: number; paidDays: number; perDay: number; lopAmount: number; lateAmount: number;
}

export const daysInMonthOf = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcPay(args: { period: string; days: DayInfo[]; gross: number; waivers: PayWaiver[]; lateMarksPerHalf: number }): PayCalc {
  const { period, days, gross, waivers, lateMarksPerHalf } = args;
  const dim = daysInMonthOf(period);
  const wAbsent = new Map(waivers.filter((w) => w.kind === "absent").map((w) => [w.date, w]));
  const wLate = new Map(waivers.filter((w) => w.kind === "late").map((w) => [w.date, w]));
  const absentDates = days.filter((d) => d.status === "absent").map((d) => d.date);
  const halfDates = days.filter((d) => d.status === "half").map((d) => d.date);
  const lateDates = days.filter((d) => (d.status === "present" || d.status === "half") && d.late).map((d) => d.date);
  const lopAbsent = absentDates.filter((d) => !wAbsent.has(d)).length;
  const lopHalf = halfDates.filter((d) => !wAbsent.has(d)).length * 0.5;
  const lateCounted = lateDates.filter((d) => !wLate.has(d)).length;
  const lateDeductDays = lateMarksPerHalf > 0 ? Math.floor(lateCounted / lateMarksPerHalf) * 0.5 : 0;
  const lopDays = lopAbsent + lopHalf;
  const perDay = gross / dim;
  const used = [...absentDates, ...halfDates].filter((d) => wAbsent.has(d)).map((d) => wAbsent.get(d)!).concat(lateDates.filter((d) => wLate.has(d)).map((d) => wLate.get(d)!));
  return {
    daysInMonth: dim, present: days.filter((d) => d.status === "present").length, half: halfDates.length, leave: days.filter((d) => d.status === "leave").length,
    offDays: days.filter((d) => d.status === "off" || d.status === "holiday").length, absentDates, halfDates, lateDates, waived: used,
    lopDays, lateDeductDays, paidDays: round2(dim - lopDays - lateDeductDays), perDay: round2(perDay), lopAmount: round2(perDay * lopDays), lateAmount: round2(perDay * lateDeductDays),
  };
}
