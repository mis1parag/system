/** Credential Vault. Secrets are encrypted at rest and only ever leave the server through `revealVault`, which checks access and writes the activity log. */
import { decryptSecret, encryptSecret, vaultKey } from "../vault-crypto.ts";
import { fail, forbid, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { allows, parsePermSet, stringifyPermSet } from "../../lib/permissions.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");
const keyOrFail = (): Buffer => { const k = vaultKey(); if (!k) fail("VAULT_OFF", "The Credential Vault is not set up on this server (no VAULT_KEY). Ask the person who installed the app."); return k as Buffer; };
const safeUrl = (u: string) => { if (!u) return ""; require_(/^https?:\/\/[^\s]+$/i.test(u), "The login URL must start with http:// or https://"); return u.slice(0, 500); };

/** Super Admin and people who may manage the vault see everything; everyone else only what was assigned to them. */
async function visibleItems(ctx: Ctx) {
  const items = alive(await ctx.tx.rows("Vault_Items"));
  const access = alive(await ctx.tx.rows("Vault_Access"));
  const all = ctx.isSuper || ctx.allow("vault", "manage");
  const mine = new Map(access.filter((a) => a.userId === ctx.actorId).map((a) => [String(a.vaultId), a]));
  return { items: items.filter((i) => all || mine.has(String(i.vaultId))), access, mine, all };
}

export async function listVault(ctx: Ctx) {
  ctx.require("vault", "view");
  const { items, access, mine, all } = await visibleItems(ctx);
  return {
    enabled: !!vaultKey(),
    items: items.map((i) => ({
      vaultId: i.vaultId, service: i.service, username: i.username, loginUrl: i.loginUrl, category: i.category, notes: i.notes, createdBy: i.createdBy, updatedAt: i.updatedAt,
      canReveal: all || mine.get(String(i.vaultId))?.canReveal === "Y",
      sharedWith: all ? alive(access).filter((a) => a.vaultId === i.vaultId).map((a) => ({ userId: a.userId, canReveal: a.canReveal === "Y" })) : undefined,
    })),
  };
}

/** The only way a secret leaves the server. Every call is written to the activity log (who, which service, reveal or copy) — never the secret itself. */
export async function revealVault(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("vault", "view");
  const key = keyOrFail();
  const { items, mine, all } = await visibleItems(ctx);
  const item = items.find((i) => i.vaultId === str(d.vaultId));
  forbid(item, "You do not have access to this login");
  forbid(all || mine.get(String(item.vaultId))?.canReveal === "Y", "You may use this login but not reveal its password");
  require_(item.secretEnc, "No password is stored for this login");
  let secret = "";
  try { secret = decryptSecret(String(item.secretEnc), key); } catch { fail("VAULT_KEY", "This password cannot be decrypted with the server key"); }
  ctx.tx.audit(str(d.purpose) === "copy" ? "Credential copied" : "Credential revealed", "Vault_Items", String(item.vaultId), null, { service: item.service, username: item.username });
  return { secret, vaultId: item.vaultId };
}

export async function saveVault(ctx: Ctx, d: Record<string, unknown>) {
  const id = str(d.vaultId);
  ctx.require("vault", id ? "edit" : "create", "You cannot add or change logins");
  const key = keyOrFail();
  const service = str(d.service);
  require_(service, "Name the service (for example Shopify)");
  const items = await ctx.tx.rows("Vault_Items");
  let rec = id ? alive(items).find((i) => i.vaultId === id) : undefined;
  require_(!id || rec, "Unknown login");
  if (rec && !(ctx.isSuper || ctx.allow("vault", "manage") || rec.createdBy === ctx.actorId)) fail("FORBIDDEN", "You cannot change this login");
  const secret = str(d.secret);
  if (!rec) require_(secret, "Enter the password");
  const fields = { service: service.slice(0, 80), username: str(d.username).slice(0, 120), loginUrl: safeUrl(str(d.loginUrl)), category: str(d.category).slice(0, 40), notes: str(d.notes).slice(0, 300) };
  if (!rec) {
    rec = ctx.tx.insert("Vault_Items", { vaultId: newId("VLT"), ...fields, secretEnc: encryptSecret(secret, key), createdBy: ctx.actorId, createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, deleted: "" });
    // the person who adds a login can always use it
    ctx.tx.insert("Vault_Access", { accessId: newId("VAC"), vaultId: rec.vaultId, userId: ctx.actorId, canReveal: "Y", grantedBy: ctx.actorId, grantedAt: ctx.clock.stamp, deleted: "" });
    ctx.tx.audit("Credential created", "Vault_Items", String(rec.vaultId), null, { service: fields.service, username: fields.username });
  } else {
    Object.assign(rec, fields, { updatedAt: ctx.clock.stamp });
    if (secret) rec.secretEnc = encryptSecret(secret, key);
    ctx.tx.audit("Credential edited", "Vault_Items", String(rec.vaultId), null, { service: fields.service, passwordChanged: !!secret });
  }
  return pub("Vault_Items", rec);
}

