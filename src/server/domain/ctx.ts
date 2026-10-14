/** Per-request context: who is acting, the clock, settings, the unit of work, and queued notifications. */
import type { Flow } from "../../lib/flow-types.ts";
import { parseFlow } from "../../lib/flow-parse.ts";
import type { FlowRec } from "../../lib/flow-types.ts";
import { Db, MidapError, newId, require_, type Rec, type Tx } from "../sheets/db.ts";
import { DEFAULT_SETTINGS } from "../sheets/schema.ts";
import { allows, capAllowed, effectivePermSet, moduleOfNotification, parsePermSet, reachOf, roleTemplate, scopeOfGrant, type Action, type Cap, type ModuleId, type PermSet, type Reach } from "../../lib/permissions.ts";
import { calendarFor } from "./engine.ts";
import { clockNow, type Calendar, type Clock } from "./time.ts";

export interface Outbox { userId: string; type: string; title: string; body: string; link: string }

export class Ctx {
  db: Db;
  tx: Tx;
  actor: Rec;
  clock: Clock;
  settings: Record<string, string>;
  warnings: string[] = [];
  outbox: Outbox[] = [];

  roles: Rec[];
  system: boolean;

  constructor(db: Db, actor: Rec, settings: Record<string, string>, now?: Date, roles: Rec[] = [], system = false) {
    this.db = db;
    this.actor = actor;
    this.settings = settings;
    this.roles = roles;
    this.system = system;
    this.clock = clockNow(settings.TIMEZONE, now);
    this.tx = db.begin(String(actor.userId));
    this.tx.stamp = this.clock.stamp;
  }

  get actorId(): string { return String(this.actor.userId); }
  /** Anyone above Team Member. Kept for display logic only — security checks use allow() / require() / manages(). */
  get isAdmin(): boolean { return this.actor.role !== "STAFF"; }
  get isSuper(): boolean { return this.actor.role === "SUPER_ADMIN"; }

  /** What a person can do: template of their role (or custom role), plus their personal overrides. */
  permsOf(user: Rec): PermSet {
    const role = String(user.role);
    if (role === "SUPER_ADMIN") return effectivePermSet(role, {});
    const custom = user.roleId ? this.roles.find((r) => r.roleId === user.roleId && r.deleted !== "Y") : undefined;
    let stored: PermSet | undefined;
    if (custom) stored = parsePermSet(custom.permsJson);
    else { const all = (() => { try { return JSON.parse(this.settings.PERMISSIONS || "{}") as Record<string, unknown>; } catch { return {}; } })(); const t = all[role]; stored = t ? parsePermSet(t) : undefined; const row = this.roles.find((r) => r.roleId === role && r.deleted !== "Y"); if (row) stored = parsePermSet(row.permsJson); }
    const template = custom ? stored ?? {} : roleTemplate(role, stored);
    return effectivePermSet(role, template, parsePermSet(user.permsJson));
  }
  private permCache?: PermSet;
  /** What the person making this request may do. Deny by default. */
  get perms(): PermSet { return (this.permCache ??= this.system ? effectivePermSet("SUPER_ADMIN", {}) : this.permsOf(this.actor)); }
  allow(module: ModuleId, action: Action): boolean { return this.isSuper || this.system || allows(this.perms, module, action); }
  /** Refuses (FORBIDDEN) unless the person has this module + action. Every sensitive operation starts with this. */
  require(module: ModuleId, action: Action, message = "You do not have access to this. Ask the Super Admin.") {
    if (!this.allow(module, action)) throw new MidapError("FORBIDDEN", message);
  }
  /** Older single-word capabilities (see CAP_MAP in lib/permissions.ts). */
  can(cap: Cap): boolean { return this.isSuper || this.system || capAllowed(this.perms, cap); }

  /** What may be sent by email / WhatsApp: only about modules the receiver can open (no leaking through messages). */
  deliverable(users: Rec[]): Outbox[] {
    const byId = new Map(users.map((u) => [String(u.userId), u]));
    return this.outbox.filter((n) => {
      const u = byId.get(n.userId);
      const m = moduleOfNotification(n);
      return !!u && (!m || allows(this.permsOf(u), m, "view"));
    });
  }

