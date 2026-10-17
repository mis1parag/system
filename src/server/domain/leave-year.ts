/** Leave, year by year: the company policy of each year, a person's own allowance and adjustments, and the balances worked out from them (see yearBalance in lib/attendance.ts). */
import { calFrom, yearBalance, type LeaveAdjustRow, type LeavePolicyRow } from "../../lib/attendance.ts";
import type { LeaveRow } from "../../lib/flow-types.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: unknown) => { const n = Number(v); return v === "" || v === null || v === undefined || isNaN(n) ? NaN : n; };
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");
const isYear = (y: string) => /^\d{4}$/.test(y) && Number(y) >= 2000 && Number(y) <= 2100;

export const policyRows = (rows: Rec[]): LeavePolicyRow[] => rows.map((p) => ({ year: String(p.year), allot: Number(p.allot) || 0, carryMax: Number(p.carryMax) || 0, carryUntil: String(p.carryUntil ?? "") }));
export const adjustRows = (rows: Rec[]): LeaveAdjustRow[] => alive(rows).map((a) => ({ userId: String(a.userId), year: String(a.year), allot: a.allot === null || a.allot === "" ? null : Number(a.allot), delta: Number(a.delta) || 0 }));

/** The year's balance of one person, with the company holidays applied. */
export async function balanceOf(ctx: Ctx, userId: string, year: string) {
  const [pol, adj, leaves, user, hol] = await Promise.all([ctx.tx.rows("Leave_Policy"), ctx.tx.rows("Leave_Adjust"), ctx.tx.rows("Leaves"), ctx.user(userId), ctx.tx.rows("Holidays")]);
  const cal = calFrom(ctx.settings, alive(hol).filter((h) => h.published !== "N") as unknown as { date: string; flowId?: string }[]);
  return yearBalance({ userId, year, leaves: leaves as unknown as LeaveRow[], policies: policyRows(pol), adjusts: adjustRows(adj), profileAllot: Number(user?.leaveAllot) || 0, cal, today: ctx.clock.date });
}

/** Leave page data: the policy of every year, and the balance of this person (or of everyone in reach) for the chosen year. */
export async function getLeaveYear(ctx: Ctx, d: Record<string, unknown>) {
  const year = str(d.year) || ctx.clock.date.slice(0, 4);
  require_(isYear(year), "Choose a valid year");
  const reach = await ctx.reach("attendance");
  const users = (await ctx.tx.rows("Users")).filter((u) => u.status === "Active");
  const wanted = str(d.userId);
  let ids: string[];
  if (wanted) { await ctx.requireInReach(wanted); ids = [wanted]; }
  else ids = (d.everyone === true ? users.filter((u) => reach.all || reach.ids.has(String(u.userId))) : users.filter((u) => u.userId === ctx.actorId)).map((u) => String(u.userId));
  const [pol, adj] = await Promise.all([ctx.tx.rows("Leave_Policy"), ctx.tx.rows("Leave_Adjust")]);
  const balances = [];
  for (const id of ids) balances.push({ userId: id, ...(await balanceOf(ctx, id, year)) });
  const set = new Set(ids);
  const years = [...new Set([year, ctx.clock.date.slice(0, 4), ...pol.map((p) => String(p.year))])].sort();
  return {
    year, years, policy: policyRows(pol).sort((a, b) => a.year.localeCompare(b.year)),
    adjustments: alive(adj).filter((a) => a.year === year && set.has(String(a.userId))).map((a) => pub("Leave_Adjust", a)),
    balances,
  };
}

export async function saveLeavePolicy(ctx: Ctx, d: Record<string, unknown>) {
  const year = str(d.year);
  require_(isYear(year), "Choose a valid year (for example 2026)");
  const allot = num(d.allot), carryMax = str(d.carryMax) === "" ? 0 : num(d.carryMax), carryUntil = str(d.carryUntil);
  require_(!isNaN(allot) && allot >= 0 && allot <= 366, "Leave days for the year must be between 0 and 366");
  require_(!isNaN(carryMax) && carryMax >= 0 && carryMax <= 366, "Carry forward must be between 0 and 366 days");
  require_(carryUntil === "" || /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(carryUntil), "Use the format MM-DD for the date until which carried days can be used (for example 03-31)");
  const rows = await ctx.tx.rows("Leave_Policy");
  const have = rows.find((p) => String(p.year) === year);
  const next = { year, allot, carryMax, carryUntil, note: str(d.note).slice(0, 200), updatedBy: ctx.actorId, updatedAt: ctx.clock.stamp };
  if (have) { ctx.tx.audit("Leave policy changed", "Leave_Policy", year, { allot: have.allot, carryMax: have.carryMax, carryUntil: have.carryUntil }, next); Object.assign(have, next); }
  else { ctx.tx.insert("Leave_Policy", next); ctx.tx.audit("Leave policy added", "Leave_Policy", year, null, next); }
  return { year };
}

/** A person's own allowance for a year, and/or a manual +/- adjustment. Each call adds a row, so the history is kept. */
export async function setLeaveAdjust(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId), year = str(d.year);
  require_(isYear(year), "Choose a valid year");
  const user = await ctx.user(userId);
  require_(user && user.status === "Active", "Choose the person");
  if (!ctx.allow("attendance", "configure")) { if (!(await ctx.manages(userId))) fail("FORBIDDEN", "You cannot change this person's leave balance"); }
  const allot = str(d.allot) === "" ? null : num(d.allot), delta = str(d.delta) === "" ? 0 : num(d.delta);
  require_(allot === null || (!isNaN(allot) && allot >= 0 && allot <= 366), "Allowance must be between 0 and 366");
  require_(!isNaN(delta) && Math.abs(delta) <= 366, "Adjustment must be a number of days (for example 2 or -1.5)");
  require_(allot !== null || delta !== 0, "Enter a new allowance or an adjustment");
  require_(str(d.note), "Write the reason (it stays in the history)");
  const rec = ctx.tx.insert("Leave_Adjust", { adjId: newId("LAD"), userId, year, allot, delta, note: str(d.note).slice(0, 200), createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "" });
  ctx.tx.audit("Leave balance changed", "Leave_Adjust", String(rec.adjId), null, { user: user.name, year, allot, delta, note: str(d.note) });
  ctx.notice({ userId, type: "leave", title: `Your ${year} leave balance was changed`, body: `${allot !== null ? `Allowance ${allot} days. ` : ""}${delta ? `Adjustment ${delta > 0 ? "+" : ""}${delta} days. ` : ""}${str(d.note)}`, link: "/flows/attendance?tab=leave" });
  return { adjustment: pub("Leave_Adjust", rec), balance: await balanceOf(ctx, userId, year) };
}