export async function deleteVault(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("vault", "delete", "You cannot delete logins");
  const rec = alive(await ctx.tx.rows("Vault_Items")).find((i) => i.vaultId === str(d.vaultId));
  require_(rec, "Unknown login");
  if (!(ctx.isSuper || ctx.allow("vault", "manage") || rec.createdBy === ctx.actorId)) fail("FORBIDDEN", "You cannot delete this login");
  rec.deleted = "Y";
  for (const a of alive(await ctx.tx.rows("Vault_Access")).filter((x) => x.vaultId === rec.vaultId)) a.deleted = "Y";
  ctx.tx.audit("Credential deleted", "Vault_Items", String(rec.vaultId), { service: rec.service }, null);
  return { vaultId: rec.vaultId };
}

/** Who may use a login. `users` = [{ userId, canReveal }]; people not listed lose access. */
export async function assignVault(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("vault", "assign", "You cannot share logins");
  const item = alive(await ctx.tx.rows("Vault_Items")).find((i) => i.vaultId === str(d.vaultId));
  require_(item, "Unknown login");
  if (!(ctx.isSuper || ctx.allow("vault", "manage") || item.createdBy === ctx.actorId)) fail("FORBIDDEN", "You cannot share this login");
  const want = new Map((Array.isArray(d.users) ? (d.users as { userId?: unknown; canReveal?: unknown }[]) : []).map((u) => [str(u.userId), u.canReveal === true || u.canReveal === "Y"]));
  const known = new Set((await ctx.tx.rows("Users")).filter((u) => u.status === "Active").map((u) => String(u.userId)));
  for (const id of want.keys()) require_(known.has(id), "Choose active people");
  want.set(String(item.createdBy), true); // the owner always keeps access
  const rows = await ctx.tx.rows("Vault_Access");
  const mine = rows.filter((a) => a.vaultId === item.vaultId);
  for (const a of mine) {
    if (!want.has(String(a.userId))) { if (a.deleted !== "Y") a.deleted = "Y"; continue; }
    a.deleted = ""; a.canReveal = want.get(String(a.userId)) ? "Y" : "N";
  }
  for (const [userId, reveal] of want) {
    if (mine.some((a) => a.userId === userId)) continue;
    ctx.tx.insert("Vault_Access", { accessId: newId("VAC"), vaultId: item.vaultId, userId, canReveal: reveal ? "Y" : "N", grantedBy: ctx.actorId, grantedAt: ctx.clock.stamp, deleted: "" });
    ctx.notice({ userId, type: "vault", title: `You can use a login: ${item.service}`, body: "Open Credential Vault.", link: "/flows/vault" });
  }
  // Being on a login's list is not enough: the Vault screen and API need the module "Credential Vault · view". A person who is given a login therefore gets that
  // (own records only — they still see just what is assigned to them); when their last login is taken away, the access we added is taken away again.
  const people = await ctx.tx.rows("Users");
  const live = alive(await ctx.tx.rows("Vault_Access"));
  const moduleChanges: string[] = [];
  for (const u of people) {
    const id = String(u.userId);
    const hasLogin = live.some((a) => a.userId === id);
    const can = allows(ctx.permsOf(u), "vault", "view");
    if (hasLogin && !can && u.role !== "SUPER_ADMIN") {
      const over = parsePermSet(u.permsJson);
      over.vault = { a: ["view"], s: "own" };
      u.permsJson = stringifyPermSet(over);
      moduleChanges.push(`+${id}`);
      ctx.notice({ userId: id, type: "access", title: "You can now open the Credential Vault", body: "You see only the logins given to you.", link: "/flows/vault" });
    } else if (!hasLogin && can && u.role !== "SUPER_ADMIN" && want.size && mine.some((a) => a.userId === id)) {
      const over = parsePermSet(u.permsJson);
      const g = over.vault;
      if (g && g.a.length === 1 && g.a[0] === "view" && g.s === "own") { delete over.vault; u.permsJson = stringifyPermSet(over); moduleChanges.push(`-${id}`); }
    }
  }
  ctx.tx.audit("Credential access changed", "Vault_Items", String(item.vaultId), null, { service: item.service, people: [...want.keys()], vaultModule: moduleChanges.join(" ") });
  return { vaultId: item.vaultId };
}