  private reachCache = new Map<string, Reach>();
  /** Whose records the person may see in a module (own · team · department · all). */
  async reach(module: ModuleId): Promise<Reach> {
    const hit = this.reachCache.get(module);
    if (hit) return hit;
    const users = await this.tx.rows("Users");
    const scope = this.isSuper || this.system ? "all" : this.allow(module, "view") ? scopeOfGrant(this.perms, module) : "own";
    const r = reachOf({ userId: this.actorId, role: String(this.actor.role), department: String(this.actor.department ?? "") }, users as unknown as Parameters<typeof reachOf>[1], this.system ? "all" : scope);
    this.reachCache.set(module, r);
    return r;
  }

  /** May the actor act on ANOTHER person's records in a module? Super Admin: yes. Others: only inside their reach and with the right to edit / manage (never "yourself" — that is a separate, simpler rule). */
  async manages(userId: string, module: ModuleId = "attendance"): Promise<boolean> {
    if (this.isSuper || this.system) return true;
    if (userId === this.actorId) return false;
    if (!(this.allow(module, "edit") || this.allow(module, "manage"))) return false;
    const r = await this.reach(module);
    return r.all || r.ids.has(userId);
  }

  /** Refuse (FORBIDDEN) when the person is outside the actor's reach for that module. */
  async requireInReach(userId: string, module: ModuleId = "attendance") {
    if (userId === this.actorId) return;
    const r = await this.reach(module);
    if (!(r.all || r.ids.has(userId))) throw new MidapError("FORBIDDEN", "That person is outside your access");
  }

  setting(key: string, fallback = ""): string { return this.settings[key] ?? fallback; }
  settingNum(key: string): number { const n = Number(this.settings[key]); return isNaN(n) ? 0 : n; }

  /** The flow as a working copy plus its parsed definition. */
  async flow(flowId: string): Promise<{ rec: Rec; flow: Flow }> {
    const rec = (await this.tx.rows("Flows")).find((f) => f.flowId === flowId);
    require_(rec, `Unknown FMS ${flowId}`);
    return { rec, flow: parseFlow(rec as unknown as FlowRec) };
  }

  async calendar(flow: Flow): Promise<Calendar> {
    return calendarFor(flow, await this.tx.rows("Holidays"));
  }

  async user(userId: string): Promise<Rec | undefined> {
    return (await this.tx.rows("Users")).find((u) => u.userId === userId);
  }

  /** Queue an in-app notification (stored in the sheet) and, after commit, email / WhatsApp if configured. */
  notice(n: { userId: string; type: string; title: string; body?: string; link?: string; itemId?: string; taskId?: string; dedupeKey?: string; self?: boolean }) {
    if (!n.userId || (n.userId === this.actorId && !n.self)) return;
    this.tx.insert("Notifications", {
      notifId: newId("NTF"), userId: n.userId, type: n.type, title: n.title, body: n.body ?? "", link: n.link ?? "", itemId: n.itemId ?? "",
      taskId: n.taskId ?? "", dedupeKey: n.dedupeKey ?? "", channels: "app", createdAt: this.clock.stamp, readAt: "",
    });
    this.outbox.push({ userId: n.userId, type: n.type, title: n.title, body: n.body ?? "", link: n.link ?? "" });
  }
}

export async function loadSettings(db: Db): Promise<Record<string, string>> {
  const { Settings } = await db.load(["Settings"]);
  const s: Record<string, string> = {};
  for (const [k, v] of DEFAULT_SETTINGS) s[k] = v;
  for (const r of Settings) if (r.key) s[String(r.key)] = String(r.value ?? "");
  return s;
}

/** Build a context for a signed-in user. System actors ("intake", "cron") are allowed for internal callers only. */
export async function makeCtx(db: Db, actorId: string, now?: Date): Promise<Ctx> {
  await db.ensureReadyOnce();
  const settings = await loadSettings(db);
  const { Roles } = await db.load(["Roles"]);
  if (actorId === "intake" || actorId === "cron") {
    return new Ctx(db, { userId: actorId, name: actorId === "intake" ? "Form intake" : "Scheduler", role: "ADMIN", status: "Active" }, settings, now, Roles, true);
  }
  const { Users } = await db.load(["Users"]);
  const actor = Users.find((u) => u.userId === actorId);
  if (!actor || actor.status !== "Active") throw new MidapError("UNAUTHORIZED", "Unknown or inactive user");
  return new Ctx(db, { ...actor }, settings, now, Roles);
}
