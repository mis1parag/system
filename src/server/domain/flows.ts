/** FMS definitions: create / edit / archive, re-plan, intake token. */
import { randomBytes } from "node:crypto";
import type { AssignRule, Flow, FlowField, FlowRule, FlowStep, Recurrence, StepCondition } from "../../lib/flow-types.ts";
import { parseFlow } from "../../lib/flow-parse.ts";
import type { FlowRec } from "../../lib/flow-types.ts";
import { newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { calendarFor, pickAssignee, planTasks, syncConditions, refreshItemStatus, type Data } from "./engine.ts";
import { isTime } from "./time.ts";

const FIELD_TYPES = ["text", "textarea", "number", "date", "datetime", "select", "checkbox", "url", "phone"];
const RULE_BASES = ["none", "anchor", "field", "created", "prev_actual"];
const OPS = ["eq", "neq", "in", "gt", "lt", "filled", "empty"];
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export function slug(s: string, used: Set<string>): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "field";
  let key = base, n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  used.add(key);
  return key;
}

function buildFields(list: unknown, label: string, requireOne: boolean): FlowField[] {
  const input = Array.isArray(list) ? list : [];
  require_(!requireOne || input.length > 0, `Add at least one ${label}`);
  const used = new Set<string>();
  // keep explicit keys first so a new field never steals an existing key
  input.forEach((f) => { if (str((f as Record<string, unknown>).key)) used.add(str((f as Record<string, unknown>).key)); });
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const f = raw as Record<string, unknown>;
    const lab = str(f.label);
    require_(lab, `${label} ${i + 1} needs a label`);
    const type = str(f.type) || "text";
    require_(FIELD_TYPES.includes(type), `${lab}: invalid type`);
    let key = str(f.key);
    if (!key || seen.has(key)) { used.delete(key); key = slug(lab, used); }
    seen.add(key);
    const o: FlowField = { key, label: lab, type: type as FlowField["type"], required: !!f.required };
    if (f.unique) o.unique = true;
    if (type === "select") {
      o.options = (Array.isArray(f.options) ? f.options : String(f.options ?? "").split(",")).map(str).filter(Boolean);
      require_(o.options.length > 0, `${lab}: add at least one option`);
    }
    return o;
  });
}

function buildRule(rule: unknown, label: string, fields: FlowField[], anchor: string, index: number): FlowRule {
  const r = (rule ?? { base: "none" }) as Record<string, unknown>;
  const base = str(r.base) || "none";
  require_(RULE_BASES.includes(base), `${label}: invalid timing rule`);
  const out: FlowRule = { base: base as FlowRule["base"] };
  if (base === "none") return out;
  const off = r.offsetDays === undefined || r.offsetDays === "" ? 0 : Number(r.offsetDays);
  require_(!isNaN(off) && Math.abs(off) <= 365, `${label}: working-day offset must be a number between -365 and 365`);
  out.offsetDays = Math.trunc(off);
  if (str(r.timeOfDay)) { require_(isTime(r.timeOfDay), `${label}: time must be HH:mm`); out.timeOfDay = str(r.timeOfDay); }
  const oh = r.offsetHours === undefined || r.offsetHours === "" ? 0 : Number(r.offsetHours);
  require_(!isNaN(oh) && Math.abs(oh) <= 1440, `${label}: hours offset must be a number`);
  if (oh) out.offsetHours = oh;
  if (base === "anchor") require_(anchor, `${label} uses the schedule date, so choose a schedule date field`);
  if (base === "field") {
    const f = fields.find((x) => x.key === str(r.field));
    require_(f && (f.type === "date" || f.type === "datetime"), `${label}: the start field must be a date / date-time field`);
    out.field = f.key;
  }
  if (base === "prev_actual") require_(index > 0, `${label}: the first step cannot depend on a previous step`);
  return out;
}

