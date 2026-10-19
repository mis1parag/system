/**
 * Which laptop / phone a person checks in from, and the camera rule.
 *  - A device is a browser with a random token (kept in that browser; only its SHA-256 is stored). Each check-in / out records which device it came from (Attendance.inDevice / outDevice).
 *  - With ATT_DEVICE_CHECK=Y a person can punch only from an Approved device. Their FIRST device registers itself; every further one waits as Pending until someone with
 *    attendance "configure" approves it (they are notified). A Blocked device is refused.
 *  - With ATT_PHOTO=R a photo taken by the camera is compulsory with every check-in / out.
 *  - Att_Exempt lists the few people excused from the laptop rule and / or the camera. Everybody else follows the rules.
 * The rules are checked here, on the server — hiding a button in the browser is not the protection.
 */
import { createHash } from "node:crypto";
import { allows } from "../../lib/permissions.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
export const deviceHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const isJpeg = (v: unknown) => typeof v === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{200,}$/.test(v) && v.length <= 45000;

export interface Exempt { device: boolean; camera: boolean; reason: string }
export async function exemptOf(ctx: Ctx, userId: string): Promise<Exempt> {
  const r = (await ctx.tx.rows("Att_Exempt")).find((x) => x.userId === userId);
  return { device: r?.device === "Y", camera: r?.camera === "Y", reason: str(r?.reason) };
}

/** What the signed-in person has to do to check in: used by the screen to show the camera / laptop notices. */
export async function rulesOf(ctx: Ctx, userId: string) {
  const ex = await exemptOf(ctx, userId);
  return { cameraRequired: ctx.setting("ATT_PHOTO", "N") === "R" && !ex.camera, deviceCheck: ctx.setting("ATT_DEVICE_CHECK", "N") === "Y" && !ex.device };
}

function attendanceAdmins(ctx: Ctx, users: Rec[]): string[] {
  return users.filter((u) => u.status === "Active" && u.deleted !== "Y" && (u.role === "SUPER_ADMIN" || allows(ctx.permsOf(u), "attendance", "configure"))).map((u) => String(u.userId));
}

/** Finds the device for this browser, or registers it: the first device of a person is approved at once, later ones wait for approval. */
async function ensureDevice(ctx: Ctx, userId: string, token: string, name: string): Promise<{ dev: Rec; fresh: boolean }> {
  const hash = deviceHash(token);
  const rows = await ctx.tx.rows("Devices");
  const found = rows.find((r) => r.userId === userId && r.tokenHash === hash);
  if (found) return { dev: found, fresh: false };
  const first = !rows.some((r) => r.userId === userId);
  const label = [name, ctx.tx.meta.device].filter(Boolean).join(" — ").slice(0, 80) || "Unnamed device";
  const dev = ctx.tx.insert("Devices", {
    deviceId: newId("DEV"), userId, tokenHash: hash, label, status: first ? "Approved" : "Pending", via: first ? "first use" : "request", createdAt: ctx.clock.stamp,
    decidedBy: first ? "system" : "", decidedAt: first ? ctx.clock.stamp : "", lastUsedAt: "", lastIp: ctx.tx.meta.ip ?? "",
  });
  ctx.tx.audit(first ? "Device registered (first use)" : "Device waiting for approval", "Devices", String(dev.deviceId), null, { user: userId, label });
  if (!first) {
    const me = await ctx.user(userId);
    for (const a of attendanceAdmins(ctx, await ctx.tx.rows("Users"))) ctx.notice({ userId: a, type: "attendance", title: `${me?.name ?? "Someone"} wants to use a new laptop / phone`, body: label, link: "/flows/devices", dedupeKey: `dev|${dev.deviceId}`, self: true });
  }
  return { dev, fresh: true };
}

/**
 * Runs before a person's own check-in / check-out. Returns the id of the device to write on the punch ("" when none is known).
 * Refuses with code DEVICE (laptop not allowed yet) or CAMERA (photo compulsory).
 */
export async function guardPunch(ctx: Ctx, d: Record<string, unknown>): Promise<string> {
  const uid = ctx.actorId;
  const ex = await exemptOf(ctx, uid);
  const token = str(d.deviceToken);
  const hasToken = token.length >= 24 && token.length <= 200;
  const check = ctx.setting("ATT_DEVICE_CHECK", "N") === "Y" && !ex.device;
  let deviceId = "";

  if (check) {
    if (!hasToken) fail("DEVICE", "This browser could not be recognised, so it cannot be registered. Allow site data / cookies for this app and try again, or ask the Super Admin.");
    const { dev, fresh } = await ensureDevice(ctx, uid, token, str(d.deviceName).slice(0, 40));
    if (dev.status === "Blocked") { fail("DEVICE", "This laptop / phone has been blocked. Ask the Super Admin."); }
    if (dev.status === "Pending") {
      if (fresh) await ctx.tx.commit(); // keep the request even though this punch is refused
      fail("DEVICE", "This laptop / phone is not registered yet. A request has been sent to the admin — you can check in once it is approved.");
    }
    deviceId = String(dev.deviceId);
  } else if (hasToken) {
    const mine = (await ctx.tx.rows("Devices")).find((r) => r.userId === uid && r.tokenHash === deviceHash(token) && r.status === "Approved");
    if (mine) deviceId = String(mine.deviceId);
  }

  if (ctx.setting("ATT_PHOTO", "N") === "R" && !ex.camera && !isJpeg(d.photo)) {
    fail("CAMERA", "A photo from your camera is compulsory for check-in and check-out. Allow the camera for this site and try again. If your camera does not work, ask the Super Admin to excuse you.");
  }
  if (deviceId) {
    const dev = (await ctx.tx.rows("Devices")).find((r) => r.deviceId === deviceId)!;
    dev.lastUsedAt = ctx.clock.stamp; dev.lastIp = ctx.tx.meta.ip ?? dev.lastIp;
  }
  return deviceId;
}

