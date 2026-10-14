/**
 * Checklists: recurring personal work (daily / weekly / monthly … / one-time) that is created automatically as dated entries,
 * ticked off by the doer (or the buddy while the doer is away), and measured in the weekly scorecard.
 */
import { CHECKLIST_FREQ, type ChecklistFreq } from "../../lib/flow-types.ts";
import { checklistOwner, parseFreq } from "../../lib/checklist-shared.ts";
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { absenceRows } from "./tasks.ts";
import { plannedDates } from "../../lib/checklist-schedule.ts";
import { addDays, isDate, minutesBetween, normDT, type Calendar } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const FREQS = CHECKLIST_FREQ.map((f) => f.id as string);
/** Entries are created this many days ahead, so people can see the coming week. */
export const AHEAD_DAYS = 7;

export async function checklistCalendar(ctx: Ctx): Promise<Calendar> {
  const off = new Set(str(ctx.setting("WEEKLY_OFF", "0")).split(",").map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).map(Number));
  const holidays = new Set((await ctx.tx.rows("Holidays")).filter((h) => h.deleted !== "Y" && !h.flowId).map((h) => String(h.date)));
  return { off, holidays };
}

/** Create the dated entries that are missing, up to a week ahead. Safe to call repeatedly (it never duplicates a date). */
export async function generateChecklist(ctx: Ctx, only?: Rec[]): Promise<{ created: number }> {
  if (!only) await ctx.db.load(["Checklist_Tasks", "Checklist_Log"], { fresh: true }); // another server may have just generated
  const tasks = (await ctx.tx.rows("Checklist_Tasks")).filter((t) => t.status === "Active" && (!only || only.includes(t)));
  if (!tasks.length) return { created: 0 };
  const log = await ctx.tx.rows("Checklist_Log");
  const have = new Set(log.filter((l) => l.status !== "Cancelled").map((l) => `${l.ctId}|${l.plannedDate}`));
  const cal = await checklistCalendar(ctx);
  const today = ctx.clock.date, horizon = addDays(today, AHEAD_DAYS);
  let created = 0;
  for (const t of tasks) {
    const from = t.lastGenerated ? addDays(String(t.lastGenerated), 1) : String(t.startDate) > today ? String(t.startDate) : today;
    if (from > horizon) continue;
    for (const date of plannedDates({ freq: t.freq as ChecklistFreq, startDate: String(t.startDate), endDate: String(t.endDate) }, from, horizon, cal)) {
      const key = `${t.ctId}|${date}`;
      if (have.has(key)) continue;
      have.add(key);
      ctx.tx.insert("Checklist_Log", { clId: newId("CLG"), ctId: t.ctId, doerId: t.doerId, plannedDate: date, status: "Pending", actual: "", doneBy: "", proof: "", remarks: "", remindedAt: "", createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp });
      created++;
    }
    t.lastGenerated = horizon;
  }
  return { created };
}

async function activeUser(ctx: Ctx, id: string) {
  const u = (await ctx.tx.rows("Users")).find((x) => x.userId === id);
  return u && u.status === "Active" ? u : undefined;
}

