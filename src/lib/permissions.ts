// Who can do what — one model for the whole app (server and browser).
//   MODULE  × ACTION   → what you may do        (example: fms + create)
//   SCOPE              → whose records you see   (own · team · department · all)
// A role is a template of module grants. A person has a role (and optionally a custom role) plus personal overrides.
// DENY BY DEFAULT: a module that is not granted does not exist for that person.
import type { Role } from "./types.ts";

export type ModuleId = "fms" | "checklist" | "attendance" | "scorecard" | "quick_access" | "vault" | "employees" | "reports" | "settings" | "audit";
export type Action = "view" | "create" | "edit" | "delete" | "assign" | "approve" | "export" | "import" | "manage" | "configure";
export type Scope = "own" | "team" | "department" | "all";

export const ACTIONS: { id: Action; label: string; hint: string }[] = [
  { id: "view", label: "View", hint: "See records" },
  { id: "create", label: "Create", hint: "Add new records" },
  { id: "edit", label: "Edit", hint: "Change records (tick, update, correct)" },
  { id: "delete", label: "Delete", hint: "Cancel / remove records" },
  { id: "assign", label: "Assign", hint: "Give work to someone, move or hand over" },
  { id: "approve", label: "Approve", hint: "Decide requests (leave, more time)" },
  { id: "export", label: "Export", hint: "Download data" },
  { id: "import", label: "Import", hint: "Bring in data from a file" },
  { id: "manage", label: "Manage", hint: "Everything for other people's records in reach" },
  { id: "configure", label: "Configure", hint: "Change how the module works" },
];

export interface ModuleDef { id: ModuleId; label: string; hint: string; actions: Action[]; scoped: boolean }
export const MODULES: ModuleDef[] = [
  { id: "fms", label: "FMS", hint: "Processes, entries and their steps (My tasks, Approvals)", actions: ["view", "create", "edit", "delete", "assign", "approve", "export", "import", "manage", "configure"], scoped: true },
  { id: "checklist", label: "Checklist", hint: "Daily, weekly, monthly and one-time tasks", actions: ["view", "create", "edit", "delete", "assign", "export", "import", "manage"], scoped: true },
  { id: "attendance", label: "Attendance & leave", hint: "Check in / out, leave, holidays, kiosk", actions: ["view", "create", "edit", "approve", "export", "import", "manage", "configure"], scoped: true },
  { id: "scorecard", label: "Scorecard", hint: "Weekly % done and % on time", actions: ["view", "export", "manage"], scoped: true },
  { id: "quick_access", label: "Quick Access", hint: "Shortcuts to the tools you use", actions: ["view", "create", "edit", "delete", "manage"], scoped: false },
  { id: "vault", label: "Credential Vault", hint: "Shared logins, encrypted. Only what is assigned to you", actions: ["view", "create", "edit", "delete", "assign", "manage"], scoped: false },
  { id: "employees", label: "Employees", hint: "People, departments, reporting managers, details", actions: ["view", "create", "edit", "delete", "assign", "export", "import", "manage"], scoped: true },
  { id: "reports", label: "Reports & insights", hint: "Who delivers on time, which FMS runs late", actions: ["view", "export"], scoped: true },
  { id: "settings", label: "Settings", hint: "Company rules, reminders, attendance rules", actions: ["view", "configure"], scoped: false },
  { id: "audit", label: "Activity logs", hint: "Every change: who did what and when", actions: ["view", "export"], scoped: true },
];
export const MODULE_IDS = MODULES.map((m) => m.id);
export const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "own", label: "Only their own", hint: "Records assigned to / created by them" },
  { id: "team", label: "Their team", hint: "Themselves and everyone who reports to them" },
  { id: "department", label: "Their department", hint: "Team plus everyone in the same department" },
  { id: "all", label: "Everyone", hint: "Every department" },
];
const SCOPE_RANK: Record<Scope, number> = { own: 0, team: 1, department: 2, all: 3 };

export interface Grant { a: Action[]; s: Scope }
export type PermSet = Partial<Record<ModuleId, Grant>>;
export type SystemRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "STAFF";

export const ROLE_INFO: Record<SystemRole, { label: string; hint: string }> = {
  SUPER_ADMIN: { label: "Super Admin", hint: "Everything. Cannot be restricted." },
  ADMIN: { label: "Admin", hint: "Almost everything, except the Super Admin's own controls." },
  MANAGER: { label: "Manager", hint: "Looks after their team and the modules given to them." },
  STAFF: { label: "Team Member", hint: "Only their own work, in the modules given to them." },
};

