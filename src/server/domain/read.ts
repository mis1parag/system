/** Reads for the browser, plus small account / settings writes. */
import { addDays } from "./time.ts";
import { Ctx } from "./ctx.ts";
import { fail, forbid, pub, require_, type Rec } from "../sheets/db.ts";
import { DEFAULT_SETTINGS } from "../sheets/schema.ts";
import { capsOf, flowVisible, MODULE_IDS, moduleOfNotification, parsePermSet, ROLE_INFO, roleTemplate, type ModuleId, type PermSet, type Reach } from "../../lib/permissions.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const FLOW_TABLES = ["Users", "Flows", "Flow_Items", "Flow_Tasks", "Holidays", "Absences", "Requests", "Notifications", "Checklist_Tasks", "Checklist_Log", "Attendance", "Leaves", "Quick_Links", "Saved_Filters"];

/**
 * Entries the actor may see. DENY BY DEFAULT:
 *  · the FMS itself must be open to them, and they need the FMS module;
 *  · then the entry must involve someone inside their reach (they, their team, their department, or everyone — see the role's scope),
 *    or have been shared with them (visibility = selected people / department / management).
 */
function visibleItems(ctx: Ctx, reach: Reach, t: Record<string, Rec[]>) {
  if (!ctx.allow("fms", "view")) return { flowOk: new Set<string>(), items: [] as Rec[] };
  const me = ctx.actor;
  const mine = String(ctx.actor.department ?? "").trim().toLowerCase();
  const flowOk = new Set(t.Flows.filter((f) => flowVisible(f as never, me as never, reach.all)).map((f) => String(f.flowId)));
  const byItem = new Map<string, Rec[]>();
  for (const x of t.Flow_Tasks) (byItem.get(String(x.itemId)) ?? byItem.set(String(x.itemId), []).get(String(x.itemId))!).push(x);
  const inReach = (id: unknown) => reach.ids.has(String(id));
  const management = ctx.actor.role !== "STAFF";
  const items = t.Flow_Items.filter((i) => {
    if (!flowOk.has(String(i.flowId))) return false;
    if (reach.all) return true;
    if (inReach(i.createdBy) || (byItem.get(String(i.itemId)) ?? []).some((x) => inReach(x.assigneeId) || inReach(x.doneBy))) return true;
    const vis = String(i.visibility || "assigned");
    if (vis === "users") return String(i.visibleTo).split(",").map((x) => x.trim()).includes(ctx.actorId);
    if (vis === "department") return !!mine && String(i.department).trim().toLowerCase() === mine;
    if (vis === "management") return management;
    return false;
  });
  return { flowOk, items };
}

