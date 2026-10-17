/**
 * Super Admin console: correct any record by hand (always written to the activity log with the old and the new value), bring back deleted rows,
 * download a table, find data problems, and post announcements. Only the Super Admin; nothing here is open to anyone else.
 * Left out on purpose: PIN hashes, vault secrets, private notes, access overrides and salary slips (they have their own, safer screens), the activity log (it cannot be edited).
 */
import { isDate } from "./time.ts";
import { fail, forbid, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { TABLES, type Col } from "../sheets/schema.ts";
import { refreshItemStatus } from "./engine.ts";
import { Ctx } from "./ctx.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const needSuper = (ctx: Ctx) => forbid(ctx.isSuper, "Only the Super Admin can use the console");

/** Tables the editor may open, with a label and the columns that must stay as they are. */
const EDITABLE: Record<string, { label: string; hide?: string[]; lock?: string[]; hint?: string }> = {
  Users: { label: "People", hide: ["pinHash", "permsJson"], lock: ["createdAt"], hint: "PIN and access have their own screens. Clear “Locked until” to unlock someone." },
  Flow_Items: { label: "FMS entries", lock: ["createdAt", "createdBy"], hint: "Planned times are not recalculated here — use Replan on the FMS afterwards." },
  Flow_Tasks: { label: "FMS steps", lock: ["itemId", "flowId", "stepId", "seq"], hint: "The entry's status follows its steps automatically." },
  Checklist_Tasks: { label: "Checklist tasks", lock: ["createdAt", "createdBy"] },
  Checklist_Log: { label: "Checklist days", lock: ["ctId", "createdAt"] },
  Attendance: { label: "Attendance", hide: ["inPhoto", "outPhoto"], lock: ["createdAt", "createdBy", "source"] },
  Leaves: { label: "Leave requests", lock: ["createdAt"], hint: "Status here changes the balance at once." },
  Leave_Policy: { label: "Leave policy" },
  Leave_Adjust: { label: "Leave adjustments", lock: ["createdAt", "createdBy"] },
  Holidays: { label: "Holidays" },
  Absences: { label: "Absence cover", lock: ["createdAt", "createdBy"] },
  Employee_Details: { label: "Employee details" },
  Requests: { label: "More-time requests", lock: ["itemId", "taskId", "flowId"] },
  Comments: { label: "Comments", lock: ["itemId", "flowId", "userId", "createdAt"] },
  Announcements: { label: "Announcements" },
};
const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"];

function columns(table: string): (Col & { readonly: boolean })[] {
  const e = EDITABLE[table];
  const def = TABLES[table];
  return def.cols.filter(([k]) => !(e.hide ?? []).includes(k)).map((c) => [...c, c[0] === def.idKey || (e.lock ?? []).includes(c[0]) || c[0] === "deleted"] as unknown as Col & { readonly: boolean });
}
const known = (table: string) => { forbid(!!EDITABLE[table] && !!TABLES[table], "That table cannot be opened in the console"); };

export async function adminTables(ctx: Ctx) {
  needSuper(ctx);
  const out = [];
  for (const [name, e] of Object.entries(EDITABLE)) out.push({ table: name, label: e.label, rows: (await ctx.tx.rows(name)).length, hint: e.hint ?? "", softDelete: !!TABLES[name].softDelete });
  return { tables: out };
}

/** Rows of one table, newest first, optionally filtered by text. `all` returns up to 6000 rows for a download (written to the activity log). */
export async function adminRows(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const table = str(d.table);
  known(table);
  const q = str(d.q).toLowerCase();
  const cols = columns(table);
  const withDeleted = d.deleted === true;
  const all = [...(await ctx.tx.rows(table))].reverse().filter((r) => (withDeleted || r.deleted !== "Y"));
  const found = q ? all.filter((r) => cols.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q))) : all;
  const download = d.all === true;
  const off = Math.max(0, Number(d.offset) || 0), lim = download ? 6000 : Math.min(200, Number(d.limit) || 100);
  const page = found.slice(off, off + lim);
  if (download) ctx.tx.audit("Data export", table, "console", null, { rows: page.length });
  return {
    table, label: EDITABLE[table].label, hint: EDITABLE[table].hint ?? "", total: found.length, offset: off, softDelete: !!TABLES[table].softDelete,
    columns: cols.map(([key, header, type, readonly]) => ({ key, header, type, readonly })),
    rows: page.map((r) => Object.fromEntries(cols.map(([k, , t]) => [k, r[k] ?? (t === "nn" ? null : "")]))),
  };
}

