/**
 * The single entry point for every action: permission check → handler → commit → optional email / WhatsApp.
 * Used by the Next.js route handlers and by the tests.
 */
import type { Role } from "../lib/types.ts";
import type { Action, ModuleId } from "../lib/permissions.ts";
import { Db, MidapError, type CommitResult } from "./sheets/db.ts";
import { makeCtx, type Ctx } from "./domain/ctx.ts";
import { bulkSaveUsers, saveUser, updateProfile } from "./domain/auth.ts";
import { createFlow, replanFlow, rotateIntakeToken, setFlowAccess, updateFlow } from "./domain/flows.ts";
import { getAvatar, getEmployee, saveEmployee, saveProfilePhoto } from "./domain/employee.ts";
import { deleteRole, renameDepartment, resetRole, saveRole, saveUserAccess } from "./domain/access.ts";
import { deleteLink, reorderLinks, saveLink, adoptLink } from "./domain/quick.ts";
import { assignVault, deleteVault, listVault, revealVault, saveVault } from "./domain/vault.ts";
import { deleteFilter, saveFilter } from "./domain/filters.ts";
import { moveWork } from "./domain/move.ts";
import { addComment, bulkEntries, cancelEntry, createEntry, deleteComment, importEntries, postponeEntry, updateEntry } from "./domain/entries.ts";
import { completeTask, decideRequest, reassignTask, reopenTask, requestExtension } from "./domain/tasks.ts";
import { addHolidays, createAbsence, deleteAbsence, deleteHoliday } from "./domain/people.ts";
import { publishHolidays, saveHoliday } from "./domain/holidays.ts";
import { getLeaveYear, saveLeavePolicy, setLeaveAdjust } from "./domain/leave-year.ts";
import { declineSlipRequest, deleteSlip, getSlip, importSlips, listSlipRequests, listSlips, publishSlips, requestSlip, saveSlip } from "./domain/payroll.ts";
import { convertNote, deleteNote, listNotes, saveNote, toggleNote } from "./domain/notes.ts";
import { listReminders, readReminder, sendReminders } from "./domain/reminders.ts";
import { getLeaderboard } from "./domain/leaderboard.ts";
import { requestChecklistTime } from "./domain/checklist-time.ts";
import { deleteUser, recordExit, reinstateUser, setUserStatus } from "./domain/exit.ts";
import { adminChecks, adminEditRow, adminRows, adminSetDeleted, adminTables, deleteAnnouncement, listAnnouncements, saveAnnouncement } from "./domain/admin-tools.ts";
import { auditLog, getFlowData, getItemDetail, logExport, markNotificationsRead, saveSettings, searchEntries } from "./domain/read.ts";
import { cancelLeave, checkIn, checkOut, decideLeave, deleteAttendance, getPunchPhoto, importAttendance, importLeaves, kioskPunch, closeMyPunch, markAttendance, requestLeave } from "./domain/attendance.ts";
import { bulkAddChecklistTasks, completeChecklist, completeChecklistMany, generateChecklistAction, reopenChecklist, saveChecklistTask, skipChecklist } from "./domain/checklist.ts";
import { deliver, deliveryFromEnv, type DeliveryConfig } from "./domain/notify.ts";

export interface ApiResult<T = unknown> {
  ok: boolean; data?: T; changes?: CommitResult["changes"]; removed?: CommitResult["removed"]; warnings?: string[];
  error?: string; code?: string; extra?: unknown;
}

type Handler = (ctx: Ctx, d: Record<string, unknown>) => Promise<unknown>;
const ALL: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"];
const SUPER: Role[] = ["SUPER_ADMIN"];

/**
 * Every action is checked here BEFORE it runs: the person must be signed in, active, and hold `perm` (module + action).
 * Record-level checks (is this entry / person / login in their reach?) are then made inside the handler.
 * An action with neither `perm` nor a short `roles` list is open to any signed-in person (own profile, notifications, saved filters …).
 */
interface ActionDef { roles: Role[]; fn: Handler; read?: boolean; perm?: [ModuleId, Action] }