async function buildFlowDef(ctx: Ctx, d: Record<string, unknown>, existing: Rec | null) {
  const name = str(d.name);
  require_(name, "FMS name is required");
  const flows = await ctx.tx.rows("Flows");
  require_(!flows.some((f) => f !== existing && String(f.name).toLowerCase() === name.toLowerCase()), `Another FMS is already called "${name}"`);
  const users = await ctx.tx.rows("Users");
  const activeUser = (id: string) => users.some((u) => u.userId === id && u.status === "Active");

  const fields = buildFields(d.fields, "entry field", true);
  const anchor = str(d.anchorField);
  if (anchor) require_(fields.some((f) => f.key === anchor && (f.type === "date" || f.type === "datetime")), "Schedule date must be a date / date-time field");
  const group = str(d.groupField);
  if (group) require_(fields.some((f) => f.key === group), "Group-by field not found");
  let titleFields = (Array.isArray(d.titleFields) ? d.titleFields : String(d.titleFields ?? "").split(",")).map(str).filter(Boolean);
  titleFields.forEach((k) => require_(fields.some((f) => f.key === k), `Title field ${k} not found`));
  if (!titleFields.length) titleFields = [fields[0].key];

  const inSteps = Array.isArray(d.steps) ? (d.steps as Record<string, unknown>[]) : [];
  require_(inSteps.length > 0, "Add at least one step");
  let maxN = 0;
  inSteps.forEach((s) => { const m = /^s(\d+)$/.exec(str(s.stepId)); if (m && +m[1] > maxN) maxN = +m[1]; });
  const stepIds = new Set<string>();
  const steps: FlowStep[] = inSteps.map((s, i) => {
    const label = `Step ${i + 1}${str(s.name) ? ` (${str(s.name)})` : ""}`;
    require_(str(s.name), `Step ${i + 1} needs a name`);
    const assignIn = (s.assign ?? null) as Record<string, unknown> | null;
    let assign: AssignRule | undefined;
    if (assignIn && str(assignIn.type) && str(assignIn.type) !== "fixed") {
      const type = str(assignIn.type);
      require_(["field", "pool"].includes(type), `${label}: invalid assignment rule`);
      if (type === "field") {
        const f = fields.find((x) => x.key === str(assignIn.field));
        require_(f, `${label}: choose the field that decides who does this step`);
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries((assignIn.map ?? {}) as Record<string, unknown>)) {
          if (!str(k) || !str(v)) continue;
          require_(activeUser(str(v)), `${label}: ${str(v)} is not an active user`);
          map[str(k)] = str(v);
        }
        assign = { type: "field", field: f.key, map };
      } else {
        const pool = (Array.isArray(assignIn.pool) ? assignIn.pool : []).map(str).filter(Boolean);
        require_(pool.length > 0, `${label}: pick at least one person for the pool`);
        pool.forEach((id) => require_(activeUser(id), `${label}: ${id} is not an active user`));
        assign = { type: "pool", pool, poolMode: str(assignIn.poolMode) === "least_load" ? "least_load" : "round_robin" };
      }
    }
    const assignee = str(s.assigneeId) || (assign?.type === "pool" ? assign.pool![0] : "");
    require_(assignee, `${label} needs a responsible person`);
    require_(activeUser(assignee), `${label}: ${assignee} must be an active user`);
    const backup = str(s.backupId);
    if (backup) require_(activeUser(backup), `${label}: backup must be an active user`);
    let stepId = str(s.stepId);
    if (!stepId || stepIds.has(stepId)) stepId = `s${++maxN}`;
    stepIds.add(stepId);

    let condition: StepCondition | undefined;
    const cIn = (s.condition ?? null) as Record<string, unknown> | null;
    if (cIn && str(cIn.field)) {
      require_(fields.some((f) => f.key === str(cIn.field)), `${label}: the condition field was not found`);
      require_(OPS.includes(str(cIn.op)), `${label}: invalid condition`);
      condition = { field: str(cIn.field), op: str(cIn.op) as StepCondition["op"], value: str(cIn.value) };
    }
    const cf = buildFields(s.completionFields, `${label}: completion field`, false);
    const mins = (v: unknown, what: string) => { const n = v === undefined || v === "" || v === null ? 0 : Number(v); require_(!isNaN(n) && n >= 0 && n <= 60 * 24 * 30, `${label}: ${what} must be a number of minutes`); return Math.trunc(n); };
    const escalateTo = str(s.escalateToId);
    if (escalateTo) require_(activeUser(escalateTo), `${label}: escalation person must be an active user`);
    const out: FlowStep = {
      stepId, name: str(s.name), assigneeId: assignee, backupId: backup, how: str(s.how), whenText: str(s.whenText),
      rule: buildRule(s.rule, label, fields, anchor, i), sequential: !!s.sequential, autoDone: !!s.autoDone,
    };
    if (assign) out.assign = assign;
    if (condition) out.condition = condition;
    if (cf.length) out.completionFields = cf;
    const rm = mins(s.reminderMinutes, "reminder"), em = mins(s.escalateAfterMinutes, "escalation time");
    if (rm) out.reminderMinutes = rm;
    if (em) out.escalateAfterMinutes = em;
    if (escalateTo) out.escalateToId = escalateTo;
    return out;
  });

  const off = str(d.weeklyOff === undefined ? "0" : d.weeklyOff).split(",").map(str).filter((x) => x !== "");
  off.forEach((x) => require_(/^[0-6]$/.test(x), "Weekly off days must be 0-6 (0 = Sunday)"));
  const ws = str(d.workStart) || "09:30", we = str(d.workEnd) || "18:00";
  require_(isTime(ws) && isTime(we), "Working hours must be HH:mm");
  const sla = Number(d.slaDays) || 0;
  require_(sla >= 0 && sla <= 365, "SLA must be 0-365 working days");

  let recurrence: Recurrence | null = null;
  const rIn = (d.recurrence ?? null) as Record<string, unknown> | null;
  if (rIn && rIn.enabled) {
    const freq = str(rIn.freq);
    require_(["daily", "weekly", "monthly"].includes(freq), "Recurrence must be daily, weekly or monthly");
    require_(isTime(rIn.time), "Recurrence time must be HH:mm");
    const wd = (Array.isArray(rIn.weekdays) ? rIn.weekdays : []).map(Number).filter((x) => x >= 0 && x <= 6);
    if (freq === "weekly") require_(wd.length > 0, "Pick the weekdays for the weekly recurrence");
    const md = Number(rIn.monthDay) || 0;
    if (freq === "monthly") require_(md >= 1 && md <= 31, "Pick the day of the month");
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries((rIn.data ?? {}) as Record<string, unknown>)) if (fields.some((f) => f.key === k) && str(v)) data[k] = str(v);
    recurrence = { enabled: true, freq: freq as Recurrence["freq"], time: str(rIn.time), weekdays: wd, monthDay: md, data, skipOffDays: !!rIn.skipOffDays };
  }

  return {
    name, description: str(d.description),
    // switching an FMS off (employees stop seeing it) and limiting it to departments is the Super Admin's decision
    status: ctx.isSuper ? (str(d.status) === "Archived" ? "Archived" : "Active") : String(existing?.status ?? "Active"),
    departments: ctx.isSuper && d.departments !== undefined ? deptList(d.departments) : String(existing?.departments ?? ""),
    anchorField: anchor,
    openLabel: str(d.openLabel) || "In progress", doneLabel: str(d.doneLabel) || "Completed", titleFields: titleFields.join(","), groupField: group,
    weeklyOff: off.join(","), workStart: ws, workEnd: we, slaDays: sla, recurrenceJson: recurrence ? JSON.stringify(recurrence) : "",
    fieldsJson: JSON.stringify(fields), stepsJson: JSON.stringify(steps),
  };
}