const DATE_KEYS = /(^date$|Date$|^fromDate$|^toDate$)/;
const DT_KEYS = /^(checkIn|checkOut|planned|origPlanned|actual)$/;
function coerce(table: string, key: string, type: string, raw: unknown): string | number | null {
  const v = typeof raw === "string" ? raw.trim() : raw;
  if (type === "n" || type === "nn") {
    if (v === "" || v === null || v === undefined) return type === "nn" ? null : 0;
    const n = Number(v);
    require_(!isNaN(n), `“${key}” must be a number`);
    return n;
  }
  const s = str(v);
  require_(s.length <= 2000, `“${key}” is too long (2000 characters at most)`);
  if (s && DATE_KEYS.test(key) && table !== "Leave_Policy") require_(isDate(s.slice(0, 10)), `“${key}” must be a date like 2026-10-17`);
  if (s && DT_KEYS.test(key)) require_(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s) && isDate(s.slice(0, 10)), `“${key}” must look like 2026-10-17 18:30`);
  return s;
}

/** Change fields of one record. The id and a few columns cannot be changed. Every change goes to the activity log with the old and the new value. */
export async function adminEditRow(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const table = str(d.table), id = str(d.id);
  known(table);
  const idKey = TABLES[table].idKey!;
  const rec = (await ctx.tx.rows(table)).find((r) => String(r[idKey]) === id);
  require_(rec, "That record does not exist");
  const cols = new Map(columns(table).map((c) => [c[0], c]));
  const input = (d.changes ?? {}) as Record<string, unknown>;
  const old: Record<string, unknown> = {}, next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    const c = cols.get(key);
    require_(c, `“${key}” cannot be changed here`);
    require_(!c[3], `“${key}” cannot be changed`);
    const val = coerce(table, key, c[2], raw);
    if (String(rec[key] ?? "") !== String(val ?? "")) { old[key] = rec[key]; next[key] = val; }
  }
  require_(Object.keys(next).length > 0, "Nothing was changed");
  await checkRules(ctx, table, rec, next);
  Object.assign(rec, next);
  if (TABLES[table].cols.some((c) => c[0] === "updatedAt") && !("updatedAt" in next)) rec.updatedAt = ctx.clock.stamp;
  const effects = await afterEdit(ctx, table, rec);
  ctx.tx.audit("Record corrected by the Super Admin", table, id, old, next);
  const e = EDITABLE[table];
  return { id, row: Object.fromEntries(columns(table).map(([k]) => [k, rec[k] ?? ""])), changed: Object.keys(next), effects, hint: e.hint ?? "" };
}