export async function getFlowData(ctx: Ctx, p: Record<string, unknown>, live: boolean) {
  const t = await ctx.db.load(FLOW_TABLES);
  const flowId = str(p.flowId);
  const reach = { fms: await ctx.reach("fms"), checklist: await ctx.reach("checklist"), attendance: await ctx.reach("attendance"), scorecard: await ctx.reach("scorecard"), employees: await ctx.reach("employees"), reports: await ctx.reach("reports"), audit: await ctx.reach("audit"), payroll: await ctx.reach("payroll"), reminders: await ctx.reach("reminders") };
  const has = (m: ModuleId) => ctx.allow(m, "view");
  // the Super Admin always gets the complete history; everyone else gets open entries + the last 90 days (and can load more per FMS)
  const all = p.all === true || p.all === "true" || p.all === "1" || ctx.isSuper;
  const since = addDays(ctx.clock.date, -(Number(p.days) || 90));

  // ---- FMS (only when the person has the FMS module)
  const vis = visibleItems(ctx, reach.fms, t);
  const counts: Record<string, { open: number; completed: number; cancelled: number }> = {};
  for (const i of vis.items) {
    const c = (counts[String(i.flowId)] ??= { open: 0, completed: 0, cancelled: 0 });
    if (i.status === "Open") c.open++; else if (i.status === "Completed") c.completed++; else c.cancelled++;
  }
  const items = vis.items.filter((i) => {
    if (flowId && i.flowId !== flowId) return false;
    if (all) return true;
    return i.status === "Open" || String(i.completedAt || i.updatedAt).slice(0, 10) >= since;
  });
  const ids = new Set(items.map((i) => i.itemId));
  // an entry may involve several people, but each person gets only THEIR steps (and the steps of people inside their reach) — not what a colleague has to do
  const tasks = t.Flow_Tasks.filter((x) => ids.has(x.itemId) && (reach.fms.all || reach.fms.ids.has(String(x.assigneeId)) || reach.fms.ids.has(String(x.doneBy))));

  const recent = addDays(ctx.clock.date, -60);
  const userById = new Map(t.Users.map((u) => [String(u.userId), u]));
  const reachReq = (r: Rec) => r.requestedBy === ctx.actorId || userById.get(String(r.requestedBy))?.managerId === ctx.actorId || (ctx.allow("fms", "approve") && (reach.fms.all || reach.fms.ids.has(String(r.requestedBy))));
  const recentReq = (r: Rec) => r.status === "Pending" || String(r.decidedAt).slice(0, 10) >= addDays(ctx.clock.date, -14);
  // "more time" for checklist tasks: the person who asked, their reporting manager, the Super Admin and people who manage that person's checklist
  const reachClReq = (r: Rec) => r.requestedBy === ctx.actorId || userById.get(String(r.requestedBy))?.managerId === ctx.actorId || ctx.isSuper || (ctx.allow("checklist", "manage") && (reach.checklist.all || reach.checklist.ids.has(String(r.requestedBy))));
  const requests = t.Requests.filter((r) => (r.kind === "checklist" ? reachClReq(r) : has("fms") && vis.flowOk.has(String(r.flowId)) && reachReq(r)) && recentReq(r));

  // ---- notifications: only about modules the person can open
  const notes = t.Notifications.filter((n) => n.userId === ctx.actorId).filter((n) => { const m = moduleOfNotification(n as { link?: unknown; type?: unknown }); return !m || has(m); }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  // ---- checklist
  const covered = new Set(t.Absences.filter((a) => a.deleted !== "Y" && a.backupUserId === ctx.actorId && String(a.toDate) >= addDays(ctx.clock.date, -70)).map((a) => String(a.userId)));
  const clTasks = has("checklist") ? t.Checklist_Tasks.filter((c) => c.status !== "Archived" && (reach.checklist.all || reach.checklist.ids.has(String(c.doerId)) || c.backupId === ctx.actorId || covered.has(String(c.doerId)))) : [];
  const clIds = new Set(clTasks.map((c) => String(c.ctId)));
  const clSince = addDays(ctx.clock.date, -70);
  const clLog = t.Checklist_Log.filter((l) => clIds.has(String(l.ctId)) && l.status !== "Cancelled" && (ctx.isSuper || l.status === "Pending" || String(l.plannedDate) >= clSince));

  // ---- attendance and leave
  const attSince = addDays(ctx.clock.date, -120);
  const inAtt = (id: unknown) => reach.attendance.all || reach.attendance.ids.has(String(id));
  const attendance = has("attendance") ? t.Attendance.filter((a) => a.deleted !== "Y" && inAtt(a.userId) && (ctx.isSuper || String(a.date) >= attSince)) : [];
  const leaves = has("attendance") ? t.Leaves.filter((l) => inAtt(l.userId)) : [];

  // ---- people: names for everyone (pickers); contact details only inside reach for those who may manage people
  const inEmp = (id: unknown) => reach.employees.all || reach.employees.ids.has(String(id));
  const seesContacts = ctx.allow("employees", "edit") || ctx.allow("employees", "manage");
  const canExit = ctx.allow("employees", "delete");
  const departments = [...new Set(t.Users.filter((u) => u.status === "Active").map((u) => str(u.department)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // ---- quick access and saved filters
  const quickLinks = has("quick_access") ? t.Quick_Links.filter((l) => l.deleted !== "Y" && (!l.ownerId || l.ownerId === ctx.actorId)).map((l) => pub("Quick_Links", l)) : [];
  const savedFilters = t.Saved_Filters.filter((f) => f.deleted !== "Y" && (f.userId === ctx.actorId || (f.shared === "Y" && has(pageModule(String(f.page)))))).map((f) => pub("Saved_Filters", f));

  // ---- the Super Admin also gets the roles and everyone's personal overrides (to edit them)
  const roles = ctx.isSuper ? roleList(ctx, t.Users) : undefined;
  const access = ctx.isSuper ? t.Users.map((u) => ({ userId: u.userId, role: u.role, roleId: u.roleId, overrides: parsePermSet(u.permsJson) })) : undefined;

  return {
    live, counts, serverDate: ctx.clock.date, serverTime: ctx.clock.time,
    me: { ...pub("Users", ctx.actor), roleId: ctx.actor.roleId },
    flows: t.Flows.filter((f) => vis.flowOk.has(String(f.flowId))).map((f) => pub("Flows", f)),
    holidays: t.Holidays.filter((h) => h.deleted !== "Y" && (h.published !== "N" || ctx.allow("attendance", "configure"))).map((h) => pub("Holidays", h)),
    absences: t.Absences.filter((a) => a.deleted !== "Y" && String(a.toDate) >= recent && (inAtt(a.userId) || a.backupUserId === ctx.actorId || a.userId === ctx.actorId)).map((a) => pub("Absences", a)),
    // people: everyone's NAME (to pick a colleague as backup, buddy or assignee) — but role, Employee ID, reporting manager and leave figures only for yourself,
    // your own manager and the people who are inside your reach in some module. A Team Member's list therefore holds nothing about unrelated colleagues.
    users: t.Users.map((u) => {
      // a deleted person is not in any list, but the old records they appear in still show their NAME
      if (u.deleted === "Y") return { userId: u.userId, name: u.name, status: "Inactive", deleted: "Y" } as Record<string, unknown>;
      const known = u.userId === ctx.actorId || u.userId === ctx.actor.managerId || Object.values(reach).some((r) => r.all || r.ids.has(String(u.userId)));
      const o: Record<string, unknown> = known
        ? { userId: u.userId, name: u.name, role: u.role, status: u.status, managerId: u.managerId, notify: u.notify, department: u.department, empCode: u.empCode, leaveAllot: u.leaveAllot, photoVer: u.photoVer }
        : { userId: u.userId, name: u.name, status: u.status, department: u.department, photoVer: u.photoVer };
      if (u.userId === ctx.actorId || (seesContacts && inEmp(u.userId))) { o.mobile = u.mobile; o.email = u.email; }
      // when somebody left (or leaves): the date and kind to people who know them; the note and who took over only to those who may record exits
      if (known && u.exitDate) { o.exitDate = u.exitDate; o.exitType = u.exitType; o.exitDone = u.exitDone; if (canExit) { o.exitReason = u.exitReason; o.exitHandover = u.exitHandover; o.exitBy = u.exitBy; } }
      return o;
    }),
    items: items.map((i) => pub("Flow_Items", i)),
    tasks: tasks.map((x) => pub("Flow_Tasks", x)),
    requests: requests.map((r) => pub("Requests", r)),
    attendance: attendance.map((a) => pub("Attendance", a)), leaves: leaves.map((l) => pub("Leaves", l)),
    checklistTasks: clTasks.map((c) => pub("Checklist_Tasks", c)), checklistLog: clLog.map((l) => pub("Checklist_Log", l)),
    notifications: notes.slice(0, 60).map((n) => pub("Notifications", n)),
    unread: notes.filter((n) => !n.readAt).length,
    settings: Object.fromEntries(DEFAULT_SETTINGS.filter(([k]) => k !== "PERMISSIONS").map(([k]) => [k, ctx.settings[k]])),
    perms: ctx.perms,
    can: capsOf(ctx.perms),
    reach: Object.fromEntries(Object.entries(reach).map(([m, r]) => [m, { all: r.all, ids: r.all ? [] : [...r.ids] }])),
    quickLinks, savedFilters, roles, access, departments,
  };
}

/** Which module a saved filter's page belongs to. */
export function pageModule(page: string): ModuleId {
  if (page.startsWith("checklist")) return "checklist";
  if (page.startsWith("attendance")) return "attendance";
  if (page.startsWith("team") || page.startsWith("employees")) return "employees";
  if (page.startsWith("audit")) return "audit";
  if (page.startsWith("scorecard")) return "scorecard";
  return "fms";
}

/** The four built-in roles (with their current template) and the custom ones. */
function roleList(ctx: Ctx, users: Rec[]) {
  const stored = (() => { try { return JSON.parse(ctx.settings.PERMISSIONS || "{}") as Record<string, unknown>; } catch { return {}; } })();
  const out: { roleId: string; name: string; description: string; base: string; system: boolean; customized: boolean; perms: PermSet; people: number }[] = [];
  for (const id of ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"] as const) {
    const row = ctx.roles.find((r) => r.roleId === id && r.deleted !== "Y");
    const override = row ? parsePermSet(row.permsJson) : stored[id] ? parsePermSet(stored[id]) : undefined;
    out.push({ roleId: id, name: ROLE_INFO[id].label, description: ROLE_INFO[id].hint, base: id, system: true, customized: !!override && id !== "SUPER_ADMIN", perms: roleTemplate(id, override), people: users.filter((u) => u.role === id && !u.roleId && u.status === "Active").length });
  }
  for (const r of ctx.roles.filter((x) => !["ADMIN", "MANAGER", "STAFF"].includes(String(x.roleId)) && x.deleted !== "Y")) {
    out.push({ roleId: String(r.roleId), name: String(r.name), description: String(r.description), base: String(r.base), system: false, customized: true, perms: parsePermSet(r.permsJson), people: users.filter((u) => u.roleId === r.roleId && u.status === "Active").length });
  }
  return out;
}

/** Comments, requests and the activity trail of one entry. */
export async function getItemDetail(ctx: Ctx, p: Record<string, unknown>) {
  ctx.require("fms", "view");
  const itemId = str(p.itemId);
  const t = await ctx.db.load(["Flows", "Flow_Items", "Flow_Tasks", "Comments", "Requests"]);
  forbid(visibleItems(ctx, await ctx.reach("fms"), t).items.some((i) => i.itemId === itemId), "You do not have access to this entry");
  const taskIds = new Set(t.Flow_Tasks.filter((x) => x.itemId === itemId).map((x) => String(x.taskId)));
  const { Audit_Log } = await ctx.db.load(["Audit_Log"]);
  const trail = Audit_Log.filter((a) => a.recordId === itemId || taskIds.has(String(a.recordId)) || (a.entity === "Requests" && t.Requests.some((r) => r.requestId === a.recordId && r.itemId === itemId)))
    .slice(-80).reverse().map((a) => pub("Audit_Log", a));
  return {
    comments: t.Comments.filter((c) => c.itemId === itemId && c.deleted !== "Y").map((c) => pub("Comments", c)),
    requests: t.Requests.filter((r) => r.itemId === itemId).map((r) => pub("Requests", r)),
    trail,
  };
}

/** Search every entry (all FMS, all history) by title, field values or tags — only the ones the actor may see. */
export async function searchEntries(ctx: Ctx, p: Record<string, unknown>) {
  ctx.require("fms", "view");
  const q = str(p.q).toLowerCase();
  require_(q.length >= 2, "Type at least 2 characters");
  const t = await ctx.db.load(["Flows", "Flow_Items", "Flow_Tasks"]);
  const hits = visibleItems(ctx, await ctx.reach("fms"), t).items.filter((i) => `${i.title} ${i.dataJson} ${i.tags} ${i.itemId}`.toLowerCase().includes(q)).slice(0, 60);
  const ids = new Set(hits.map((i) => i.itemId));
  const reach = await ctx.reach("fms");
  return { items: hits.map((i) => pub("Flow_Items", i)), tasks: t.Flow_Tasks.filter((x) => ids.has(x.itemId) && (reach.all || reach.ids.has(String(x.assigneeId)) || reach.ids.has(String(x.doneBy)))).map((x) => pub("Flow_Tasks", x)) };
}

/** The activity log: who did what and when. People see the actions of people inside their reach. */
export async function auditLog(ctx: Ctx, p: Record<string, unknown>) {
  ctx.require("audit", "view", "You cannot read the activity log");
  const { Audit_Log } = await ctx.db.load(["Audit_Log"]);
  const reach = await ctx.reach("audit");
  const user = str(p.user), entity = str(p.entity), mod = str(p.module), q = str(p.q).toLowerCase(), from = str(p.from), to = str(p.to), action = str(p.action).toLowerCase();
  const rows = Audit_Log.filter((a) => (reach.all || reach.ids.has(String(a.user))) && (!user || a.user === user) && (!entity || a.entity === entity) && (!mod || a.module === mod)
    && (!from || String(a.timestamp).slice(0, 10) >= from) && (!to || String(a.timestamp).slice(0, 10) <= to) && (!action || String(a.action).toLowerCase().includes(action))
    && (!q || `${a.action} ${a.recordId} ${a.newValue} ${a.oldValue}`.toLowerCase().includes(q)));
  return { rows: rows.slice(ctx.isSuper ? -3000 : -500).reverse().map((a) => pub("Audit_Log", a)), total: rows.length };
}

/** Writes "Data export" to the activity log. The file itself is made in the browser from data the person was already allowed to load. */
export async function logExport(ctx: Ctx, d: Record<string, unknown>) {
  const mod = str(d.module) as ModuleId;
  require_(MODULE_IDS.includes(mod), "Unknown module");
  ctx.require(mod, "export", "You cannot export this");
  ctx.tx.audit("Data export", mod, str(d.what).slice(0, 80), null, { rows: Number(d.rows) || 0 });
  return { logged: true };
}

export async function markNotificationsRead(ctx: Ctx, d: Record<string, unknown>) {
  const ids = new Set((Array.isArray(d.ids) ? d.ids : []).map(str));
  const all = d.all === true;
  const mine = (await ctx.tx.rows("Notifications")).filter((n) => n.userId === ctx.actorId && !n.readAt && (all || ids.has(String(n.notifId))));
  mine.forEach((n) => (n.readAt = ctx.clock.stamp));
  return { marked: mine.length };
}

export async function saveSettings(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("settings", "configure", "Only the Super Admin can change settings");
  const input = (d.settings ?? {}) as Record<string, unknown>;
  const known = new Map(DEFAULT_SETTINGS.map(([k, v, desc]) => [k, { v, desc }]));
  const rows = await ctx.tx.rows("Settings");
  for (const [k, raw] of Object.entries(input)) {
    require_(known.has(k), `Unknown setting ${k}`);
    require_(k !== "PERMISSIONS", "Use the Access page to change who may do what");
    const v = str(raw);
    if (["REMINDER_MINUTES", "ESCALATE_AFTER_MINUTES"].includes(k)) require_(v !== "" && !isNaN(Number(v)) && Number(v) >= 0, `${k} must be a number of minutes (0 or more)`);
    if (k === "DIGEST_HOUR") require_(/^\d+$/.test(v) && Number(v) <= 23, "DIGEST_HOUR must be 0-23");
    if (k === "WEEKLY_OFF") require_(v === "" || /^[0-6](,[0-6])*$/.test(v), "WEEKLY_OFF must be day numbers 0-6 separated by commas (0 = Sunday), or empty");
    if (k === "CHECKLIST_REMIND_HOUR") require_(/^\d+$/.test(v) && Number(v) <= 24, "CHECKLIST_REMIND_HOUR must be 0-24 (24 = never)");
    if (k === "SCORE_BENCHMARK") require_(v !== "" && !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100, "SCORE_BENCHMARK must be a percentage between 0 and 100");
    if (k === "ATT_LATE_AFTER" || k === "ATT_EARLY_BEFORE") require_(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), `${k} must be a time like 09:30`);
    if (["ATT_FULL_HOURS", "ATT_HALF_HOURS", "ATT_STD_HOURS"].includes(k)) require_(v !== "" && !isNaN(Number(v)) && Number(v) > 0 && Number(v) <= 24, `${k} must be a number of hours (1-24)`);
    if (k === "ATT_GATE") require_(["required", "prompt", "off"].includes(v), "ATT_GATE must be required, prompt or off");
    if (["ATT_GATE_FROM", "ATT_REMIND_CHECKIN", "ATT_REMIND_CHECKOUT"].includes(k)) require_(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), `${k} must be a time like 09:45`);
    if (k === "DIGEST_ENABLED" || k === "ATT_SELF_PUNCH" || k === "ATT_PHOTO" || k === "LEAVE_BLOCK_OVERDRAW") require_(["Y", "N"].includes(v), `${k} must be Y or N`);
    if (k === "TIMEZONE") { try { new Intl.DateTimeFormat("en", { timeZone: v }); } catch { fail("VALIDATION", "Unknown timezone (example: Asia/Kolkata)"); } }
    const row = rows.find((r) => r.key === k);
    if (!row) { ctx.tx.insert("Settings", { key: k, value: v, description: known.get(k)!.desc, group: "General" }); ctx.tx.audit("Setting changed", "Settings", k, { value: known.get(k)!.v }, { value: v }); }
    else if (row.value !== v) { ctx.tx.audit("Setting changed", "Settings", k, { value: row.value }, { value: v }); row.value = v; }
  }
  ctx.db.invalidate(["Settings"]);
  return { saved: Object.keys(input).length };
}
