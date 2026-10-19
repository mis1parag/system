/** Attendance (check-in / check-out with optional GPS) and leave requests with approval. Reports are worked out in the browser from these rows (src/lib/attendance.ts). */
import { LEAVE_TYPES } from "../../lib/flow-types.ts";
import { calFrom, leaveDays, leaveDaysInYear } from "../../lib/attendance.ts";
import { balanceOf } from "./leave-year.ts";
import { allows, reachOf, scopeOfGrant } from "../../lib/permissions.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { checklistCalendar } from "./checklist.ts";
import { Ctx } from "./ctx.ts";
import { guardPunch } from "./devices.ts";
import { isDate, isTime, minutesBetween, normDT } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const coord = (v: unknown, max: number): number | null => { if (v === "" || v === null || v === undefined) return null; const n = Number(v); return !isNaN(n) && Math.abs(n) <= max ? Math.round(n * 1e7) / 1e7 : null; };
const alive = (rows: Rec[]) => rows.filter((r) => r.deleted !== "Y");

/** Keeps a small selfie (JPEG data URL, about 10-25 KB) and returns its id. A bad image is ignored: the punch itself must never fail because of a photo. */
function keepPhoto(ctx: Ctx, attId: string, userId: string, kind: "in" | "out", image: unknown): string {
  const v = typeof image === "string" ? image : "";
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 45000) return "";
  const rec = ctx.tx.insert("Attendance_Photos", { photoId: newId("PHO"), attId, userId, kind, takenAt: ctx.clock.dt, image: v });
  return String(rec.photoId);
}

function selfPunchAllowed(ctx: Ctx) { require_(ctx.allow("attendance", "manage") || ctx.setting("ATT_SELF_PUNCH", "Y") !== "N", "Check-in and check-out are done at the office kiosk. Ask reception."); }

async function punchIn(ctx: Ctx, userId: string, d: Record<string, unknown>, source: string) {
  await ctx.db.load(["Attendance"], { fresh: true }); // a double tap on two devices must not create two rows
  const today = ctx.clock.date;
  const mine = alive(await ctx.tx.rows("Attendance")).filter((r) => r.userId === userId && r.date === today);
  const open = mine.find((r) => !r.checkOut);
  require_(!open, `${userId === ctx.actorId ? "You are" : "This person is"} already checked in since ${String(open?.checkIn).slice(11, 16)}.`);
  const last = [...mine].sort((a, b) => String(b.checkOut).localeCompare(String(a.checkOut)))[0];
  require_(!last || minutesBetween(String(last.checkOut), ctx.clock.dt) >= 1, "Just checked out. Wait a minute before checking in again.");
  const attId = newId("ATT");
  return ctx.tx.insert("Attendance", {
    attId, userId, date: today, checkIn: ctx.clock.dt, checkOut: "", lat: coord(d.lat, 90), lng: coord(d.lng, 180), outLat: null, outLng: null,
    note: str(d.note).slice(0, 200), source, createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "", inPhoto: keepPhoto(ctx, attId, userId, "in", d.photo), outPhoto: "",
  });
}

async function punchOut(ctx: Ctx, userId: string, d: Record<string, unknown>) {
  await ctx.db.load(["Attendance"], { fresh: true });
  const open = alive(await ctx.tx.rows("Attendance")).filter((r) => r.userId === userId && !r.checkOut).sort((a, b) => String(b.checkIn).localeCompare(String(a.checkIn)))[0];
  require_(open, "Not checked in. Check in first.");
  require_(open.date === ctx.clock.date, `The last check-in (${open.date} ${String(open.checkIn).slice(11, 16)}) was never closed. Ask an admin to correct it.`);
  require_(minutesBetween(String(open.checkIn), ctx.clock.dt) >= 1, `${userId === ctx.actorId ? "You" : "This person"} checked in at ${String(open.checkIn).slice(11, 16)}, just now. Wait a minute before checking out (a double scan or double tap is ignored).`);
  open.checkOut = ctx.clock.dt; open.outLat = coord(d.lat, 90); open.outLng = coord(d.lng, 180);
  open.outPhoto = keepPhoto(ctx, String(open.attId), userId, "out", d.photo);
  if (str(d.note)) open.note = [open.note, str(d.note)].filter(Boolean).join(" · ").slice(0, 200);
  return open;
}

