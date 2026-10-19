/**
 * Payroll from attendance: the monthly pay of each person (salary structure), the month's attendance turned into paid days and loss of pay,
 * "waive-off" of single days, and ready-made draft slips. Only people who run payroll (module "payroll", beyond "view own") reach any of this.
 * An employee never sees their salary figures on screen: they download the finished slip.
 */
import { attSettings, calFrom, personDays } from "../../lib/attendance.ts";
import type { AttendanceRow, LeaveRow } from "../../lib/flow-types.ts";
import { calcPay, daysInMonthOf, type PayCalc, type PayWaiver } from "../../lib/payroll-calc.ts";
import { fail, forbid, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { isPeriod, lines, preparesFor } from "./payroll.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");
const money = (n: number) => Math.round(n * 100) / 100;
const parse = (json: unknown): { label: string; amount: number }[] => { try { const v = JSON.parse(String(json || "[]")); return Array.isArray(v) ? v : []; } catch { return []; } };
const sum = (l: { amount: number }[]) => money(l.reduce((a, x) => a + (Number(x.amount) || 0), 0));

/** Set (or change) what a person earns each month, and the deductions that are the same every month (PF, tax …). */
export async function saveStructure(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "edit", "Only people who run payroll can set a salary");
  const userId = str(d.userId);
  const user = await ctx.user(userId);
  require_(user && user.status === "Active" && user.deleted !== "Y", "Choose the employee");
  forbid(userId !== ctx.actorId || ctx.isSuper, "You cannot set your own salary");
  forbid(await preparesFor(ctx, userId), "That person is outside your payroll access");
  const earnings = lines(d.earnings, "earnings"), deductions = lines(d.deductions, "deductions");
  require_(earnings.length > 0, "Add at least one monthly earning (for example Basic)");
  require_(sum(deductions) <= sum(earnings), "The fixed deductions are more than the earnings");
  const rows = await ctx.tx.rows("Salary_Structure");
  const have = rows.find((r) => r.userId === userId);
  const next = { earningsJson: JSON.stringify(earnings), deductionsJson: JSON.stringify(deductions), note: str(d.note).slice(0, 200), updatedBy: ctx.actorId, updatedAt: ctx.clock.stamp };
  if (have) { ctx.tx.audit("Salary changed", "Salary_Structure", userId, { gross: sum(parse(have.earningsJson)) }, { gross: sum(earnings), note: next.note }); Object.assign(have, next); }
  else { ctx.tx.insert("Salary_Structure", { userId, ...next }); ctx.tx.audit("Salary set", "Salary_Structure", userId, null, { gross: sum(earnings) }); }
  return { userId, gross: sum(earnings) };
}

/** Everybody payroll looks after, with their monthly pay (never sent to anyone else). */
export async function listStructures(ctx: Ctx) {
  const reach = await ctx.reach("payroll");
  const prepares = ctx.isSuper || ["create", "edit", "approve", "manage", "import"].some((a) => ctx.allow("payroll", a as never));
  forbid(prepares, "You cannot see salaries");
  const rows = (await ctx.tx.rows("Salary_Structure")).filter((r) => (reach.all || reach.ids.has(String(r.userId))) && (r.userId !== ctx.actorId || ctx.isSuper));
  return { structures: rows.map((r) => ({ userId: r.userId, earnings: parse(r.earningsJson), deductions: parse(r.deductionsJson), gross: sum(parse(r.earningsJson)), note: r.note, updatedAt: r.updatedAt })) };
}

interface Row {
  userId: string; name: string; empCode: string; department: string; hasStructure: boolean; gross: number; fixedDeductions: number;
  calc: PayCalc | null; net: number | null; slip: { slipId: string; status: string } | null; waivers: (PayWaiver & { waiverId: string })[];
}