export function buildActions(live: boolean): Record<string, ActionDef> {
  const complete = (c: Ctx, d: Record<string, unknown>) => completeTask(c, { ...d, _bulk: true });
  return {
    // reads
    getFlowData: { roles: ALL, read: true, fn: (c, d) => getFlowData(c, d, live) },
    getItemDetail: { roles: ALL, read: true, perm: ["fms", "view"], fn: getItemDetail },
    searchEntries: { roles: ALL, read: true, perm: ["fms", "view"], fn: searchEntries },
    auditLog: { roles: ALL, read: true, perm: ["audit", "view"], fn: auditLog },
    getAvatar: { roles: ALL, read: true, fn: getAvatar },
    getEmployee: { roles: ALL, read: true, fn: getEmployee },
    // FMS definitions
    createFlow: { roles: ALL, perm: ["fms", "configure"], fn: createFlow },
    updateFlow: { roles: ALL, perm: ["fms", "configure"], fn: updateFlow },
    replanFlow: { roles: ALL, perm: ["fms", "configure"], fn: replanFlow },
    rotateIntakeToken: { roles: ALL, perm: ["fms", "configure"], fn: rotateIntakeToken },
    setFlowAccess: { roles: SUPER, fn: setFlowAccess },
    // entries
    createEntry: { roles: ALL, perm: ["fms", "create"], fn: createEntry },
    importEntries: { roles: ALL, perm: ["fms", "import"], fn: importEntries },
    updateEntry: { roles: ALL, perm: ["fms", "edit"], fn: updateEntry },
    postponeEntry: { roles: ALL, perm: ["fms", "edit"], fn: postponeEntry },
    cancelEntry: { roles: ALL, perm: ["fms", "delete"], fn: cancelEntry },
    addComment: { roles: ALL, perm: ["fms", "view"], fn: addComment },
    deleteComment: { roles: ALL, perm: ["fms", "view"], fn: deleteComment },
    bulkEntries: { roles: ALL, perm: ["fms", "edit"], fn: (c, d) => bulkEntries(c, d, { complete, reassign: reassignTask }) },
    // steps
    completeTask: { roles: ALL, perm: ["fms", "edit"], fn: completeTask },
    reopenTask: { roles: ALL, perm: ["fms", "delete"], fn: reopenTask },
    reassignTask: { roles: ALL, perm: ["fms", "assign"], fn: reassignTask },
    requestExtension: { roles: ALL, perm: ["fms", "edit"], fn: requestExtension },
    decideRequest: { roles: ALL, fn: decideRequest }, // FMS steps need the FMS module (checked inside); checklist requests are decided by the checklist approvers
    requestChecklistTime: { roles: ALL, perm: ["checklist", "view"], fn: requestChecklistTime },
    moveWork: { roles: ALL, fn: moveWork },
    // checklist
    saveChecklistTask: { roles: ALL, fn: saveChecklistTask },
    bulkAddChecklistTasks: { roles: ALL, perm: ["checklist", "create"], fn: bulkAddChecklistTasks },
    generateChecklist: { roles: ALL, perm: ["checklist", "manage"], fn: generateChecklistAction },
    completeChecklist: { roles: ALL, perm: ["checklist", "edit"], fn: completeChecklist },
    completeChecklistMany: { roles: ALL, perm: ["checklist", "edit"], fn: completeChecklistMany },
    reopenChecklist: { roles: ALL, perm: ["checklist", "edit"], fn: reopenChecklist },
    skipChecklist: { roles: ALL, perm: ["checklist", "manage"], fn: skipChecklist },
    // attendance & leave
    checkIn: { roles: ALL, perm: ["attendance", "create"], fn: checkIn },
    checkOut: { roles: ALL, perm: ["attendance", "create"], fn: checkOut },
    closeMyPunch: { roles: ALL, perm: ["attendance", "create"], fn: closeMyPunch },
    kioskPunch: { roles: ALL, perm: ["attendance", "manage"], fn: kioskPunch },
    markAttendance: { roles: ALL, perm: ["attendance", "edit"], fn: markAttendance },
    deleteAttendance: { roles: ALL, perm: ["attendance", "edit"], fn: deleteAttendance },
    importAttendance: { roles: ALL, perm: ["attendance", "import"], fn: importAttendance },
    importLeaves: { roles: ALL, perm: ["attendance", "import"], fn: importLeaves },
    getPunchPhoto: { roles: ALL, perm: ["attendance", "view"], fn: getPunchPhoto },
    requestLeave: { roles: ALL, perm: ["attendance", "create"], fn: requestLeave },
    decideLeave: { roles: ALL, perm: ["attendance", "view"], fn: decideLeave },
    cancelLeave: { roles: ALL, perm: ["attendance", "create"], fn: cancelLeave },
    createAbsence: { roles: ALL, perm: ["attendance", "create"], fn: createAbsence },
    deleteAbsence: { roles: ALL, perm: ["attendance", "create"], fn: deleteAbsence },
    addHolidays: { roles: ALL, perm: ["attendance", "configure"], fn: addHolidays },
    deleteHoliday: { roles: ALL, perm: ["attendance", "configure"], fn: deleteHoliday },
    saveHoliday: { roles: ALL, perm: ["attendance", "configure"], fn: saveHoliday },
    publishHolidays: { roles: ALL, perm: ["attendance", "configure"], fn: publishHolidays },
    getLeaveYear: { roles: ALL, read: true, perm: ["attendance", "view"], fn: getLeaveYear },
    saveLeavePolicy: { roles: ALL, perm: ["attendance", "configure"], fn: saveLeavePolicy },
    setLeaveAdjust: { roles: ALL, perm: ["attendance", "view"], fn: setLeaveAdjust },
    // people
    saveUser: { roles: ALL, perm: ["employees", "view"], fn: saveUser },
    bulkSaveUsers: { roles: ALL, perm: ["employees", "import"], fn: bulkSaveUsers },
    recordExit: { roles: ALL, perm: ["employees", "delete"], fn: recordExit },
    setUserStatus: { roles: ALL, perm: ["employees", "delete"], fn: setUserStatus },
    reinstateUser: { roles: ALL, perm: ["employees", "delete"], fn: reinstateUser },
    deleteUser: { roles: SUPER, fn: deleteUser },
    updateProfile: { roles: ALL, fn: updateProfile },
    saveProfilePhoto: { roles: ALL, fn: saveProfilePhoto },
    saveEmployee: { roles: ALL, fn: saveEmployee },
    markNotificationsRead: { roles: ALL, fn: markNotificationsRead },
    // access (Super Admin only)
    saveRole: { roles: SUPER, fn: saveRole },
    resetRole: { roles: SUPER, fn: resetRole },
    deleteRole: { roles: SUPER, fn: deleteRole },
    saveUserAccess: { roles: SUPER, fn: saveUserAccess },
    renameDepartment: { roles: SUPER, fn: renameDepartment },
    saveSettings: { roles: ALL, perm: ["settings", "configure"], fn: saveSettings },
    // quick access
    saveLink: { roles: ALL, perm: ["quick_access", "view"], fn: saveLink },
    deleteLink: { roles: ALL, perm: ["quick_access", "view"], fn: deleteLink },
    reorderLinks: { roles: ALL, perm: ["quick_access", "view"], fn: reorderLinks },
    adoptLink: { roles: ALL, perm: ["quick_access", "view"], fn: adoptLink },
    // credential vault (not "read": revealing writes the activity log)
    listVault: { roles: ALL, perm: ["vault", "view"], fn: listVault },
    revealVault: { roles: ALL, perm: ["vault", "view"], fn: revealVault },
    saveVault: { roles: ALL, perm: ["vault", "view"], fn: saveVault },
    deleteVault: { roles: ALL, perm: ["vault", "view"], fn: deleteVault },
    assignVault: { roles: ALL, perm: ["vault", "view"], fn: assignVault },
    // salary slips (each person sees only their own; payroll people prepare and publish)
    listSlips: { roles: ALL, read: true, perm: ["payroll", "view"], fn: listSlips },
    getSlip: { roles: ALL, perm: ["payroll", "view"], fn: getSlip },
    saveSlip: { roles: ALL, perm: ["payroll", "view"], fn: saveSlip },
    publishSlips: { roles: ALL, perm: ["payroll", "view"], fn: publishSlips },
    deleteSlip: { roles: ALL, perm: ["payroll", "view"], fn: deleteSlip },
    importSlips: { roles: ALL, perm: ["payroll", "view"], fn: importSlips },
    requestSlip: { roles: ALL, perm: ["payroll", "view"], fn: requestSlip },
    listSlipRequests: { roles: ALL, read: true, perm: ["payroll", "view"], fn: listSlipRequests },
    declineSlipRequest: { roles: ALL, perm: ["payroll", "view"], fn: declineSlipRequest },
    // private notepad (always the signed-in person's own)
    listNotes: { roles: ALL, read: true, fn: listNotes },
    saveNote: { roles: ALL, fn: saveNote },
    toggleNote: { roles: ALL, fn: toggleNote },
    deleteNote: { roles: ALL, fn: deleteNote },
    convertNote: { roles: ALL, fn: convertNote },
    // reminders
    sendReminders: { roles: ALL, perm: ["reminders", "view"], fn: sendReminders },
    listReminders: { roles: ALL, read: true, fn: listReminders },
    readReminder: { roles: ALL, fn: readReminder },
    // Super Admin console and announcements
    adminTables: { roles: SUPER, read: true, fn: adminTables },
    adminRows: { roles: SUPER, read: true, fn: adminRows },
    adminExport: { roles: SUPER, fn: (c, d) => adminRows(c, { ...d, all: true }) }, // not a read: the download is written to the activity log
    adminChecks: { roles: SUPER, read: true, fn: adminChecks },
    adminEditRow: { roles: SUPER, fn: adminEditRow },
    adminSetDeleted: { roles: SUPER, fn: adminSetDeleted },
    saveAnnouncement: { roles: SUPER, fn: saveAnnouncement },
    deleteAnnouncement: { roles: SUPER, fn: deleteAnnouncement },
    listAnnouncements: { roles: ALL, read: true, fn: listAnnouncements },
    getLeaderboard: { roles: ALL, read: true, fn: getLeaderboard },
    // filters and exports
    saveFilter: { roles: ALL, fn: saveFilter },
    deleteFilter: { roles: ALL, fn: deleteFilter },
    logExport: { roles: ALL, fn: logExport },
  };
}