export async function checkIn(ctx: Ctx, d: Record<string, unknown>) {
  selfPunchAllowed(ctx);
  const device = await guardPunch(ctx, d); // registered laptop + compulsory camera, checked on the server
  const rec = await punchIn(ctx, ctx.actorId, d, "app");
  rec.inDevice = device;
  return pub("Attendance", rec);
}

export async function checkOut(ctx: Ctx, d: Record<string, unknown>) {
  selfPunchAllowed(ctx);
  const device = await guardPunch(ctx, d);
  const rec = await punchOut(ctx, ctx.actorId, d);
  rec.outDevice = device;
  return pub("Attendance", rec);
}

/** "I forgot to check out": a person closes their own punch from an earlier day by giving the time they left. Kept in the audit log; a manager can still correct it. */
export async function closeMyPunch(ctx: Ctx, d: Record<string, unknown>) {
  const r = alive(await ctx.tx.rows("Attendance")).find((x) => x.attId === str(d.attId));
  require_(r && r.userId === ctx.actorId, "That punch is not yours");
  require_(!r.checkOut, "That punch is already closed");
  require_(String(r.date) < ctx.clock.date, "Use Check out for today's punch");
  require_(minutesBetween(`${r.date} 12:00`, `${ctx.clock.date} 12:00`) <= 14 * 1440, "That is too long ago — ask a manager to correct it");
  require_(isTime(d.time), "Enter the time you left (for example 18:05)");
  const out = `${r.date} ${str(d.time)}`;
  require_(out > String(r.checkIn), `The check-out must be after the check-in (${String(r.checkIn).slice(11, 16)})`);
  r.checkOut = out;
  r.note = [r.note, "check-out entered later by the person"].filter(Boolean).join(" · ").slice(0, 200);
  ctx.tx.audit("Check-out entered later", "Attendance", String(r.attId), { checkOut: "" }, { checkOut: out });
  return pub("Attendance", r);
}

/** Office kiosk (an admin signed in on the reception PC): the person types or scans their Employee ID; the same tap checks them in, or out if they are already in. */
export async function kioskPunch(ctx: Ctx, d: Record<string, unknown>) {
  const code = str(d.empCode).toLowerCase();
  require_(code, "Type or scan the Employee ID");
  const users = await ctx.tx.rows("Users");
  const u = users.find((x) => str(x.empCode).toLowerCase() === code && x.status === "Active");
  require_(u, `No active person has the Employee ID "${str(d.empCode).slice(0, 30)}"`);
  await ctx.db.load(["Attendance"], { fresh: true });
  const isOut = alive(await ctx.tx.rows("Attendance")).some((r) => r.userId === u.userId && r.date === ctx.clock.date && !r.checkOut);
  const rec = isOut ? await punchOut(ctx, String(u.userId), d) : await punchIn(ctx, String(u.userId), d, "kiosk");
  return { action: isOut ? "out" : "in", name: u.name, empCode: u.empCode, time: ctx.clock.dt.slice(11, 16), attendance: pub("Attendance", rec) };
}

/** One selfie, for an admin or for the person it belongs to. */
export async function getPunchPhoto(ctx: Ctx, d: Record<string, unknown>) {
  const p = (await ctx.tx.rows("Attendance_Photos")).find((x) => x.photoId === str(d.photoId));
  require_(p, "No photo found");
  require_(p.userId === ctx.actorId || (await ctx.manages(String(p.userId))), "You can only see your own photos");
  return { photoId: p.photoId, image: p.image, takenAt: p.takenAt, kind: p.kind };
}

const at = (date: string, v: string) => (v ? (isTime(v) ? `${date} ${v}` : normDT(v) || "") : "");

