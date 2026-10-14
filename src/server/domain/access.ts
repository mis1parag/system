/** Roles and personal access: what a person may do. Only the Super Admin changes these. */
import { MODULES, parsePermSet, stringifyPermSet, type PermSet } from "../../lib/permissions.ts";
import { fail, newId, pub, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const SYSTEM = ["ADMIN", "MANAGER", "STAFF"];
const BASES = ["ADMIN", "MANAGER", "STAFF"];

function needSuper(ctx: Ctx) { if (!ctx.isSuper) fail("FORBIDDEN", "Only the Super Admin decides who may do what"); }

/** Create or edit a role. A built-in role (ADMIN / MANAGER / STAFF) is edited in place (its template is stored as an override). */
export async function saveRole(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const rows = await ctx.tx.rows("Roles");
  const id = str(d.roleId);
  const perms: PermSet = parsePermSet(d.perms);
  const system = SYSTEM.includes(id);
  let rec = id ? rows.find((r) => r.roleId === id) : undefined;
  if (!system) {
    const name = str(d.name);
    require_(name, "Give the role a name");
    require_(name.length <= 60, "The name is too long");
    require_(!rows.some((r) => r !== rec && r.deleted !== "Y" && String(r.name).toLowerCase() === name.toLowerCase()) && !["super admin", "admin", "manager", "team member"].includes(name.toLowerCase()), "A role with this name already exists");
    const base = str(d.base) || "STAFF";
    require_(BASES.includes(base), "Choose which built-in role this one behaves like");
    require_(!id || (rec && rec.deleted !== "Y"), "Unknown role");
    if (!rec) {
      rec = ctx.tx.insert("Roles", { roleId: newId("ROL"), name, description: str(d.description).slice(0, 200), base, permsJson: stringifyPermSet(perms), createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, deleted: "" });
      ctx.tx.audit("Role created", "Roles", String(rec.roleId), null, { name, base, perms });
    } else {
      const before = { name: rec.name, base: rec.base, perms: rec.permsJson };
      Object.assign(rec, { name, description: str(d.description).slice(0, 200), base, permsJson: stringifyPermSet(perms), updatedAt: ctx.clock.stamp });
      ctx.tx.audit("Role changed", "Roles", String(rec.roleId), before, { name, base, perms });
    }
    return pub("Roles", rec);
  }
  if (!rec) rec = ctx.tx.insert("Roles", { roleId: id, name: id, description: "", base: id, permsJson: "{}", createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, deleted: "" });
  const before = { perms: rec.permsJson };
  Object.assign(rec, { permsJson: stringifyPermSet(perms), updatedAt: ctx.clock.stamp, deleted: "" });
  ctx.tx.audit("Role changed", "Roles", id, before, { perms });
  return pub("Roles", rec);
}

/** Put a built-in role back to its original template. */
export async function resetRole(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const id = str(d.roleId);
  require_(SYSTEM.includes(id), "Only a built-in role can be reset");
  const rec = (await ctx.tx.rows("Roles")).find((r) => r.roleId === id && r.deleted !== "Y");
  if (rec) { rec.deleted = "Y"; ctx.tx.audit("Role reset", "Roles", id, { perms: rec.permsJson }, null); }
  return { roleId: id };
}

export async function deleteRole(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const id = str(d.roleId);
  const rec = (await ctx.tx.rows("Roles")).find((r) => r.roleId === id && r.deleted !== "Y");
  require_(rec && !SYSTEM.includes(id), "Only a custom role can be deleted");
  const users = (await ctx.tx.rows("Users")).filter((u) => u.roleId === id);
  for (const u of users) { u.roleId = ""; ctx.notice({ userId: String(u.userId), type: "access", title: "Your access changed", body: "Your custom role was removed; you now have the standard access of your role.", link: "/flows/panel" }); }
  rec.deleted = "Y";
  ctx.tx.audit("Role deleted", "Roles", id, { name: rec.name, people: users.length }, null);
  return { roleId: id, moved: users.length };
}

/** A person's role, custom role and personal overrides (module-by-module). `overrides: {}` = exactly what the role gives. */
export async function saveUserAccess(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const users = await ctx.tx.rows("Users");
  const u = users.find((x) => x.userId === str(d.userId));
  require_(u, "Unknown person");
  const role = str(d.role) || String(u.role);
  require_(["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"].includes(role), "Choose a role");
  const roleId = str(d.roleId);
  if (roleId) require_((await ctx.tx.rows("Roles")).some((r) => r.roleId === roleId && r.deleted !== "Y" && !SYSTEM.includes(roleId)), "Unknown custom role");
  if (u.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") require_(users.some((x) => x !== u && x.role === "SUPER_ADMIN" && x.status === "Active"), "There must be at least one active Super Admin");
  const overrides = parsePermSet(d.overrides);
  const before = { role: u.role, roleId: u.roleId, overrides: u.permsJson };
  Object.assign(u, { role, roleId: role === "SUPER_ADMIN" ? "" : roleId, permsJson: role === "SUPER_ADMIN" ? "" : Object.keys(overrides).length ? stringifyPermSet(overrides) : "" });
  ctx.tx.audit("Access changed", "Users", String(u.userId), before, { role, roleId: u.roleId, overrides });
  if (u.userId !== ctx.actorId) ctx.notice({ userId: String(u.userId), type: "access", title: "Your access was changed", body: "The Super Admin changed what you can open. Your menu may look different.", link: "/flows/panel" });
  return { userId: u.userId, role, roleId: u.roleId, modules: MODULES.map((m) => m.id) };
}

/** Rename a department everywhere it is used (people, the FMS that are limited to it, checklist tasks, entries). Merging is the same thing: rename it to an existing name. */
export async function renameDepartment(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const from = str(d.from), to = str(d.to);
  require_(from && to, "Give the old and the new name");
  require_(to.length <= 60 && !to.includes(","), "The new name is too long or has a comma");
  const same = (v: unknown) => String(v ?? "").trim().toLowerCase() === from.toLowerCase();
  let people = 0, flows = 0, tasks = 0, entries = 0;
  for (const u of await ctx.tx.rows("Users")) if (same(u.department)) { u.department = to; people++; }
  for (const f of await ctx.tx.rows("Flows")) {
    const list = String(f.departments ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (list.some(same)) { f.departments = [...new Set(list.map((x) => (same(x) ? to : x)))].join(","); flows++; }
  }
  for (const t of await ctx.tx.rows("Checklist_Tasks")) if (same(t.department)) { t.department = to; tasks++; }
  for (const i of await ctx.tx.rows("Flow_Items")) if (same(i.department)) { i.department = to; entries++; }
  require_(people + flows + tasks + entries > 0, "No such department");
  ctx.tx.audit("Department renamed", "Users", from, { name: from }, { name: to, people, flows, tasks, entries });
  return { people, flows, tasks, entries };
}
