// The fixed 30-day salary rule, worked hours, deductions and overtime — the pure calculation (no server).
//   node --no-warnings tools/test-pay30.mjs
import { calcPay, PAY_MONTH_DAYS } from "../src/lib/payroll-calc.ts";

let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
const near = (a, b) => Math.abs(a - b) < 0.011;
const section = (s) => console.log("\n" + s);

const dim = (p) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();
/** A month of days: Sundays off; `hours` for the given dates, 9 h for every other working day. `special` = { date: hoursOrStatus } */
function month(period, special = {}, opts = {}) {
  const out = [];
  for (let n = 1; n <= dim(period); n++) {
    const date = `${period}-${String(n).padStart(2, "0")}`;
    const sp = special[date];
    const off = dow(date) === 0;
    let status, hours;
    if (typeof sp === "string") { status = sp; hours = 0; }
    else if (off) { hours = sp ?? 0; status = "off"; }
    else { hours = sp ?? 9; status = hours >= 6 ? "present" : hours >= 4 ? "half" : "absent"; }
    out.push({ date, status, hours, firstIn: "", lastOut: "", late: !!opts.late?.includes(date), early: false, overtime: false, missingOut: false, punches: hours ? 1 : 0 });
  }
  return out;
}
const pay = (period, special, rules = {}, gross = 30000, waivers = [], opts) => calcPay({ period, days: month(period, special, opts), gross, waivers, rules });

section("a fixed 30-day month, whatever the calendar says");
ok(PAY_MONTH_DAYS === 30, "the salary month is 30 days");
for (const p of ["2026-02", "2026-04", "2026-10"]) { // 28, 30 and 31 days
  const c = pay(p);
  ok(c.perDay === 1000 && c.paidDays === 30 && c.lopDays === 0 && c.lopAmount === 0, `${p} (${dim(p)} days): per-day 1000, 30 paid days, nothing deducted when nobody is absent`);
}
for (const p of ["2026-02", "2026-04", "2026-10"]) {
  const wd = [10, 11, 12, 13].map((n) => `${p}-${n}`).filter((d) => dow(d) !== 0).slice(0, 2); // two working days (never a Sunday)
  const c = pay(p, { [wd[0]]: 0, [wd[1]]: 0 });
  ok(c.lopDays === 2 && c.lopAmount === 2000 && c.paidDays === 28, `${p}: two absent days cost exactly 2 × (monthly ÷ 30) = 2000 (paid days 28 of 30)`);
}
ok(pay("2026-10", {}, {}, 45000).perDay === 1500 && pay("2026-10", {}, {}, 31000).perDay === 1033.33, "per-day salary = monthly ÷ 30 (rounded to paise)");

section("deductions: full day, half day, absent");
let c = pay("2026-10", { "2026-10-05": 9, "2026-10-06": 7 });
ok(c.lopDays === 0, "a full day (hours ≥ the full-day hours) has no deduction");
c = pay("2026-10", { "2026-10-05": 4.5 });
ok(c.halfDates.length === 1 && c.lopDays === 0.5 && c.lopAmount === 500, "a half day costs half a day's salary");
c = pay("2026-10", { "2026-10-05": 0, "2026-10-06": 4.5, "2026-10-07": 1 });
ok(c.lopDays === 2.5 && c.lopAmount === 2500, "an absent day (also one with 1 hour) costs a full day, a half day half: 1 + 0.5 + 1 = " + c.lopDays);
c = pay("2026-10", { "2026-10-05": 0 }, {}, 30000, [{ date: "2026-10-05", kind: "absent", reason: "official work" }]);
ok(c.lopDays === 0 && c.waived.length === 1, "a waived-off day is paid");
c = pay("2026-10", { "2026-10-05": "leave", "2026-10-06": "holiday" });
ok(c.lopDays === 0 && c.leave === 1, "approved leave and holidays are paid days");