const all = (m: ModuleId): Action[] => MODULES.find((x) => x.id === m)!.actions;
const g = (a: Action[], s: Scope): Grant => ({ a, s });

/** Starting points. The Super Admin can change any of them (Access & roles). */
export const DEFAULT_TEMPLATES: Record<Exclude<SystemRole, "SUPER_ADMIN">, PermSet> = {
  ADMIN: {
    fms: g(all("fms"), "department"), checklist: g(all("checklist"), "department"), attendance: g(all("attendance").filter((x) => x !== "configure"), "department"),
    scorecard: g(all("scorecard"), "department"), quick_access: g(all("quick_access"), "all"), vault: g(["view"], "own"), employees: g(all("employees"), "department"),
    reports: g(["view", "export"], "department"), audit: g(["view"], "department"),
  },
  MANAGER: {
    fms: g(["view", "create", "edit", "assign", "approve", "export"], "team"), checklist: g(["view", "create", "edit", "assign", "export"], "team"),
    attendance: g(["view", "create", "edit", "approve", "export"], "team"), scorecard: g(["view", "export"], "team"), quick_access: g(["view", "create", "edit", "delete"], "all"),
    employees: g(["view", "edit"], "team"), reports: g(["view", "export"], "team"),
  },
  STAFF: {
    fms: g(["view", "create", "edit"], "own"), checklist: g(["view", "edit"], "own"), attendance: g(["view", "create"], "own"), scorecard: g(["view"], "own"),
    quick_access: g(["view", "create", "edit", "delete"], "all"), employees: g(["view"], "own"),
  },
};

const FULL: PermSet = Object.fromEntries(MODULES.map((m) => [m.id, { a: [...m.actions], s: "all" as Scope }])) as PermSet;

const isAction = (x: unknown): x is Action => ACTIONS.some((a) => a.id === x);
const isScope = (x: unknown): x is Scope => x === "own" || x === "team" || x === "department" || x === "all";

/** Anything stored as JSON is cleaned before use: unknown modules / actions are dropped. */
export function parsePermSet(json: unknown): PermSet {
  let v: unknown = json;
  if (typeof json === "string") { try { v = JSON.parse(json || "{}"); } catch { return {}; } }
  if (!v || typeof v !== "object") return {};
  const out: PermSet = {};
  for (const m of MODULES) {
    const raw = (v as Record<string, unknown>)[m.id] as { a?: unknown; s?: unknown } | undefined;
    if (!raw || typeof raw !== "object") continue;
    const a = (Array.isArray(raw.a) ? raw.a : []).filter(isAction).filter((x) => m.actions.includes(x));
    out[m.id] = { a: [...new Set(a)], s: isScope(raw.s) ? raw.s : "own" };
  }
  return out;
}
export const stringifyPermSet = (p: PermSet) => JSON.stringify(parsePermSet(p));

/** The grants a role gives (template). A system role's template can be edited by the Super Admin, so it comes in as `stored`. */
export function roleTemplate(role: SystemRole | string, stored?: PermSet): PermSet {
  if (role === "SUPER_ADMIN") return FULL;
  const base = DEFAULT_TEMPLATES[role as "ADMIN" | "MANAGER" | "STAFF"] ?? {};
  return stored && Object.keys(stored).length ? { ...base, ...stored } : base;
}

/** What one person can really do: the template of their role (or custom role), then their personal overrides on top. */
export function effectivePermSet(role: SystemRole | string, template: PermSet, overrides: PermSet = {}): PermSet {
  if (role === "SUPER_ADMIN") return FULL;
  const out: PermSet = { ...template };
  for (const [m, grant] of Object.entries(overrides) as [ModuleId, Grant][]) out[m] = grant;
  return out;
}

export const allows = (p: PermSet, m: ModuleId, a: Action) => !!p[m]?.a.includes(a);
export const hasModule = (p: PermSet, m: ModuleId) => !!p[m] && p[m]!.a.length > 0;
export const scopeOfGrant = (p: PermSet, m: ModuleId): Scope => p[m]?.s ?? "own";
/** Is this person allowed to see more than their own records in this module? */
export const widerThanOwn = (p: PermSet, m: ModuleId) => SCOPE_RANK[scopeOfGrant(p, m)] > 0;

// ---------------- older single-word capabilities → module + action (keeps existing screens working) ----------------