const deptList = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean))].join(",");

/** Super Admin: switch an FMS on / off and choose which departments see it. */
export async function setFlowAccess(ctx: Ctx, d: Record<string, unknown>) {
  const { rec } = await ctx.flow(str(d.flowId));
  const before = { status: rec.status, departments: rec.departments, allowedUsers: rec.allowedUsers };
  if (d.status !== undefined) { require_(d.status === "Active" || d.status === "Archived", "Status must be Active or Inactive"); rec.status = d.status; }
  if (d.departments !== undefined) rec.departments = deptList(d.departments);
  if (d.allowedUsers !== undefined) {
    const ids = deptList(d.allowedUsers).split(",").filter(Boolean);
    const known = new Set((await ctx.tx.rows("Users")).map((u) => String(u.userId)));
    require_(ids.every((x) => known.has(x)), "Choose people from the list");
    rec.allowedUsers = ids.join(",");
  }
  rec.updatedAt = ctx.clock.stamp;
  ctx.tx.audit(rec.status === "Archived" ? "FMS switched off" : "FMS access changed", "Flows", String(rec.flowId), before, { status: rec.status, departments: rec.departments, allowedUsers: rec.allowedUsers });
  return pub("Flows", rec);
}

export async function createFlow(ctx: Ctx, d: Record<string, unknown>) {
  const def = await buildFlowDef(ctx, d, null);
  const rec = ctx.tx.insert("Flows", {
    flowId: newId("FLW"), ...def, intakeToken: randomBytes(18).toString("hex"), lastRunAt: def.recurrenceJson ? ctx.clock.dt : "", createdAt: ctx.clock.stamp, createdBy: ctx.actorId, updatedAt: ctx.clock.stamp,
  });
  ctx.tx.audit("FMS created", "Flows", String(rec.flowId), null, { name: def.name, steps: JSON.parse(def.stepsJson).length });
  return pub("Flows", rec);
}