/** Things that would break the app if typed wrongly. */
async function checkRules(ctx: Ctx, table: string, rec: Rec, next: Record<string, unknown>) {
  if (table === "Users") {
    const users = await ctx.tx.rows("Users");
    if ("role" in next) require_(ROLES.includes(String(next.role)), "Role must be SUPER_ADMIN, ADMIN, MANAGER or STAFF");
    if ("status" in next) require_(["Active", "Inactive"].includes(String(next.status)), "Status must be Active or Inactive");
    const leavingSuper = (rec.role === "SUPER_ADMIN") && (("role" in next && next.role !== "SUPER_ADMIN") || ("status" in next && next.status !== "Active"));
    if (leavingSuper) require_(users.some((x) => x !== rec && x.role === "SUPER_ADMIN" && x.status === "Active" && x.deleted !== "Y"), "There must be at least one active Super Admin");
    if ("managerId" in next && next.managerId) { require_(users.some((x) => x.userId === next.managerId && x.deleted !== "Y"), "That reporting manager does not exist"); require_(next.managerId !== rec.userId, "A person cannot report to themselves"); }
    for (const k of ["mobile", "email", "empCode"]) if (k in next && next[k]) require_(!users.some((x) => x !== rec && x.deleted !== "Y" && String(x[k]).toLowerCase() === String(next[k]).toLowerCase()), `Another person already has this ${k}`);
  }
  if (table === "Leaves" && "status" in next) require_(["Pending", "Approved", "Rejected", "Cancelled"].includes(String(next.status)), "Status must be Pending, Approved, Rejected or Cancelled");
  if (table === "Flow_Tasks" && "status" in next) require_(["Pending", "Done", "Skipped"].includes(String(next.status)), "Status must be Pending, Done or Skipped");
  if (table === "Flow_Tasks" && "assigneeId" in next) require_((await ctx.tx.rows("Users")).some((u) => u.userId === next.assigneeId && u.deleted !== "Y"), "That person does not exist");
  if (table === "Flow_Items" && "status" in next) require_(["Open", "Completed", "Cancelled"].includes(String(next.status)), "Status must be Open, Completed or Cancelled");
  if (table === "Attendance") {
    const cin = String("checkIn" in next ? next.checkIn : rec.checkIn), cout = String("checkOut" in next ? next.checkOut : rec.checkOut);
    require_(!cout || cout >= cin, "Check-out cannot be before check-in");
    if ("checkIn" in next || "date" in next) require_(cin.slice(0, 10) === String("date" in next ? next.date : rec.date), "The date must match the check-in day");
  }
  if (table === "Checklist_Log" && "status" in next) require_(["Pending", "Done", "Skipped", "Cancelled"].includes(String(next.status)), "Status must be Pending, Done, Skipped or Cancelled");
}

/** Keep derived fields honest after a manual change. */
async function afterEdit(ctx: Ctx, table: string, rec: Rec): Promise<string[]> {
  const out: string[] = [];
  if (table === "Flow_Tasks") {
    const item = (await ctx.tx.rows("Flow_Items")).find((i) => i.itemId === rec.itemId);
    if (item) {
      const tasks = (await ctx.tx.rows("Flow_Tasks")).filter((t) => t.itemId === item.itemId);
      if (rec.status === "Done" && !rec.actual) { rec.actual = ctx.clock.dt; rec.doneBy = rec.doneBy || ctx.actorId; out.push("The step was marked done without a time, so now was used."); }
      if (rec.status === "Pending") { rec.actual = ""; rec.doneBy = ""; }
      if (refreshItemStatus(item, tasks, ctx.clock.stamp)) out.push(`The entry is now ${item.status}.`);
    }
  }
  return out;
}

/** Bring back a row that was deleted (or hide one). Only for tables that keep deleted rows. */
export async function adminSetDeleted(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const table = str(d.table), id = str(d.id);
  known(table);
  require_(TABLES[table].softDelete, "This table does not keep deleted rows");
  const rec = (await ctx.tx.rows(table)).find((r) => String(r[TABLES[table].idKey!]) === id);
  require_(rec, "That record does not exist");
  const del = d.deleted === true;
  if (table === "Users" && del) fail("VALIDATION", "Use Delete on the Team page — it checks the person's history first");
  rec.deleted = del ? "Y" : "";
  ctx.tx.audit(del ? "Record hidden by the Super Admin" : "Record restored by the Super Admin", table, id, null, null);
  return { id, deleted: del };
}

