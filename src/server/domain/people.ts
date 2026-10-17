/** Absence (with backup) and holidays. */
import { fail, newId, pub, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { replanAffected } from "./flows.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export async function createAbsence(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId) && str(d.userId) !== ctx.actorId && ctx.can("manageHolidays") ? str(d.userId) : ctx.actorId; // others can only mark themselves
  if (userId !== ctx.actorId) await ctx.requireInReach(userId);
  const users = await ctx.tx.rows("Users");
  const u = users.find((x) => x.userId === userId);
  require_(u && u.status === "Active", "Unknown user");
  const from = str(d.fromDate), to = str(d.toDate) || from;
  require_(isDate(from) && isDate(to), "Pick valid dates");
  require_(to >= from, '"To" cannot be before "From"');
  const backupId = str(d.backupUserId);
  const b = users.find((x) => x.userId === backupId);
  require_(b && b.status === "Active", "Choose an active backup person");
  require_(backupId !== userId, "The backup must be a different person");
  const absences = (await ctx.tx.rows("Absences")).filter((a) => a.deleted !== "Y");
  const clash = absences.find((a) => a.userId === backupId && String(a.fromDate) <= to && String(a.toDate) >= from);
  if (clash) ctx.warnings.push(`${b.name} is also away between ${clash.fromDate} and ${clash.toDate}. Pick another backup if tasks should not wait.`);
  const rec = ctx.tx.insert("Absences", { absenceId: newId("ABS"), userId, fromDate: from, toDate: to, backupUserId: backupId, reason: str(d.reason), createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "" });
  ctx.tx.audit("Absence added", "Absences", String(rec.absenceId), null, { user: u.name, from, to, backup: b.name });
  ctx.notice({ userId: backupId, type: "cover", title: `You are covering for ${u.name}`, body: `${from === to ? from : `${from} to ${to}`}. Their steps in this period show up in your tasks.`, link: "/flows/tasks" });
  return pub("Absences", rec);
}

export async function deleteAbsence(ctx: Ctx, d: Record<string, unknown>) {
  const a = (await ctx.tx.rows("Absences")).find((x) => x.absenceId === str(d.absenceId) && x.deleted !== "Y");
  require_(a, "Unknown absence");
  if (a.userId !== ctx.actorId && !(ctx.can("manageHolidays") && (await ctx.manages(String(a.userId))))) fail("FORBIDDEN", "You can only remove your own absence");
  a.deleted = "Y";
  ctx.tx.audit("Absence removed", "Absences", String(a.absenceId), pub("Absences", a), null);
  return { absenceId: a.absenceId };
}

export async function addHolidays(ctx: Ctx, d: Record<string, unknown>) {
  const dates = (Array.isArray(d.dates) ? d.dates : []).map(str).filter(Boolean);
  require_(dates.length > 0, "Add at least one date");
  require_(dates.length <= 400, "Too many dates in one go");
  const flowId = str(d.flowId);
  if (flowId) await ctx.flow(flowId);
  const rows = await ctx.tx.rows("Holidays");
  const have = new Set(rows.filter((h) => h.deleted !== "Y").map((h) => `${h.date}|${h.flowId}`));
  let added = 0, skipped = 0;
  for (const dt of dates) {
    require_(isDate(dt), `"${dt}" is not a valid date (use yyyy-MM-dd)`);
    if (have.has(`${dt}|${flowId}`)) { skipped++; continue; }
    have.add(`${dt}|${flowId}`);
    ctx.tx.insert("Holidays", { holidayId: newId("HOL"), date: dt, label: str(d.label), flowId, deleted: "", published: d.published === false ? "N" : "Y", note: "" });
    added++;
  }
  const replanned = await replanAffected(ctx, flowId);
  ctx.tx.audit("Holidays added", "Holidays", "", null, { added, flow: flowId || "all", replanned });
  return { added, skipped, replanned };
}

export async function deleteHoliday(ctx: Ctx, d: Record<string, unknown>) {
  const h = (await ctx.tx.rows("Holidays")).find((x) => x.holidayId === str(d.holidayId) && x.deleted !== "Y");
  require_(h, "Unknown holiday");
  h.deleted = "Y";
  const replanned = await replanAffected(ctx, String(h.flowId));
  ctx.tx.audit("Holiday removed", "Holidays", String(h.holidayId), { date: h.date }, null);
  return { holidayId: h.holidayId, replanned };
}