export const WRITE_ACTIONS = new Set(Object.entries(buildActions(true)).filter(([, d]) => !d.read).map(([k]) => k));

export interface RunOptions { live?: boolean; delivery?: DeliveryConfig; /** tests only: pretend it is this moment */ now?: Date; /** who is calling (IP, browser): written into the activity log */ meta?: { ip?: string; device?: string } }

/** Check-in / check-out of one person run one after the other, so a double click (or two devices) cannot create two punches. */
const punchLocks = new Map<string, Promise<unknown>>();
const PUNCH_ACTIONS = new Set(["checkIn", "checkOut", "closeMyPunch", "kioskPunch"]);

export async function runAction(db: Db, actorId: string, action: string, data: Record<string, unknown>, opts: RunOptions = {}): Promise<ApiResult> {
  if (!PUNCH_ACTIONS.has(action)) return runActionNow(db, actorId, action, data, opts);
  const key = action === "kioskPunch" ? "kiosk" : actorId;
  const before = punchLocks.get(key) ?? Promise.resolve();
  const mine = before.catch(() => undefined).then(() => runActionNow(db, actorId, action, data, opts));
  punchLocks.set(key, mine);
  try { return await mine; } finally { if (punchLocks.get(key) === mine) punchLocks.delete(key); }
}