/** Problems in the data that quietly cost time. Each line says how many and where to fix them. */
export async function adminChecks(ctx: Ctx) {
  needSuper(ctx);
  const users = (await ctx.tx.rows("Users")).filter((u) => u.deleted !== "Y");
  const active = new Set(users.filter((u) => u.status === "Active").map((u) => String(u.userId)));
  const names = new Map(users.map((u) => [String(u.userId), String(u.name)]));
  const openItems = new Set((await ctx.tx.rows("Flow_Items")).filter((i) => i.status === "Open").map((i) => String(i.itemId)));
  const tasks = await ctx.tx.rows("Flow_Tasks");
  const list = (rows: string[]) => [...new Set(rows)].slice(0, 6);
  const checks: { id: string; level: "bad" | "warn" | "info"; title: string; count: number; examples: string[]; fix: string; table?: string }[] = [];
  const add = (c: (typeof checks)[number]) => { if (c.count) checks.push(c); };

  const orphan = tasks.filter((t) => t.status === "Pending" && openItems.has(String(t.itemId)) && !active.has(String(t.assigneeId)));
  add({ id: "orphan-steps", level: "bad", title: "Open FMS steps assigned to a person who is switched off or gone", count: orphan.length, examples: list(orphan.map((t) => names.get(String(t.assigneeId)) ?? String(t.assigneeId))), fix: "Reassign them on the FMS, or record the person's exit with a hand-over person.", table: "Flow_Tasks" });
  const orphanCl = (await ctx.tx.rows("Checklist_Tasks")).filter((c) => c.status === "Active" && !active.has(String(c.doerId)));
  add({ id: "orphan-checklist", level: "bad", title: "Active checklist tasks of a person who is switched off or gone", count: orphanCl.length, examples: list(orphanCl.map((c) => String(c.title))), fix: "Change the doer in Checklist, or pause the task.", table: "Checklist_Tasks" });
  const noBoss = users.filter((u) => u.status === "Active" && !u.managerId && u.role !== "SUPER_ADMIN");
  add({ id: "no-manager", level: "warn", title: "Active people without a reporting manager", count: noBoss.length, examples: list(noBoss.map((u) => String(u.name))), fix: "Set the reporting manager on Team & profiles (leave and approvals need it).", table: "Users" });
  const badBoss = users.filter((u) => u.managerId && !active.has(String(u.managerId)) && u.status === "Active");
  add({ id: "boss-gone", level: "bad", title: "People whose reporting manager is switched off or gone", count: badBoss.length, examples: list(badBoss.map((u) => String(u.name))), fix: "Choose a new reporting manager.", table: "Users" });
  const codes = new Map<string, number>();
  for (const u of users) if (u.empCode) codes.set(String(u.empCode).toLowerCase(), (codes.get(String(u.empCode).toLowerCase()) ?? 0) + 1);
  const dup = [...codes].filter(([, n]) => n > 1);
  add({ id: "dup-code", level: "bad", title: "Employee IDs used by more than one person", count: dup.length, examples: dup.map(([c]) => c).slice(0, 6), fix: "Give each person their own Employee ID.", table: "Users" });
  const noCode = users.filter((u) => u.status === "Active" && !u.empCode);
  add({ id: "no-code", level: "info", title: "Active people without an Employee ID (the attendance kiosk needs it)", count: noCode.length, examples: list(noCode.map((u) => String(u.name))), fix: "Add the Employee ID on Team & profiles.", table: "Users" });
  const att = (await ctx.tx.rows("Attendance")).filter((a) => a.deleted !== "Y");
  const stale = att.filter((a) => !a.checkOut && String(a.date) < ctx.clock.date);
  add({ id: "open-punch", level: "warn", title: "Check-ins from earlier days that were never checked out", count: stale.length, examples: list(stale.map((a) => `${names.get(String(a.userId)) ?? a.userId} ${a.date}`)), fix: "Open Attendance → correct the check-out time (or edit here).", table: "Attendance" });
  const leaves = await ctx.tx.rows("Leaves");
  const oldPending = leaves.filter((l) => l.status === "Pending" && String(l.endDate) < ctx.clock.date);
  add({ id: "old-leave", level: "warn", title: "Leave requests still waiting although the dates are over", count: oldPending.length, examples: list(oldPending.map((l) => `${names.get(String(l.userId)) ?? l.userId} ${l.startDate}`)), fix: "Approve or reject them (or edit the status here).", table: "Leaves" });
  const bad = leaves.filter((l) => String(l.endDate) < String(l.startDate));
  add({ id: "bad-leave", level: "bad", title: "Leave requests whose last day is before the first day", count: bad.length, examples: list(bad.map((l) => String(l.leaveId))), fix: "Correct the dates here.", table: "Leaves" });
  const withTasks = new Set(tasks.map((t) => String(t.itemId)));
  const empty = (await ctx.tx.rows("Flow_Items")).filter((i) => i.status === "Open" && !withTasks.has(String(i.itemId)));
  add({ id: "no-steps", level: "warn", title: "Open FMS entries that have no steps", count: empty.length, examples: list(empty.map((i) => String(i.title))), fix: "Cancel them or replan the FMS.", table: "Flow_Items" });
  const draftHol = (await ctx.tx.rows("Holidays")).filter((h) => h.deleted !== "Y" && h.published === "N");
  add({ id: "draft-holidays", level: "info", title: "Holidays still waiting to be published", count: draftHol.length, examples: list(draftHol.map((h) => `${h.date} ${h.label}`)), fix: "Holidays → Publish.", table: "Holidays" });
  const year = ctx.clock.date.slice(0, 4);
  const hasPolicy = (await ctx.tx.rows("Leave_Policy")).some((p) => String(p.year) === year);
  add({ id: "no-policy", level: "info", title: `No leave policy set for ${year}`, count: hasPolicy ? 0 : 1, examples: [], fix: "Attendance → Leave → Leave policy." });
  return { checks, checkedAt: ctx.clock.stamp, people: users.length };
}