/** Admin: add or correct a day's punch (forgot to check out, worked from another place, …). */
export async function markAttendance(ctx: Ctx, d: Record<string, unknown>) {
  const users = await ctx.tx.rows("Users");
  const rows = await ctx.tx.rows("Attendance");
  const existing = str(d.attId) ? rows.find((r) => r.attId === str(d.attId) && r.deleted !== "Y") : undefined;
  require_(!str(d.attId) || existing, "Unknown attendance entry");
  const userId = existing ? String(existing.userId) : str(d.userId);
  require_(users.some((u) => u.userId === userId), "Choose the person");
  await ctx.requireInReach(userId);
  const date = existing ? String(existing.date) : str(d.date);
  require_(isDate(date), "Choose a valid date");
  const cin = at(date, str(d.checkIn)), cout = at(date, str(d.checkOut));
  require_(cin, "Enter the check-in time (HH:mm)");
  require_(str(d.checkOut) === "" || cout, "Check-out time is not valid (HH:mm)");
  require_(!cout || cout >= cin, "Check-out cannot be before check-in");
  require_(cin.slice(0, 10) === date && (!cout || cout.slice(0, 10) === date), "Check-in and check-out must be on the same date");
  let rec: Rec;
  if (existing) {
    const before = { checkIn: existing.checkIn, checkOut: existing.checkOut };
    Object.assign(existing, { checkIn: cin, checkOut: cout, note: str(d.note) || existing.note });
    rec = existing;
    ctx.tx.audit("Attendance corrected", "Attendance", String(rec.attId), before, { checkIn: cin, checkOut: cout, note: str(d.note) });
  } else {
    rec = ctx.tx.insert("Attendance", { attId: newId("ATT"), userId, date, checkIn: cin, checkOut: cout, lat: null, lng: null, outLat: null, outLng: null, note: str(d.note).slice(0, 200), source: "manual", createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "", inPhoto: "", outPhoto: "" });
    ctx.tx.audit("Attendance added", "Attendance", String(rec.attId), null, { user: userId, date, checkIn: cin, checkOut: cout, note: str(d.note) });
  }
  return pub("Attendance", rec);
}

export async function deleteAttendance(ctx: Ctx, d: Record<string, unknown>) {
  const r = alive(await ctx.tx.rows("Attendance")).find((x) => x.attId === str(d.attId));
  require_(r, "Unknown attendance entry");
  await ctx.requireInReach(String(r.userId));
  r.deleted = "Y";
  ctx.tx.audit("Attendance removed", "Attendance", String(r.attId), { user: r.userId, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut }, null);
  return { attId: r.attId };
}

/** Bulk import of old punches (from the Drive "Attendance System" sheet). Rows: { userId, checkIn, checkOut, lat, lng }. Already-known punches are skipped. */
export async function importAttendance(ctx: Ctx, d: Record<string, unknown>) {
  const input = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  require_(input.length > 0, "Nothing to import");
  require_(input.length <= 2000, "Import at most 2000 rows at a time");
  const users = new Set((await ctx.tx.rows("Users")).map((u) => String(u.userId)));
  const have = new Set(alive(await ctx.tx.rows("Attendance")).map((r) => `${r.userId}|${r.checkIn}`));
  let added = 0, skipped = 0;
  const problems: string[] = [];
  for (const [i, r] of input.entries()) {
    const userId = str(r.userId), cin = normDT(r.checkIn), cout = r.checkOut ? normDT(r.checkOut) : "";
    if (!users.has(userId) || !cin || cin.length !== 16 || cout === null || (cout && cout < cin)) { skipped++; if (problems.length < 5) problems.push(`row ${i + 1}: not understood`); continue; }
    const key = `${userId}|${cin}`;
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    ctx.tx.insert("Attendance", { attId: newId("ATT"), userId, date: cin.slice(0, 10), checkIn: cin, checkOut: cout, lat: coord(r.lat, 90), lng: coord(r.lng, 180), outLat: null, outLng: null, note: "", source: "import", createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "", inPhoto: "", outPhoto: "" });
    added++;
  }
  ctx.tx.audit("Attendance imported", "Attendance", "", null, { added, skipped });
  return { added, skipped, problems };
}

// ---------------- leave ----------------

/** Who may decide a leave: an admin, or the person's manager. */
async function canDecide(ctx: Ctx, userId: string): Promise<boolean> {
  if (ctx.isSuper) return true;
  const u = await ctx.user(userId);
  if (!!u && u.managerId === ctx.actorId) return true; // the reporting manager can always decide
  if (!ctx.allow("attendance", "approve")) return false;
  const sc = await ctx.reach("attendance");
  return sc.all || sc.ids.has(userId);
}