/** Create or edit a checklist task. Changing the schedule re-creates its coming entries; pausing / archiving cancels them. */
export async function saveChecklistTask(ctx: Ctx, d: Record<string, unknown>) {
  const title = str(d.title);
  require_(title, "Write the task");
  require_(title.length <= 200, "The task is too long (200 characters at most)");
  const doerId = str(d.doerId);
  const doer = await activeUser(ctx, doerId);
  require_(doer, "Choose who does this task");
  ctx.require("checklist", str(d.ctId) ? "edit" : "create", "You cannot add or change checklist tasks");
  if (doerId !== ctx.actorId) { ctx.require("checklist", "assign", "You can only add tasks for yourself"); await ctx.requireInReach(doerId, "checklist"); }
  const backupId = str(d.backupId);
  if (backupId) { require_(await activeUser(ctx, backupId), "The buddy must be an active user"); require_(backupId !== doerId, "The buddy must be a different person"); }
  const freq = parseFreq(d.freq) || str(d.freq);
  require_(FREQS.includes(freq), "Choose how often");
  const startDate = str(d.startDate) || ctx.clock.date;
  require_(isDate(startDate), "Start date must be a valid date");
  const endDate = str(d.endDate);
  if (endDate) require_(isDate(endDate) && endDate >= startDate, "End date must be on or after the start date");
  const status = str(d.status) || "Active";
  require_(["Active", "Paused", "Archived"].includes(status), "Status must be Active, Paused or Archived");
  const fields = { title, doerId, backupId, department: str(d.department), freq, startDate, endDate, proof: str(d.proof) === "Y" || d.proof === true ? "Y" : "N", kra: str(d.kra), status };

  const tasks = await ctx.tx.rows("Checklist_Tasks");
  const existing = str(d.ctId) ? tasks.find((t) => t.ctId === str(d.ctId)) : undefined;
  require_(!str(d.ctId) || existing, "Unknown checklist task");
  const log = await ctx.tx.rows("Checklist_Log");
  let rec: Rec;
  if (!existing) {
    rec = ctx.tx.insert("Checklist_Tasks", { ctId: newId("CLT"), ...fields, lastGenerated: "", createdAt: ctx.clock.stamp, createdBy: ctx.actorId, updatedAt: ctx.clock.stamp });
    ctx.tx.audit("Checklist task added", "Checklist_Tasks", String(rec.ctId), null, { title, doer: doer.name, freq });
  } else {
    rec = existing;
    const before = { title: rec.title, doerId: rec.doerId, freq: rec.freq, startDate: rec.startDate, endDate: rec.endDate, status: rec.status };
    const scheduleChanged = rec.freq !== freq || rec.startDate !== startDate || rec.endDate !== endDate;
    const cameBack = rec.status !== "Active" && status === "Active";
    const future = log.filter((l) => l.ctId === rec.ctId && l.status === "Pending" && String(l.plannedDate) >= ctx.clock.date);
    if (status !== "Active" || scheduleChanged) future.forEach((l) => { l.status = "Cancelled"; l.updatedAt = ctx.clock.stamp; });
    else if (rec.doerId !== doerId) future.forEach((l) => { l.doerId = doerId; l.updatedAt = ctx.clock.stamp; });
    Object.assign(rec, fields, { updatedAt: ctx.clock.stamp });
    if (scheduleChanged || cameBack || status !== "Active") rec.lastGenerated = "";
    ctx.tx.audit("Checklist task edited", "Checklist_Tasks", String(rec.ctId), before, { title, doerId, freq, startDate, endDate, status });
  }
  if (doerId !== ctx.actorId && !existing) ctx.notice({ userId: doerId, type: "checklist", title: `New checklist task: ${title}`, body: `${(CHECKLIST_FREQ.find((f) => f.id === freq) ?? { label: freq }).label} · starts ${startDate}`, link: "/flows/checklist" });
  const gen = status === "Active" ? await generateChecklist(ctx, [rec]) : { created: 0 };
  return { task: pub("Checklist_Tasks", rec), created: gen.created };
}

const toIso = (v: string): string => {
  const s = v.trim();
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
};

/** Paste / import many tasks at once. Doers are matched by name (or user id); anything that cannot be understood is skipped with a reason. */
export async function bulkAddChecklistTasks(ctx: Ctx, d: Record<string, unknown>) {
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  require_(rows.length > 0, "Add at least one task");
  require_(rows.length <= 500, "Add at most 500 tasks at a time");
  const sc = await ctx.reach("checklist");
  const users = (await ctx.tx.rows("Users")).filter((u) => u.status === "Active" && (sc.all || sc.ids.has(String(u.userId))));
  const find = (v: string) => { const k = v.trim().toLowerCase(); return users.find((u) => String(u.userId).toLowerCase() === k || String(u.name).toLowerCase() === k); };
  const tasks = await ctx.tx.rows("Checklist_Tasks");
  const seen = new Set(tasks.filter((t) => t.status !== "Archived").map((t) => `${String(t.title).toLowerCase()}|${t.doerId}|${t.freq}`));
  const skipped: { row: number; reason: string }[] = [];
  const unknownDoers = new Set<string>();
  const made: Rec[] = [];
  const defaultStart = str(d.defaultStart) || ctx.clock.date;
  rows.forEach((r, i) => {
    const n = i + 1;
    const title = str(r.title);
    if (!title) return void skipped.push({ row: n, reason: "No task text" });
    const doerName = str(r.doer ?? r.doerId);
    const doer = find(doerName);
    if (!doer) { if (doerName) unknownDoers.add(doerName); return void skipped.push({ row: n, reason: doerName ? `Unknown person “${doerName}”` : "No doer" }); }
    const freq = parseFreq(r.freq);
    if (!freq) return void skipped.push({ row: n, reason: `Frequency “${str(r.freq)}” not understood (use D, W, F, M, Q, H, Y or O)` });
    const start = toIso(str(r.startDate)) || defaultStart;
    if (!isDate(start)) return void skipped.push({ row: n, reason: `Date “${str(r.startDate)}” is not valid` });
    const buddy = str(r.buddy) ? find(str(r.buddy)) : undefined;
    const key = `${title.toLowerCase()}|${doer.userId}|${freq}`;
    if (seen.has(key)) return void skipped.push({ row: n, reason: "Already in the checklist" });
    seen.add(key);
    made.push(ctx.tx.insert("Checklist_Tasks", {
      ctId: newId("CLT"), title: title.slice(0, 200), doerId: doer.userId, backupId: buddy && buddy.userId !== doer.userId ? buddy.userId : "", department: str(r.department), freq, startDate: start,
      endDate: "", proof: /^(y|yes|true|1)$/i.test(str(r.proof)) ? "Y" : "N", kra: str(r.kra), status: "Active", lastGenerated: "", createdAt: ctx.clock.stamp, createdBy: ctx.actorId, updatedAt: ctx.clock.stamp,
    }));
  });
  const gen = await generateChecklist(ctx, made);
  ctx.tx.audit("Checklist tasks imported", "Checklist_Tasks", "", null, { added: made.length, skipped: skipped.length, entries: gen.created });
  return { added: made.length, skipped, unknownDoers: [...unknownDoers], created: gen.created };
}

