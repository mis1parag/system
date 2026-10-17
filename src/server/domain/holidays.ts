/** Company holidays: add, edit, delete and publish. Only published holidays count as days off (planning, attendance, leave); a draft is visible to the people who manage holidays only. */
import { newId, pub, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { replanAffected } from "./flows.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** Create or change one holiday. `published` N keeps it as a draft. */
export async function saveHoliday(ctx: Ctx, d: Record<string, unknown>) {
  const date = str(d.date), label = str(d.label).slice(0, 80);
  require_(isDate(date), "Choose a valid date");
  require_(label, "Give the holiday a name (for example Diwali)");
  const flowId = str(d.flowId);
  if (flowId) await ctx.flow(flowId);
  const published = d.published === false || str(d.published) === "N" ? "N" : "Y";
  const rows = await ctx.tx.rows("Holidays");
  const id = str(d.holidayId);
  const existing = id ? rows.find((h) => h.holidayId === id && h.deleted !== "Y") : undefined;
  require_(!id || existing, "Unknown holiday");
  const clash = rows.find((h) => h.deleted !== "Y" && h.date === date && String(h.flowId) === flowId && h !== existing);
  require_(!clash, `${date} is already a holiday (${clash?.label || "no name"})`);
  let rec = existing;
  const before = existing ? { date: existing.date, label: existing.label, published: existing.published || "Y" } : null;
  if (existing) Object.assign(existing, { date, label, flowId, published, note: str(d.note).slice(0, 200) });
  else rec = ctx.tx.insert("Holidays", { holidayId: newId("HOL"), date, label, flowId, deleted: "", published, note: str(d.note).slice(0, 200) });
  const replanned = await replanAffected(ctx, flowId);
  ctx.tx.audit(existing ? "Holiday edited" : "Holiday added", "Holidays", String(rec!.holidayId), before, { date, label, published, flow: flowId || "all" });
  return { holiday: pub("Holidays", rec!), replanned };
}

/** Publish (or take back to draft) holidays: one, a list, or a whole year. */
export async function publishHolidays(ctx: Ctx, d: Record<string, unknown>) {
  const publish = d.publish !== false;
  const year = str(d.year);
  const ids = new Set((Array.isArray(d.holidayIds) ? d.holidayIds : []).map(str).filter(Boolean));
  require_(year || ids.size, "Choose a year or the holidays to publish");
  if (year) require_(/^\d{4}$/.test(year), "Year must look like 2026");
  const rows = (await ctx.tx.rows("Holidays")).filter((h) => h.deleted !== "Y" && (ids.size ? ids.has(String(h.holidayId)) : String(h.date).slice(0, 4) === year));
  let changed = 0;
  for (const h of rows) { const now = publish ? "Y" : "N"; if ((h.published || "Y") !== now) { h.published = now; changed++; } }
  const replanned = changed ? await replanAffected(ctx, "") : 0;
  ctx.tx.audit(publish ? "Holidays published" : "Holidays unpublished", "Holidays", year || [...ids].join(","), null, { changed, replanned });
  return { changed, replanned };
}