export type Cap =
  | "createFms" | "addEntries" | "cancelEntries" | "decideRequests" | "manageChecklist" | "editAttendance" | "useKiosk" | "approveLeave"
  | "manageTeam" | "seeEmployeeDetails" | "manageHolidays" | "viewInsights" | "viewAudit" | "moveWork";
export const CAP_MAP: Record<Cap, [ModuleId, Action]> = {
  createFms: ["fms", "configure"], addEntries: ["fms", "create"], cancelEntries: ["fms", "delete"], decideRequests: ["fms", "approve"], moveWork: ["fms", "assign"],
  manageChecklist: ["checklist", "manage"], editAttendance: ["attendance", "edit"], useKiosk: ["attendance", "manage"], approveLeave: ["attendance", "approve"],
  manageHolidays: ["attendance", "configure"], manageTeam: ["employees", "manage"], seeEmployeeDetails: ["employees", "view"], viewInsights: ["reports", "view"], viewAudit: ["audit", "view"],
};
export const capAllowed = (p: PermSet, cap: Cap) => allows(p, ...CAP_MAP[cap]);
export const capsOf = (p: PermSet): Record<Cap, boolean> => Object.fromEntries((Object.keys(CAP_MAP) as Cap[]).map((c) => [c, capAllowed(p, c)])) as Record<Cap, boolean>;

// ---------------- whose records are in reach ----------------

export interface ScopeUser { userId: string; managerId?: string; department?: string; status?: string }
export interface Reach { all: boolean; ids: Set<string> }

/** The people whose records `me` may see for a module: own · team (me + everyone who reports up to me) · department (team + same department) · all. */
export function reachOf(me: { userId: string; role: string; department?: string }, users: ScopeUser[], scope: Scope): Reach {
  if (me.role === "SUPER_ADMIN" || scope === "all") return { all: true, ids: new Set(users.map((u) => u.userId)) };
  const ids = new Set<string>([me.userId]);
  if (scope === "own") return { all: false, ids };
  const queue = [me.userId];
  while (queue.length) {
    const boss = queue.pop()!;
    for (const u of users) if (u.managerId === boss && !ids.has(u.userId)) { ids.add(u.userId); queue.push(u.userId); }
  }
  if (scope === "department") {
    const dept = (me.department ?? "").trim().toLowerCase();
    if (dept) for (const u of users) if ((u.department ?? "").trim().toLowerCase() === dept) ids.add(u.userId);
  }
  return { all: false, ids };
}
export const inReach = (r: Reach, userId: string) => r.all || r.ids.has(userId);

/** Everyone below `userId` in the reporting line (not including them). */
export function reportsOf(userId: string, users: ScopeUser[]): Set<string> {
  const out = new Set<string>();
  const queue = [userId];
  while (queue.length) {
    const boss = queue.pop()!;
    for (const u of users) if (u.managerId === boss && !out.has(u.userId) && u.userId !== userId) { out.add(u.userId); queue.push(u.userId); }
  }
  return out;
}

/** Can this person see this FMS (process)? Only the Super Admin sees a switched-off one; "departments" / "allowedUsers" narrow who may use it. */
export function flowVisible(f: { status?: string; departments?: string; allowedUsers?: string }, me: { userId?: string; role: string; department?: string }, seesAll: boolean): boolean {
  if (me.role === "SUPER_ADMIN") return true;
  if (f.status === "Archived") return false;
  const deps = String(f.departments ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const users = String(f.allowedUsers ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!deps.length && !users.length) return true;
  if (seesAll) return true;
  if (me.userId && users.includes(me.userId)) return true;
  return deps.includes((me.department ?? "").trim().toLowerCase());
}

export type RoleKey = Role | SystemRole;

/** Which module a notification belongs to (so nobody is told about data they cannot open). "" = about the person's own access: always shown. */
export function moduleOfNotification(n: { link?: unknown; type?: unknown }): ModuleId | "" {
  const link = String(n.link ?? ""), type = String(n.type ?? "");
  if (type === "access") return "";
  if (link.startsWith("/flows/attendance") || /^(checkin|checkout|leave)/.test(type)) return "attendance";
  if (link.startsWith("/flows/checklist") || type.startsWith("checklist")) return "checklist";
  if (link.startsWith("/flows/vault") || type === "vault") return "vault";
  if (link.startsWith("/flows/users") || link.startsWith("/flows/profile")) return "employees";
  return "fms";
}
