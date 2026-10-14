/** Login, PIN handling and the team (users). */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { Db, fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx, loadSettings } from "./ctx.ts";
import { addMinutes, clockNow } from "./time.ts";

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"];
const digits10 = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; };
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export function hashPin(pin: string): string {
  const salt = randomBytes(8).toString("hex");
  return `s1$${salt}$${scryptSync(pin, salt, 32, { N: 16384 }).toString("hex")}`;
}
export function checkPin(pin: string, stored: string): boolean {
  const [v, salt, hash] = String(stored ?? "").split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const a = scryptSync(pin, salt, 32, { N: 16384 });
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface LoginUser { userId: string; name: string; role: string }

/** Verify credentials. Five wrong PINs lock the account for 15 minutes (counter lives in the sheet, so it holds across servers). */
export async function login(db: Db, identifier: string, pin: string, meta: { ip?: string; device?: string } = {}): Promise<LoginUser> {
  const id = str(identifier).toLowerCase();
  require_(id && str(pin), "Enter your mobile / email / user ID and PIN");
  const settings = await loadSettings(db);
  const clock = clockNow(settings.TIMEZONE);
  const tx = db.begin("login");
  tx.stamp = clock.stamp;
  tx.meta = meta;
  const users = await tx.rows("Users");
  const d = digits10(id);
  const user = users.find((u) => String(u.userId).toLowerCase() === id || (u.email && String(u.email).toLowerCase() === id) || (d.length === 10 && digits10(u.mobile) === d));
  if (!user || user.status !== "Active") fail("AUTH", "Wrong ID or PIN");
  const u = user as Rec;
  if (u.lockedUntil && String(u.lockedUntil) > clock.dt) fail("LOCKED", "Too many wrong attempts. Try again in a few minutes.");
  if (!checkPin(str(pin), String(u.pinHash))) {
    u.failCount = Number(u.failCount) + 1;
    if (Number(u.failCount) >= 5) { u.lockedUntil = addMinutes(clock.dt, 15); u.failCount = 0; }
    tx.audit("Login failed", "Users", String(u.userId));
    await tx.commit();
    fail("AUTH", "Wrong ID or PIN");
  }
  if (Number(u.failCount) || u.lockedUntil) { u.failCount = 0; u.lockedUntil = ""; }
  tx.audit("Login", "Users", String(u.userId));
  await tx.commit();
  return { userId: String(u.userId), name: String(u.name), role: String(u.role) };
}

/** Writes one line to the activity log for something that is not an action (a sign-out). */
export async function recordEvent(db: Db, userId: string, action: string, meta: { ip?: string; device?: string } = {}) {
  const settings = await loadSettings(db);
  const tx = db.begin(userId);
  tx.stamp = clockNow(settings.TIMEZONE).stamp;
  tx.meta = meta;
  tx.audit(action, "Users", userId);
  await tx.commit();
}

/**
 * Create or edit a user. Super Admin manages everyone; an Admin can only add / edit Staff
 * (so an Admin cannot promote themselves or create another admin).
 */
export async function saveUser(ctx: Ctx, rec: Record<string, unknown>) {
  const users = await ctx.tx.rows("Users");
  const id = str(rec.userId);
  const existing = id ? users.find((u) => u.userId === id) : undefined;
  require_(!id || existing, `Unknown user ${id}`);
  ctx.require("employees", existing ? "edit" : "create", "You cannot add or change people");
  if (existing) await ctx.requireInReach(id, "employees");
  const name = str(rec.name), role = str(rec.role) || String(existing?.role ?? "STAFF");
  require_(name, "Name is required");
  require_(ROLES.includes(role), "Role must be SUPER_ADMIN, ADMIN, MANAGER or STAFF");
  // nobody can hand out (or take away) Admin / Super Admin rights except the Super Admin
  if (!ctx.isSuper && (!["STAFF", "MANAGER"].includes(role) || (existing && !["STAFF", "MANAGER"].includes(String(existing.role))))) fail("FORBIDDEN", "Only the Super Admin can add or change Admins");
  const mobile = digits10(rec.mobile);
  const email = str(rec.email).toLowerCase();
  require_(mobile.length === 10 || (mobile === "" && /^\S+@\S+\.\S+$/.test(email)), "Enter a 10-digit mobile number — or leave it empty and give an email to sign in with");
  // a new person added by a Manager joins that Manager's department and reports to them unless told otherwise
  const department = rec.department === undefined ? String(existing?.department ?? (ctx.isSuper ? "" : ctx.actor.department ?? "")) : str(rec.department);
  const empCode = rec.empCode === undefined ? String(existing?.empCode ?? "") : str(rec.empCode);
  const leaveAllot = rec.leaveAllot === undefined || rec.leaveAllot === "" ? Number(existing?.leaveAllot ?? 0) : Number(rec.leaveAllot);
  require_(!isNaN(leaveAllot) && leaveAllot >= 0 && leaveAllot <= 366, "Leave allotted must be a number of days between 0 and 366");
  if (empCode) require_(!users.some((x) => x !== existing && String(x.empCode).toLowerCase() === empCode.toLowerCase()), `Employee ID ${empCode} is already used by someone else`);
  const status = str(rec.status) || "Active";
  require_(["Active", "Inactive"].includes(status), "Status must be Active or Inactive");
  const clash = users.find((x) => x !== existing && ((mobile && digits10(x.mobile) === mobile) || (email && String(x.email).toLowerCase() === email)));
  require_(!clash, `Another user already uses this mobile / email (${clash?.userId})`);
  const pin = str(rec.pin);
  if (pin) require_(/^\d{4,8}$/.test(pin), "PIN must be 4-8 digits");
  if (!existing) require_(pin, "Set a PIN for the new user");
  if (existing && existing.role === "SUPER_ADMIN" && (role !== "SUPER_ADMIN" || status !== "Active")) {
    require_(users.some((x) => x !== existing && x.role === "SUPER_ADMIN" && x.status === "Active"), "There must be at least one active Super Admin");
  }
  const manager = rec.managerId === undefined ? (existing ? String(existing.managerId ?? "") : ctx.isSuper ? "" : ctx.actorId) : str(rec.managerId);
  if (manager) require_(users.some((x) => x.userId === manager && x.status === "Active") && manager !== id, "Pick an active person as manager");
  const notify = str(rec.notify) === "" && existing ? String(existing.notify) : str(rec.notify).split(",").map((x) => x.trim()).filter((x) => ["app", "email", "whatsapp"].includes(x)).join(",") || "app";

  if (!existing) {
    const u = ctx.tx.insert("Users", {
      userId: newId("USR"), name, role, mobile, email, status, managerId: manager, notify, pinHash: hashPin(pin), failCount: 0, lockedUntil: "", createdAt: ctx.clock.stamp, department, empCode, leaveAllot,
    });
    ctx.tx.audit("User created", "Users", String(u.userId), null, { name, role });
    return pub("Users", u);
  }
  const before = { name: existing.name, role: existing.role, mobile: existing.mobile, email: existing.email, status: existing.status, managerId: existing.managerId };
  Object.assign(existing, { name, role, mobile, email, status, managerId: manager, notify, department, empCode, leaveAllot });
  if (pin) existing.pinHash = hashPin(pin);
  ctx.tx.audit("User edited", "Users", String(existing.userId), before, { name, role, mobile, email, status, managerId: manager, pinChanged: !!pin });
  return pub("Users", existing);
}

export interface Credential { name: string; login: string; pin: string; role: string; department: string }

/**
 * Add many people at once (paste from a sheet). Someone who is already there (same email, else same name) is updated instead: department / email are filled in
 * and a status can be set. New people get a random PIN, returned ONCE so the admin can hand it over.
 */
export async function bulkSaveUsers(ctx: Ctx, d: Record<string, unknown>) {
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  require_(rows.length > 0, "Add at least one person");
  require_(rows.length <= 150, "Add at most 150 people at a time");
  const credentials: Credential[] = [];
  const skipped: { row: number; name: string; reason: string }[] = [];
  let created = 0, updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = str(r.name);
    if (!name) { skipped.push({ row: i + 1, name: "", reason: "No name" }); continue; }
    const email = str(r.email).toLowerCase();
    const users = await ctx.tx.rows("Users");
    const existing = users.find((u) => (email && String(u.email).toLowerCase() === email) || (!email && String(u.name).toLowerCase() === name.toLowerCase())) ?? users.find((u) => String(u.name).toLowerCase() === name.toLowerCase() && !String(u.email));
    const role = str(r.role).toUpperCase().replace(/\s+/g, "_") || (existing ? String(existing.role) : "STAFF");
    const status = str(r.status) === "Inactive" ? "Inactive" : str(r.status) === "Active" ? "Active" : existing ? String(existing.status) : "Active";
    try {
      if (existing) {
        await saveUser(ctx, { userId: existing.userId, name: existing.name, role: existing.role, mobile: existing.mobile, email: String(existing.email) || email, department: str(r.department) || String(existing.department ?? ""), empCode: str(r.empCode) || String(existing.empCode ?? ""), leaveAllot: r.leaveAllot === undefined || r.leaveAllot === "" ? existing.leaveAllot : r.leaveAllot, managerId: existing.managerId, notify: existing.notify, status });
        updated++;
      } else {
        const pin = /^\d{4,8}$/.test(str(r.pin)) ? str(r.pin) : String(randomInt(1000, 10000));
        await saveUser(ctx, { name, role, mobile: r.mobile, email, department: str(r.department), empCode: str(r.empCode), leaveAllot: r.leaveAllot, status, pin });
        created++;
        if (status === "Active") credentials.push({ name, login: email || digits10(r.mobile), pin, role, department: str(r.department) });
      }
    } catch (e) {
      skipped.push({ row: i + 1, name, reason: e instanceof Error ? e.message : "Failed" });
    }
  }
  ctx.tx.audit("People added (many)", "Users", "", null, { created, updated, skipped: skipped.length });
  return { created, updated, skipped, credentials };
}

/** A signed-in user changes their own PIN, or their notification choices. */
export async function updateProfile(ctx: Ctx, d: Record<string, unknown>) {
  const me = await ctx.user(ctx.actorId);
  require_(me, "Unknown user");
  if (str(d.newPin)) {
    require_(checkPin(str(d.currentPin), String(me.pinHash)), "Current PIN is wrong");
    require_(/^\d{4,8}$/.test(str(d.newPin)), "New PIN must be 4-8 digits");
    me.pinHash = hashPin(str(d.newPin));
    ctx.tx.audit("PIN changed", "Users", String(me.userId));
  }
  if (d.notify !== undefined) me.notify = str(d.notify).split(",").map((x) => x.trim()).filter((x) => ["app", "email", "whatsapp"].includes(x)).join(",") || "app";
  if (d.email !== undefined && str(d.email)) me.email = str(d.email).toLowerCase();
  return pub("Users", me);
}