section("deduction in proportion to the hours worked (PAY_PRORATE = Y)");
const pr = { prorate: true, fullHours: 6 };
c = pay("2026-10", { "2026-10-05": 3 }, pr);
ok(near(c.lopDays, 0.5) && near(c.lopAmount, 500), "3 of 6 hours = half a day");
c = pay("2026-10", { "2026-10-05": 4.5 }, pr);
ok(near(c.lopDays, 0.25), "4.5 of 6 hours = a quarter of a day (a flat half day would cost 0.5)");
c = pay("2026-10", { "2026-10-05": 0 }, pr);
ok(near(c.lopDays, 1), "no hours at all = a full day");
c = pay("2026-10", { "2026-10-05": 6, "2026-10-06": 9 }, pr);
ok(c.lopDays === 0, "a full day is never touched");
c = pay("2026-10", { "2026-10-05": 3 }, pr, 30000, [{ date: "2026-10-05", kind: "absent", reason: "x" }]);
ok(c.lopDays === 0, "…and a waiver still works");

section("hours: required, worked, overtime");
c = pay("2026-10"); // October 2026: 31 days, 4 Sundays (4, 11, 18, 25) → 27 working days of 9 h
ok(c.reqHours === 27 * 9 && c.workedHours === 27 * 9 && c.overtimeHours === 0, `required ${c.reqHours} h = 27 working days × 9 h; worked ${c.workedHours} h; no overtime`);
c = pay("2026-10", { "2026-10-05": 10.5, "2026-10-06": 11 });
ok(c.overtimeHours === 3.5 && c.workedHours === 27 * 9 + 3.5, "hours beyond 9 h of a working day are overtime (1.5 + 2) and are part of the worked hours");
ok(near(c.hourlyRate, 111.11) && near(c.overtimeAmount, 3.5 * (1000 / 9)), `overtime pay = hours × (per-day ÷ 9 h) = ${c.overtimeAmount}`);
c = pay("2026-10", { "2026-10-05": 10.5 }, { otMultiplier: 1.5 });
ok(near(c.overtimeAmount, 1.5 * (1000 / 9) * 1.5), "the overtime rate multiplier applies (time and a half)");
c = pay("2026-10", { "2026-10-05": 10.5 }, { otMultiplier: 0 });
ok(c.overtimeHours === 1.5 && c.overtimeAmount === 0, "multiplier 0: overtime is shown but not paid");
c = pay("2026-10", { "2026-10-04": 5 });
ok(c.overtimeHours === 5 && c.offDays === 4, "work on a weekly off is all overtime");
c = pay("2026-10", { "2026-10-05": 9.4 }), c.x = 0;
ok(c.overtimeHours === 0, "extra time below the minimum (30 min) is not overtime");
c = pay("2026-10", { "2026-10-05": 9.6 });
ok(near(c.overtimeHours, 0.6), "extra time of 36 minutes is");
c = pay("2026-10", { "2026-10-05": "leave" });
ok(c.reqHours === 26 * 9, "a leave day is not a required working day");
const days = month("2026-10"); days[20].status = "future"; days[20].hours = 0; days[21].status = "pending"; days[21].hours = 3;
c = calcPay({ period: "2026-10", days, gross: 30000, waivers: [], rules: {} });
ok(c.reqHours === 25 * 9 && c.workedHours === 25 * 9, "days to come, and today while it is still running, are neither required nor worked yet");
c = pay("2026-10", {}, { reqHours: 8 });
ok(c.reqHours === 27 * 8 && c.overtimeHours === 27 && near(c.hourlyRate, 125), "the required hours per day can be changed (8 h): then 9 h days are 1 h of overtime each, and the hourly rate follows");

section("late marks keep working");
c = pay("2026-10", {}, { lateMarksPerHalf: 3 }, 30000, [], { late: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"] });
ok(c.lateDeductDays === 1 && c.lateAmount === 1000, "7 late marks at 3 per half day = 2 × 0.5 days");

console.log(`\n${pass} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