export async function updateFlow(ctx: Ctx, d: Record<string, unknown>) {
  const { rec, flow: old } = await ctx.flow(str(d.flowId));
  const def = await buildFlowDef(ctx, d, rec);
  const newSteps = JSON.parse(def.stepsJson) as FlowStep[];
  const items = (await ctx.tx.rows("Flow_Items")).filter((i) => i.flowId === rec.flowId);
  for (const s of old.steps) {
    if (!newSteps.some((n) => n.stepId === s.stepId)) require_(!items.length, `Step "${s.name}" already has entries and cannot be removed. Keep it, or archive this FMS and create a new one.`);
  }
  const timingChanged = def.anchorField !== rec.anchorField || def.weeklyOff !== rec.weeklyOff || def.workEnd !== rec.workEnd ||
    JSON.stringify(newSteps.map((s) => [s.stepId, s.rule])) !== JSON.stringify(old.steps.map((s) => [s.stepId, s.rule]));
  const before = { name: rec.name, status: rec.status };
  Object.assign(rec, def, { updatedAt: ctx.clock.stamp });
  if (!def.recurrenceJson) rec.lastRunAt = ""; else if (!rec.lastRunAt) rec.lastRunAt = ctx.clock.dt;
  const flow = parseFlow({ ...rec } as unknown as FlowRec); // a copy: parsed definitions are cached per object
  ctx.tx.audit("FMS edited", "Flows", String(rec.flowId), before, { name: def.name, status: def.status, timingChanged });

  const added = newSteps.filter((s) => !old.steps.some((o) => o.stepId === s.stepId));
  const tasks = await ctx.tx.rows("Flow_Tasks");
  const mine = tasks.filter((t) => t.flowId === rec.flowId);
  // keep seq in sync with the new order
  for (const t of mine) { const idx = flow.steps.findIndex((s) => s.stepId === t.stepId) + 1; if (idx > 0) t.seq = idx; }
  if (added.length && items.length) {
    const users = new Set((await ctx.tx.rows("Users")).filter((u) => u.status === "Active").map((u) => String(u.userId)));
    const load = new Map<string, number>();
    for (const item of items) {
      const data = JSON.parse(String(item.dataJson || "{}")) as Data;
      for (const s of added) {
        const t = ctx.tx.insert("Flow_Tasks", {
          taskId: newId("FTK"), itemId: item.itemId, flowId: rec.flowId, stepId: s.stepId, seq: flow.steps.findIndex((x) => x.stepId === s.stepId) + 1,
          assigneeId: pickAssignee(s, data, { openLoad: load, stepCount: 0 }, users), status: "Pending", planned: "", origPlanned: "", actual: "", doneBy: "",
          remarks: "", dataJson: "", extCount: 0, remindedAt: "", overdueAt: "", escalatedAt: "", updatedAt: ctx.clock.stamp,
        });
        mine.push(t);
      }
    }
  }
  if (timingChanged || added.length) await replan(ctx, flow, false, mine);
  return pub("Flows", rec);
}

/** Recompute planned times for every open entry of a flow. Returns the number of tasks changed. */
export async function replan(ctx: Ctx, flow: Flow, includeDone: boolean, flowTasks?: Rec[]): Promise<number> {
  const cal = calendarFor(flow, await ctx.tx.rows("Holidays"));
  const tasks = flowTasks ?? (await ctx.tx.rows("Flow_Tasks")).filter((t) => t.flowId === flow.flowId);
  const byItem = new Map<string, Rec[]>();
  tasks.forEach((t) => (byItem.get(String(t.itemId)) ?? byItem.set(String(t.itemId), []).get(String(t.itemId))!).push(t));
  let n = 0;
  for (const item of (await ctx.tx.rows("Flow_Items")).filter((i) => i.flowId === flow.flowId && i.status !== "Cancelled")) {
    const ts = (byItem.get(String(item.itemId)) ?? []).sort((a, b) => Number(a.seq) - Number(b.seq));
    const data = JSON.parse(String(item.dataJson || "{}")) as Data;
    const ch = [...syncConditions(flow, data, ts), ...planTasks(flow, item, data, ts, cal, includeDone)];
    ch.forEach((t) => (t.updatedAt = ctx.clock.stamp));
    n += new Set(ch).size;
    refreshItemStatus(item, ts, ctx.clock.stamp);
  }
  return n;
}

export async function replanFlow(ctx: Ctx, d: Record<string, unknown>) {
  const { flow, rec } = await ctx.flow(str(d.flowId));
  const n = await replan(ctx, flow, d.includeDone === true);
  ctx.tx.audit("FMS replanned", "Flows", String(rec.flowId), null, { tasksChanged: n, includeDone: d.includeDone === true });
  return { changed: n };
}

export async function rotateIntakeToken(ctx: Ctx, d: Record<string, unknown>) {
  const { rec } = await ctx.flow(str(d.flowId));
  rec.intakeToken = randomBytes(18).toString("hex");
  ctx.tx.audit("Intake token rotated", "Flows", String(rec.flowId));
  return pub("Flows", rec);
}

export async function replanAffected(ctx: Ctx, flowId: string): Promise<number> {
  let n = 0;
  for (const rec of await ctx.tx.rows("Flows")) {
    if (flowId && rec.flowId !== flowId) continue;
    n += await replan(ctx, parseFlow(rec as unknown as FlowRec), false);
  }
  return n;
}