export async function requestLeave(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId) && str(d.userId) !== ctx.actorId && ctx.allow("attendance", "manage") ? str(d.userId) : ctx.actorId;
  if (userId !== ctx.actorId) await ctx.requireInReach(userId);
  const user = await ctx.user(userId);
  require_(user && user.status === "Active", "Unknown person");
  const type = str(d.type);
  require_((LEAVE_TYPES as readonly string[]).includes(type), "Choose the type of leave");
  const start = str(d.startDate), end = type === "Full Day" ? str(d.endDate) || start : start;
  require_(isDate(start) && isDate(end), "Choose valid dates");
  require_(end >= start, "The last day cannot be before the first day");
  require_(str(d.reason), "Write a short reason");
  const backupId = str(d.backupUserId);
  if (backupId) { const b = await ctx.user(backupId); require_(b && b.status === "Active" && backupId !== userId, "The backup must be another active person"); }
  const cal = await checklistCalendar(ctx);
  const days = leaveDays(type, start, end, cal);
  require_(type !== "Full Day" || days > 0, "Those dates are all weekly-off days or holidays — no leave is needed");
  const leaves = await ctx.tx.rows("Leaves");
  const clash = leaves.find((l) => l.userId === userId && (l.status === "Pending" || l.status === "Approved") && String(l.startDate) <= end && String(l.endDate) >= start);
  require_(!clash, `There is already a ${String(clash?.status).toLowerCase()} leave on ${clash?.startDate}${clash?.endDate !== clash?.startDate ? ` – ${clash?.endDate}` : ""}`);
  // each calendar year has its own balance: check every year the leave touches
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    const year = String(y), bal = await balanceOf(ctx, userId, year);
    const here = leaveDaysInYear({ type: type as "Full Day", startDate: start, endDate: end, days }, year, calFrom(ctx.settings, (await ctx.tx.rows("Holidays")).filter((h) => h.deleted !== "Y" && h.published !== "N") as unknown as { date: string }[]));
    if (here > 0 && bal.total > 0 && bal.used + bal.pending + here > bal.total) {
      const msg = `This is more than the ${bal.total} leave days you have for ${year} (${bal.used} used, ${bal.pending} waiting, ${here} requested).`;
      require_(ctx.setting("LEAVE_BLOCK_OVERDRAW", "N") !== "Y" || ctx.allow("attendance", "manage"), msg + " Ask your manager to change the balance first.");
      ctx.warnings.push(msg + " It can still be requested.");
    }
  }
  const rec = ctx.tx.insert("Leaves", { leaveId: newId("LVE"), userId, type, startDate: start, endDate: end, days, reason: str(d.reason).slice(0, 300), backupUserId: backupId, status: "Pending", decidedBy: "", decidedAt: "", note: "", createdAt: ctx.clock.stamp });
  ctx.tx.audit("Leave requested", "Leaves", String(rec.leaveId), null, { user: user.name, type, start, end, days });
  const everyone = await ctx.tx.rows("Users");
  const approvers = user.managerId ? [String(user.managerId)] : everyone.filter((u) => {
    if (u.status !== "Active") return false;
    if (u.role === "SUPER_ADMIN") return true;
    const perms = ctx.permsOf(u);
    if (!allows(perms, "attendance", "approve")) return false;
    const r = reachOf({ userId: String(u.userId), role: String(u.role), department: String(u.department ?? "") }, everyone as never, scopeOfGrant(perms, "attendance"));
    return r.all || r.ids.has(userId);
  }).map((u) => String(u.userId));
  for (const a of approvers) ctx.notice({ userId: a, type: "leave", title: `Leave request: ${user.name}`, body: `${type} · ${start}${end !== start ? ` to ${end}` : ""} · ${str(d.reason)}`, link: "/flows/attendance?tab=leave" });
  return pub("Leaves", rec);
}