async function runActionNow(db: Db, actorId: string, action: string, data: Record<string, unknown>, opts: RunOptions = {}): Promise<ApiResult> {
  try {
    const def = buildActions(opts.live ?? true)[action];
    if (!def) return { ok: false, code: "BAD_ACTION", error: `Unknown action "${action}"` };
    if (actorId === "cron" || actorId === "intake") throw new MidapError("UNAUTHORIZED", "Unknown or inactive user"); // system actors are internal only
    const ctx = await makeCtx(db, actorId, opts.now);
    if (opts.meta) ctx.tx.meta = opts.meta;
    if (!def.roles.includes(ctx.actor.role as Role)) throw new MidapError("FORBIDDEN", "Your role cannot do this");
    if (def.perm) ctx.require(def.perm[0], def.perm[1], "You do not have access to this. Ask the Super Admin.");
    const result = await def.fn(ctx, data ?? {});
    if (def.read) return { ok: true, data: result };
    const { changes, removed } = await ctx.tx.commit();
    if (ctx.outbox.length) await sendOutbox(ctx, opts.delivery ?? deliveryFromEnv());
    return { ok: true, data: result, changes, removed, warnings: ctx.warnings };
  } catch (e) {
    if (e instanceof MidapError) return { ok: false, code: e.code, error: e.message, extra: e.extra };
    return { ok: false, code: "SERVER", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendOutbox(ctx: Ctx, cfg: DeliveryConfig) {
  const { Users } = await ctx.db.load(["Users"]);
  const r = await deliver(cfg, ctx.deliverable(Users), Users, ctx.setting("COMPANY_NAME", "MIDAP"));
  if (r.errors.length) ctx.warnings.push(...r.errors.slice(0, 3).map((e) => `Could not send: ${e}`));
}