const view = (r: Rec): Record<string, unknown> => { const o = pub("Devices", r); delete o.tokenHash; return o; };

/** This person's own devices, and whether the browser they are using now is one of them. */
export async function myDevices(ctx: Ctx, d: Record<string, unknown>) {
  const token = str(d.deviceToken);
  const hash = token.length >= 24 ? deviceHash(token) : "";
  const mine = (await ctx.tx.rows("Devices")).filter((r) => r.userId === ctx.actorId);
  return { devices: mine.map((r) => ({ ...view(r), current: !!hash && r.tokenHash === hash })), ...(await rulesOf(ctx, ctx.actorId)) };
}

/** "Register this laptop": the person asks on purpose (the first one is approved at once). */
export async function registerDevice(ctx: Ctx, d: Record<string, unknown>) {
  const token = str(d.deviceToken);
  require_(token.length >= 24 && token.length <= 200, "This browser could not be recognised");
  const { dev } = await ensureDevice(ctx, ctx.actorId, token, str(d.deviceName).slice(0, 40));
  return { ...view(dev), current: true };
}

/** Everything the admin needs: all devices (pending first), and the excused people. */
export async function listDevices(ctx: Ctx) {
  ctx.require("attendance", "configure", "Only people who manage attendance settings can see the registered laptops");
  const users = new Map((await ctx.tx.rows("Users")).map((u) => [String(u.userId), u]));
  const order = { Pending: 0, Approved: 1, Blocked: 2 } as Record<string, number>;
  const devices = (await ctx.tx.rows("Devices")).map((r): Record<string, unknown> => ({ ...view(r), name: String(users.get(String(r.userId))?.name ?? "") }))
    .sort((a, b) => (order[String(a.status)] ?? 3) - (order[String(b.status)] ?? 3) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const exempt = (await ctx.tx.rows("Att_Exempt")).filter((r) => r.device === "Y" || r.camera === "Y").map((r) => ({ userId: r.userId, name: String(users.get(String(r.userId))?.name ?? ""), device: r.device === "Y", camera: r.camera === "Y", reason: r.reason, at: r.at }));
  return { devices, exempt, deviceCheck: ctx.setting("ATT_DEVICE_CHECK", "N") === "Y", photoMode: ctx.setting("ATT_PHOTO", "N") };
}

export async function decideDevice(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("attendance", "configure", "Only people who manage attendance settings can approve laptops");
  const r = (await ctx.tx.rows("Devices")).find((x) => x.deviceId === str(d.deviceId));
  require_(r, "Unknown device");
  const decision = str(d.decision);
  require_(["approve", "block"].includes(decision), "Choose approve or block");
  const to = decision === "approve" ? "Approved" : "Blocked";
  const before = r.status;
  r.status = to; r.decidedBy = ctx.actorId; r.decidedAt = ctx.clock.stamp;
  ctx.tx.audit(decision === "approve" ? "Device approved" : "Device blocked", "Devices", String(r.deviceId), { status: before }, { status: to, user: r.userId, label: r.label });
  ctx.notice({ userId: String(r.userId), type: "attendance", title: decision === "approve" ? "Your laptop / phone is approved — you can check in" : "Your laptop / phone was blocked", body: String(r.label), link: "/flows/attendance" });
  return view(r);
}

/** Excuse a person from the laptop rule and / or the compulsory camera (or take the excuse back). */
export async function saveAttExempt(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("attendance", "configure", "Only people who manage attendance settings can excuse someone");
  const uid = str(d.userId);
  const u = await ctx.user(uid);
  require_(u && u.deleted !== "Y", "Choose the person");
  const device = d.device === true, camera = d.camera === true;
  const reason = str(d.reason).slice(0, 200);
  require_(!(device || camera) || reason, "Write the reason (for example: field staff, no camera on the laptop)");
  const row = (await ctx.tx.rows("Att_Exempt")).find((r) => r.userId === uid);
  const before = row ? { device: row.device, camera: row.camera, reason: row.reason } : null;
  const next = { device: device ? "Y" : "N", camera: camera ? "Y" : "N", reason: device || camera ? reason : "" };
  if (row) Object.assign(row, next, { by: ctx.actorId, at: ctx.clock.stamp });
  else ctx.tx.insert("Att_Exempt", { userId: uid, ...next, by: ctx.actorId, at: ctx.clock.stamp });
  ctx.tx.audit("Laptop / camera excuse changed", "Att_Exempt", uid, before, { ...next, person: u!.name });
  return { userId: uid, device, camera, reason: next.reason };
}