async function entryParts(ctx: Ctx, clId: string) {
  const log = await ctx.tx.rows("Checklist_Log");
  const entry = log.find((l) => l.clId === clId);
  require_(entry, "Unknown checklist entry");
  const task = (await ctx.tx.rows("Checklist_Tasks")).find((t) => t.ctId === entry.ctId);
  require_(task, "This entry's task no longer exists");
  return { entry, task };
}

/** Admin, the doer, or the buddy / backup covering the doer right now. */
export async function canActOnChecklist(ctx: Ctx, entry: Rec, task: Rec): Promise<boolean> {
  if (entry.doerId === ctx.actorId || (await ctx.manages(String(entry.doerId), "checklist"))) return true;
  const owner = checklistOwner({ doerId: String(entry.doerId), plannedDate: String(entry.plannedDate), status: entry.status as "Pending" }, { backupId: String(task.backupId) }, await absenceRows(ctx), ctx.clock.date);
  return owner.userId === ctx.actorId;
}

export async function completeChecklist(ctx: Ctx, d: Record<string, unknown>) {
  const { entry, task } = await entryParts(ctx, str(d.clId));
  require_(entry.status === "Pending", entry.status === "Done" ? "This task is already done" : `This entry is ${String(entry.status).toLowerCase()}`);
  if (!(await canActOnChecklist(ctx, entry, task))) fail("FORBIDDEN", "This task belongs to someone else");
  if (task.proof === "Y") require_(str(d.proof), "This task needs proof — paste a link or write a note");
  if (!d._bulk) {
    const fresh = await ctx.tx.freshRow("Checklist_Log", entry);
    require_(fresh && fresh.status === "Pending", "This task was just changed by someone else. Refresh to see it.");
  }
  let actual = ctx.clock.dt;
  if (str(d.actual)) { require_(await ctx.manages(String(entry.doerId), "checklist"), "Only a manager can set an earlier completion time"); const a = normDT(d.actual); require_(a && a.length === 16 && a <= ctx.clock.dt, "Enter a valid completion time (not in the future)"); actual = a; }
  // an admin ticking on someone else's behalf credits that person (a buddy / backup who really covers keeps the credit)
  const owner = checklistOwner({ doerId: String(entry.doerId), plannedDate: String(entry.plannedDate), status: "Pending" }, { backupId: String(task.backupId) }, await absenceRows(ctx), ctx.clock.date).userId;
  const onBehalf = ctx.actorId !== entry.doerId && ctx.actorId !== owner;
  entry.status = "Done"; entry.actual = actual; entry.doneBy = onBehalf ? String(entry.doerId) : ctx.actorId; entry.proof = str(d.proof); entry.remarks = str(d.remarks); entry.updatedAt = ctx.clock.stamp;
  if (onBehalf) entry.remarks = `${entry.remarks ? entry.remarks + " · " : ""}ticked by ${String(ctx.actor.name)}`;
  if (!d._bulk) ctx.tx.audit("Checklist done", "Checklist_Log", String(entry.clId), null, { task: task.title, planned: entry.plannedDate, actual });
  return pub("Checklist_Log", entry);
}

