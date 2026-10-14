/** Saved filters: a person's named combinations of search, quick filter and conditions for one page. */
import { fail, newId, pub, require_ } from "../sheets/db.ts";
import { pageModule } from "./read.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export async function saveFilter(ctx: Ctx, d: Record<string, unknown>) {
  const page = str(d.page).slice(0, 40);
  require_(/^[a-z0-9:_-]+$/i.test(page), "Unknown page");
  ctx.require(pageModule(page), "view");
  const name = str(d.name).slice(0, 60);
  require_(name, "Give the filter a name");
  const params = JSON.stringify(d.params ?? {});
  require_(params.length <= 4000, "This filter is too big");
  const shared = d.shared === true || d.shared === "Y";
  if (shared) ctx.require(pageModule(page), "manage", "Only people who manage this module can share filters");
  const rows = await ctx.tx.rows("Saved_Filters");
  let rec = str(d.filterId) ? rows.find((r) => r.filterId === str(d.filterId) && r.deleted !== "Y") : undefined;
  require_(!str(d.filterId) || rec, "Unknown filter");
  if (rec && rec.userId !== ctx.actorId) fail("FORBIDDEN", "This filter belongs to someone else");
  const isDefault = d.isDefault === true || d.isDefault === "Y";
  if (isDefault) for (const r of rows) if (r.userId === ctx.actorId && r.page === page && r.deleted !== "Y") r.isDefault = "N";
  const fields = { page, name, paramsJson: params, isDefault: isDefault ? "Y" : "N", shared: shared ? "Y" : "N", updatedAt: ctx.clock.stamp };
  if (!rec) rec = ctx.tx.insert("Saved_Filters", { filterId: newId("FLT"), userId: ctx.actorId, ...fields, createdAt: ctx.clock.stamp, deleted: "" });
  else Object.assign(rec, fields);
  return pub("Saved_Filters", rec);
}

export async function deleteFilter(ctx: Ctx, d: Record<string, unknown>) {
  const rec = (await ctx.tx.rows("Saved_Filters")).find((r) => r.filterId === str(d.filterId) && r.deleted !== "Y");
  require_(rec, "Unknown filter");
  if (rec.userId !== ctx.actorId) fail("FORBIDDEN", "This filter belongs to someone else");
  rec.deleted = "Y";
  return { filterId: rec.filterId };
}