async function compute(ctx: Ctx, period: string): Promise<{ rows: Row[]; provisional: boolean }> {
  require_(isPeriod(period), "Choose the month");
  require_(period <= ctx.clock.date.slice(0, 7), "That month has not come yet");
  const from = `${period}-01`, to = `${period}-${String(daysInMonthOf(period)).padStart(2, "0")}`;
  const reach = await ctx.reach("payroll");
  const users = (await ctx.tx.rows("Users")).filter((u) => u.deleted !== "Y" && u.status === "Active" && (u.userId !== ctx.actorId || ctx.isSuper) && (reach.all || reach.ids.has(String(u.userId))));
  const holidays = alive(await ctx.tx.rows("Holidays")).filter((h) => h.published !== "N");
  const cal = calFrom(ctx.settings, holidays as unknown as { date: string; flowId?: string }[]);
  const set = attSettings(ctx.settings);
  const att = alive(await ctx.tx.rows("Attendance")).filter((a) => String(a.date) >= from && String(a.date) <= to) as unknown as AttendanceRow[];
  const leaves = (await ctx.tx.rows("Leaves")).filter((l) => l.status === "Approved") as unknown as LeaveRow[];
  const structs = new Map((await ctx.tx.rows("Salary_Structure")).map((r) => [String(r.userId), r]));
  const waivers = alive(await ctx.tx.rows("Pay_Waivers")).filter((w) => w.period === period);
  const slips = alive(await ctx.tx.rows("Salary_Slips")).filter((s) => s.period === period);
  const marks = Number(ctx.setting("PAY_LATE_MARKS", "0")) || 0;
  const rows: Row[] = [];
  for (const u of users) {
    const id = String(u.userId);
    if (!(await preparesFor(ctx, id))) continue;
    const st = structs.get(id);
    const earnings = st ? parse(st.earningsJson) : [], fixed = st ? parse(st.deductionsJson) : [];
    const gross = sum(earnings), fixedSum = sum(fixed);
    const mine = waivers.filter((w) => w.userId === id).map((w) => ({ waiverId: String(w.waiverId), date: String(w.date), kind: String(w.kind) as "absent" | "late", reason: String(w.reason) }));
    const tracked = att.some((a) => a.userId === id) || leaves.some((l) => l.userId === id && l.startDate <= to && l.endDate >= from);
    // someone with no attendance at all in the month (not on the system yet) is paid in full: nothing to measure
    const days = tracked ? personDays(att, leaves, id, from, to, ctx.clock.dt, cal, set) : [];
    const calc = st ? calcPay({ period, days, gross, waivers: mine, lateMarksPerHalf: marks }) : null;
    const slip = slips.find((s) => s.userId === id);
    rows.push({
      userId: id, name: String(u.name), empCode: String(u.empCode ?? ""), department: String(u.department ?? ""), hasStructure: !!st, gross, fixedDeductions: fixedSum, calc,
      net: calc ? money(gross - fixedSum - calc.lopAmount - calc.lateAmount) : null, slip: slip ? { slipId: String(slip.slipId), status: String(slip.status) } : null, waivers: mine,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, provisional: period === ctx.clock.date.slice(0, 7) };
}

/** The month at a glance: who was present, absent (loss of pay), what was waived, and the pay that follows. Nothing is written. */
export async function payrollPreview(ctx: Ctx, d: Record<string, unknown>) {
  const prepares = ctx.isSuper || ["create", "edit", "approve", "manage", "import"].some((a) => ctx.allow("payroll", a as never));
  forbid(prepares, "You cannot see payroll");
  const { rows, provisional } = await compute(ctx, str(d.period));
  return { period: str(d.period), provisional, lateMarks: Number(ctx.setting("PAY_LATE_MARKS", "0")) || 0, rows };
}

/** Pay (or do not deduct for) one day. `waive: false` takes the waiver back. */
export async function setPayWaiver(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "edit", "Only people who run payroll can waive a deduction");
  const userId = str(d.userId), period = str(d.period), date = str(d.date), kind = str(d.kind);
  require_(["absent", "late"].includes(kind), "Choose absent or late");
  require_(isPeriod(period) && isDate(date) && date.slice(0, 7) === period, "The day must be inside that month");
  forbid(userId !== ctx.actorId || ctx.isSuper, "You cannot waive your own deduction");
  forbid(await preparesFor(ctx, userId), "That person is outside your payroll access");
  const { rows } = await compute(ctx, period);
  const row = rows.find((r) => r.userId === userId);
  require_(row?.calc, "That person has no salary set yet");
  const isThere = kind === "absent" ? row.calc.absentDates.includes(date) || row.calc.halfDates.includes(date) : row.calc.lateDates.includes(date);
  require_(isThere, kind === "absent" ? "That day was not an absence or a half day" : "That day was not a late arrival");
  const all = await ctx.tx.rows("Pay_Waivers");
  const have = all.find((w) => w.userId === userId && w.period === period && w.date === date && w.kind === kind && w.deleted !== "Y");
  if (d.waive === false) {
    require_(have, "That day was not waived");
    have.deleted = "Y";
    ctx.tx.audit("Pay waiver removed", "Pay_Waivers", String(have.waiverId), { date, kind }, null);
    return { removed: true };
  }
  require_(!have, "That day is already waived");
  require_(str(d.reason), "Write why it is waived (it stays in the record)");
  const w = ctx.tx.insert("Pay_Waivers", { waiverId: newId("PWV"), userId, period, date, kind, reason: str(d.reason).slice(0, 200), by: ctx.actorId, at: ctx.clock.stamp, deleted: "" });
  ctx.tx.audit("Pay waived off", "Pay_Waivers", String(w.waiverId), null, { employee: userId, date, kind, reason: w.reason });
  return pub("Pay_Waivers", w);
}

/** Draft slips for the month, worked out from attendance. A slip that is already published is never touched; an earlier draft is replaced. */
export async function generatePaySlips(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("payroll", "create", "You cannot prepare salary slips");
  const period = str(d.period);
  const { rows, provisional } = await compute(ctx, period);
  const want = new Set((Array.isArray(d.userIds) ? d.userIds : []).map(str).filter(Boolean));
  const slips = await ctx.tx.rows("Salary_Slips");
  const structs = new Map((await ctx.tx.rows("Salary_Structure")).map((r) => [String(r.userId), r]));
  let made = 0, replaced = 0; const skipped: string[] = [];
  for (const r of rows) {
    if (want.size && !want.has(r.userId)) continue;
    if (!r.calc || !r.hasStructure) { skipped.push(`${r.name}: no salary set`); continue; }
    const old = alive(slips).find((s) => s.userId === r.userId && s.period === period);
    if (old && old.status === "Published") { skipped.push(`${r.name}: slip already published`); continue; }
    const st = structs.get(r.userId)!;
    const earnings = parse(st.earningsJson), deductions = parse(st.deductionsJson);
    if (r.calc.lopAmount > 0) deductions.push({ label: `Loss of pay (${r.calc.lopDays} day${r.calc.lopDays === 1 ? "" : "s"})`, amount: r.calc.lopAmount });
    if (r.calc.lateAmount > 0) deductions.push({ label: `Late arrivals (${r.calc.lateDeductDays} day)`, amount: r.calc.lateAmount });
    const gross = sum(earnings), ded = sum(deductions);
    require_(ded <= gross, `${r.name}: the deductions are more than the earnings`);
    const waived = r.waivers.length ? ` Waived off: ${r.waivers.map((w) => `${w.date.slice(8)}/${w.date.slice(5, 7)} (${w.reason})`).join("; ").slice(0, 200)}.` : "";
    const att = { daysInMonth: r.calc.daysInMonth, present: r.calc.present, half: r.calc.half, leave: r.calc.leave, off: r.calc.offDays, lop: r.calc.lopDays, late: r.calc.lateDates.length, lateDeducted: r.calc.lateDeductDays, waived: r.waivers.length, provisional };
    const fields = { daysPaid: r.calc.paidDays, earningsJson: JSON.stringify(earnings), deductionsJson: JSON.stringify(deductions), gross, totalDeductions: ded, net: money(gross - ded), note: `Worked out from attendance.${waived}`.slice(0, 300), attJson: JSON.stringify(att) };
    if (old) { Object.assign(old, fields); replaced++; ctx.tx.audit("Salary slip regenerated", "Salary_Slips", String(old.slipId), null, { employee: r.userId, period, net: fields.net }); }
    else { const s = ctx.tx.insert("Salary_Slips", { slipId: newId("SLP"), userId: r.userId, period, ...fields, status: "Draft", createdBy: ctx.actorId, createdAt: ctx.clock.stamp, publishedBy: "", publishedAt: "", viewedAt: "", deleted: "", emailedAt: "" }); made++; ctx.tx.audit("Salary slip prepared", "Salary_Slips", String(s.slipId), null, { employee: r.userId, period, from: "attendance" }); }
  }
  if (!made && !replaced && skipped.length) fail("VALIDATION", skipped[0]);
  return { made, replaced, skipped, provisional };
}