/** "Tick everything for today": tasks that need proof are left for the person to do one by one. */
export async function completeChecklistMany(ctx: Ctx, d: Record<string, unknown>) {
  const ids = (Array.isArray(d.clIds) ? d.clIds : []).map(str).filter(Boolean);
  require_(ids.length > 0, "Nothing selected");
  require_(ids.length <= 200, "Too many at once");
  let done = 0;
  const skipped: { clId: string; reason: string }[] = [];
  for (const clId of ids) {
    try { await completeChecklist(ctx, { clId, _bulk: true }); done++; }
    catch (e) { skipped.push({ clId, reason: e instanceof Error ? e.message : "Failed" }); }
  }
  if (done) ctx.tx.audit("Checklist done (many)", "Checklist_Log", "", null, { done, skipped: skipped.length });
  return { done, skipped };
}

export async function reopenChecklist(ctx: Ctx, d: Record<string, unknown>) {
  const { entry, task } = await entryParts(ctx, str(d.clId));
  require_(entry.status === "Done" || entry.status === "Skipped", "Only a finished entry can be reopened");
  if (!(await ctx.manages(String(entry.doerId), "checklist"))) { // undo a mis-tap: your own tick, within half an hour
    require_(entry.status === "Done" && entry.doneBy === ctx.actorId, "Only an admin can reopen this");
    require_(minutesBetween(String(entry.actual), ctx.clock.dt) <= 30, "You can only undo within 30 minutes of ticking. Ask an admin to reopen it.");
  }
  const before = { status: entry.status, actual: entry.actual };
  entry.status = "Pending"; entry.actual = ""; entry.doneBy = ""; entry.updatedAt = ctx.clock.stamp;
  ctx.tx.audit("Checklist reopened", "Checklist_Log", String(entry.clId), before, { task: task.title });
  return pub("Checklist_Log", entry);
}

/** "Not applicable this time" (admin): leaves the entry out of the scorecard. */
export async function skipChecklist(ctx: Ctx, d: Record<string, unknown>) {
  const { entry, task } = await entryParts(ctx, str(d.clId));
  require_(entry.status === "Pending", "Only an open entry can be skipped");
  await ctx.requireInReach(String(entry.doerId), "checklist");
  require_(str(d.remarks), "Say why it is skipped");
  entry.status = "Skipped"; entry.remarks = str(d.remarks); entry.doneBy = ctx.actorId; entry.updatedAt = ctx.clock.stamp;
  ctx.tx.audit("Checklist skipped", "Checklist_Log", String(entry.clId), null, { task: task.title, reason: entry.remarks });
  return pub("Checklist_Log", entry);
}

export async function generateChecklistAction(ctx: Ctx) {
  return generateChecklist(ctx);
}

/** Scheduler part: create missing entries, and remind people of what is still pending later in the day. */
export async function checklistTick(ctx: Ctx): Promise<{ created: number; reminders: number }> {
  const { created } = await generateChecklist(ctx);
  let reminders = 0;
  const hour = ctx.settingNum("CHECKLIST_REMIND_HOUR");
  if (hour < 24 && Number(ctx.clock.time.slice(0, 2)) === hour) {
    const tasks = new Map((await ctx.tx.rows("Checklist_Tasks")).map((t) => [String(t.ctId), t]));
    const absences = await absenceRows(ctx);
    const already = new Set((await ctx.tx.rows("Notifications")).filter((n) => n.type === "checklist-reminder" && String(n.createdAt).slice(0, 10) === ctx.clock.date).map((n) => String(n.userId)));
    const pending = new Map<string, number>();
    for (const l of await ctx.tx.rows("Checklist_Log")) {
      if (l.status !== "Pending" || String(l.plannedDate) > ctx.clock.date) continue;
      const who = checklistOwner({ doerId: String(l.doerId), plannedDate: String(l.plannedDate), status: "Pending" }, { backupId: String(tasks.get(String(l.ctId))?.backupId ?? "") }, absences, ctx.clock.date).userId;
      pending.set(who, (pending.get(who) ?? 0) + 1);
    }
    for (const [uid, n] of pending) {
      if (already.has(uid)) continue;
      ctx.notice({ userId: uid, type: "checklist-reminder", title: `${n} checklist task${n === 1 ? "" : "s"} still pending`, body: "Open My Checklist and tick what you have done.", link: "/flows/checklist", dedupeKey: `clrem|${uid}|${ctx.clock.date}`, self: true });
      reminders++;
    }
  }
  return { created, reminders };
}