// ---------------- announcements ----------------
const audienceOf = (a: Rec, me: Rec): boolean => {
  const aud = String(a.audience || "all");
  if (aud === "all") return true;
  if (aud.startsWith("dept:")) return String(me.department ?? "").trim().toLowerCase() === aud.slice(5).trim().toLowerCase();
  if (aud.startsWith("users:")) return aud.slice(6).split(",").map((x) => x.trim()).includes(String(me.userId));
  return false;
};

/** What the signed-in person should read now (anyone). The Super Admin also gets the old ones, to manage them. */
export async function listAnnouncements(ctx: Ctx, d: Record<string, unknown>) {
  const rows = (await ctx.tx.rows("Announcements")).filter((a) => a.deleted !== "Y");
  const manage = ctx.isSuper && d.manage === true;
  const today = ctx.clock.date;
  const mine = rows.filter((a) => manage || (audienceOf(a, ctx.actor) && (!a.startDate || String(a.startDate) <= today) && (!a.endDate || String(a.endDate) >= today)));
  return { announcements: mine.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50).map((a) => pub("Announcements", a)) };
}

export async function saveAnnouncement(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const title = str(d.title), body = str(d.body);
  require_(title, "Write a title");
  require_(title.length <= 100 && body.length <= 1000, "Title up to 100 and message up to 1000 characters");
  const audience = str(d.audience) || "all";
  require_(audience === "all" || /^dept:.+/.test(audience) || /^users:.+/.test(audience), "Choose who should read it");
  const start = str(d.startDate), end = str(d.endDate);
  require_(!start || isDate(start), "Start date is not valid");
  require_(!end || isDate(end), "End date is not valid");
  require_(!start || !end || end >= start, "The last day cannot be before the first day");
  const tone = str(d.tone) === "important" ? "important" : "info";
  const rows = await ctx.tx.rows("Announcements");
  const id = str(d.annId);
  const existing = id ? rows.find((a) => a.annId === id && a.deleted !== "Y") : undefined;
  require_(!id || existing, "Unknown announcement");
  let rec: Rec;
  if (existing) { Object.assign(existing, { title, body, audience, tone, startDate: start, endDate: end }); rec = existing; ctx.tx.audit("Announcement edited", "Announcements", id, null, { title }); }
  else {
    rec = ctx.tx.insert("Announcements", { annId: newId("ANN"), title, body, audience, tone, startDate: start, endDate: end, createdBy: ctx.actorId, createdAt: ctx.clock.stamp, deleted: "" });
    ctx.tx.audit("Announcement posted", "Announcements", String(rec.annId), null, { title, audience });
    // everyone it is meant for gets a notification (the Super Admin who wrote it does not)
    for (const u of (await ctx.tx.rows("Users")).filter((x) => x.status === "Active" && x.deleted !== "Y" && audienceOf(rec, x))) ctx.notice({ userId: String(u.userId), type: "announcement", title: `${tone === "important" ? "Important: " : ""}${title}`, body: body.slice(0, 200), link: "/flows/panel" });
  }
  return pub("Announcements", rec);
}

export async function deleteAnnouncement(ctx: Ctx, d: Record<string, unknown>) {
  needSuper(ctx);
  const a = (await ctx.tx.rows("Announcements")).find((x) => x.annId === str(d.annId) && x.deleted !== "Y");
  require_(a, "Unknown announcement");
  a.deleted = "Y";
  ctx.tx.audit("Announcement removed", "Announcements", String(a.annId), { title: a.title }, null);
  return { annId: a.annId };
}