export async function decideLeave(ctx: Ctx, d: Record<string, unknown>) {
  const l = (await ctx.tx.rows("Leaves")).find((x) => x.leaveId === str(d.leaveId));
  require_(l, "Unknown leave request");
  require_(l.status === "Pending", `This request was already ${String(l.status).toLowerCase()}`);
  if (!(await canDecide(ctx, String(l.userId)))) fail("FORBIDDEN", "Only an admin or the person's manager can decide this");
  const approve = d.approve === true;
  l.status = approve ? "Approved" : "Rejected"; l.decidedBy = ctx.actorId; l.decidedAt = ctx.clock.stamp; l.note = str(d.note);
  const user = await ctx.user(String(l.userId));
  // a full-day leave with a backup also marks the absence, so the backup gets the person's FMS steps automatically
  if (approve && l.type === "Full Day" && l.backupUserId && String(l.endDate) >= ctx.clock.date) {
    ctx.tx.insert("Absences", { absenceId: newId("ABS"), userId: l.userId, fromDate: l.startDate, toDate: l.endDate, backupUserId: l.backupUserId, reason: `Leave: ${l.reason}`, createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "" });
    ctx.notice({ userId: String(l.backupUserId), type: "cover", title: `You are covering for ${user?.name ?? "a colleague"}`, body: `${l.startDate}${l.endDate !== l.startDate ? ` to ${l.endDate}` : ""} (approved leave)`, link: "/flows/tasks" });
  }
  ctx.tx.audit(approve ? "Leave approved" : "Leave rejected", "Leaves", String(l.leaveId), null, { user: user?.name, note: l.note });
  ctx.notice({ userId: String(l.userId), type: "leave", title: `Your leave was ${approve ? "approved" : "rejected"}`, body: `${l.type} · ${l.startDate}${l.endDate !== l.startDate ? ` to ${l.endDate}` : ""}${l.note ? ` — ${l.note}` : ""}`, link: "/flows/attendance?tab=leave" });
  return pub("Leaves", l);
}

export async function cancelLeave(ctx: Ctx, d: Record<string, unknown>) {
  const l = (await ctx.tx.rows("Leaves")).find((x) => x.leaveId === str(d.leaveId));
  require_(l, "Unknown leave request");
  const boss = await ctx.manages(String(l.userId));
  require_(l.status === "Pending" || (boss && l.status === "Approved"), "Only a pending request can be cancelled");
  if (!boss && l.userId !== ctx.actorId) fail("FORBIDDEN", "You can only cancel your own request");
  l.status = "Cancelled"; l.decidedBy = ctx.actorId; l.decidedAt = ctx.clock.stamp;
  ctx.tx.audit("Leave cancelled", "Leaves", String(l.leaveId), null, null);
  return pub("Leaves", l);
}

/** Bulk import of old leave requests. Rows: { userId, type, startDate, endDate, reason, status }. Same person + dates + type are skipped. */
export async function importLeaves(ctx: Ctx, d: Record<string, unknown>) {
  const input = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  require_(input.length > 0 && input.length <= 1000, "Import between 1 and 1000 leave rows");
  const users = new Set((await ctx.tx.rows("Users")).map((u) => String(u.userId)));
  const cal = await checklistCalendar(ctx);
  const have = new Set((await ctx.tx.rows("Leaves")).map((l) => `${l.userId}|${l.startDate}|${l.endDate}|${l.type}`));
  let added = 0, skipped = 0;
  for (const r of input) {
    const type = str(r.type), start = str(r.startDate), end = str(r.endDate) || start, status = str(r.status);
    if (!users.has(str(r.userId)) || !(LEAVE_TYPES as readonly string[]).includes(type) || !isDate(start) || !isDate(end) || end < start) { skipped++; continue; }
    const key = `${r.userId}|${start}|${end}|${type}`;
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    const st = /approved|accepted/i.test(status) ? "Approved" : /reject/i.test(status) ? "Rejected" : "Pending";
    ctx.tx.insert("Leaves", { leaveId: newId("LVE"), userId: str(r.userId), type, startDate: start, endDate: end, days: leaveDays(type, start, end, cal), reason: str(r.reason).slice(0, 300), backupUserId: "", status: st, decidedBy: st === "Pending" ? "" : ctx.actorId, decidedAt: st === "Pending" ? "" : ctx.clock.stamp, note: "imported", createdAt: ctx.clock.stamp });
    added++;
  }
  ctx.tx.audit("Leaves imported", "Leaves", "", null, { added, skipped });
  return { added, skipped };
}
