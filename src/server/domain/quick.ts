/** Quick Access: shortcuts to the tools people use. Personal ones belong to a person; company ones are set by whoever manages Quick Access. */
import { fail, newId, pub, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const url = (u: string) => { require_(/^https?:\/\/[^\s]+$/i.test(u), "The address must start with http:// or https://"); return u.slice(0, 500); };

export async function saveLink(ctx: Ctx, d: Record<string, unknown>) {
  const id = str(d.linkId);
  ctx.require("quick_access", id ? "edit" : "create");
  const title = str(d.title);
  require_(title, "Give the shortcut a name");
  const company = d.company === true;
  if (company) ctx.require("quick_access", "manage", "Only people who manage Quick Access can add company-wide shortcuts");
  const rows = await ctx.tx.rows("Quick_Links");
  let rec = id ? rows.find((r) => r.linkId === id && r.deleted !== "Y") : undefined;
  require_(!id || rec, "Unknown shortcut");
  if (rec && rec.ownerId !== ctx.actorId && !(ctx.allow("quick_access", "manage") && !rec.ownerId)) fail("FORBIDDEN", "You cannot change this shortcut");
  const fields = { title: title.slice(0, 60), url: url(str(d.url)), category: str(d.category).slice(0, 40) || "General", favorite: d.favorite === true || d.favorite === "Y" ? "Y" : "N" };
  if (!rec) {
    const mine = rows.filter((r) => r.deleted !== "Y" && r.ownerId === (company ? "" : ctx.actorId));
    rec = ctx.tx.insert("Quick_Links", { linkId: newId("QLK"), ownerId: company ? "" : ctx.actorId, ...fields, sortOrder: mine.length + 1, createdBy: ctx.actorId, createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, deleted: "" });
    if (company) ctx.tx.audit("Company shortcut added", "Quick_Links", String(rec.linkId), null, { title });
  } else Object.assign(rec, fields, { updatedAt: ctx.clock.stamp });
  return pub("Quick_Links", rec);
}

export async function deleteLink(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("quick_access", "delete");
  const rec = (await ctx.tx.rows("Quick_Links")).find((r) => r.linkId === str(d.linkId) && r.deleted !== "Y");
  require_(rec, "Unknown shortcut");
  if (rec.ownerId !== ctx.actorId && !(ctx.allow("quick_access", "manage") && !rec.ownerId)) fail("FORBIDDEN", "You cannot remove this shortcut");
  rec.deleted = "Y";
  if (!rec.ownerId) ctx.tx.audit("Company shortcut removed", "Quick_Links", String(rec.linkId), { title: rec.title }, null);
  return { linkId: rec.linkId };
}

/** Save the order of the person's own shortcuts (or the company ones, for those who manage them). */
export async function reorderLinks(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("quick_access", "edit");
  const ids = (Array.isArray(d.ids) ? d.ids : []).map(str);
  const rows = (await ctx.tx.rows("Quick_Links")).filter((r) => r.deleted !== "Y");
  ids.forEach((id, i) => {
    const r = rows.find((x) => x.linkId === id);
    if (r && (r.ownerId === ctx.actorId || (!r.ownerId && ctx.allow("quick_access", "manage")))) r.sortOrder = i + 1;
  });
  return { count: ids.length };
}

/** Copy a company shortcut into the person's own list (so they can star and reorder it). */
export async function adoptLink(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("quick_access", "create");
  const rows = await ctx.tx.rows("Quick_Links");
  const src = rows.find((r) => r.linkId === str(d.linkId) && r.deleted !== "Y" && !r.ownerId);
  require_(src, "Unknown shortcut");
  if (rows.some((r) => r.deleted !== "Y" && r.ownerId === ctx.actorId && r.url === src.url)) fail("DUPLICATE", "It is already in your shortcuts");
  const rec = ctx.tx.insert("Quick_Links", { linkId: newId("QLK"), ownerId: ctx.actorId, title: src.title, url: src.url, category: src.category, favorite: "Y", sortOrder: rows.filter((r) => r.ownerId === ctx.actorId && r.deleted !== "Y").length + 1, createdBy: ctx.actorId, createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, deleted: "" });
  return pub("Quick_Links", rec);
}
