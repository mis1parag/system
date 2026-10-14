/** Entries (one PO / case): create, import, edit, postpone, cancel, comments, bulk actions. */
import type { Flow, FlowField } from "../../lib/flow-types.ts";
import { PRIORITIES } from "../../lib/flow-types.ts";
import { effectiveAssignee } from "../../lib/flow-shared.ts";
import { MidapError, fail, forbid, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { flowVisible } from "../../lib/permissions.ts";
import { calendarFor, pickAssignee, planTasks, refreshItemStatus, syncConditions, type Data } from "./engine.ts";
import { addDays, isDate, isOffDay, normDT, splitDT } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
export const parseData = (item: Rec): Data => { try { return JSON.parse(String(item.dataJson || "{}")) as Data; } catch { return {}; } };

// ---------- field values ----------
export function coerceField(f: FlowField, v: unknown, strict: boolean): string | number {
  const empty = v === undefined || v === null || str(v) === "";
  if (f.type === "checkbox") {
    const yes = ["yes", "y", "true", "1", "on", "✓"].includes(str(v).toLowerCase());
    if (!yes && f.required && strict) fail("VALIDATION", `"${f.label}" must be ticked`);
    return yes ? "Yes" : "";
  }
  if (empty) {
    if (f.required && strict) fail("VALIDATION", `"${f.label}" is required`);
    return "";
  }
  const bad = (msg: string, keep: unknown): string => { if (strict) fail("VALIDATION", `"${f.label}" ${msg}`); return str(keep); };
  switch (f.type) {
    case "number": { const n = Number(str(v).replace(/,/g, "")); return isNaN(n) ? bad("must be a number", v) : n; }
    case "date": { const s = str(v).slice(0, 10); return isDate(s) ? s : bad("must be a valid date", ""); }
    case "datetime": { const dt = normDT(v); return dt ? dt : bad("must be a valid date & time", ""); }
    case "url": { const s = str(v); return /^https?:\/\/\S+$/i.test(s) ? s : bad("must be a link starting with http:// or https://", v); }
    case "phone": { const s = str(v); return s.replace(/\D/g, "").length >= 7 ? s : bad("must be a phone number", v); }
    case "select": { const s = str(v); if (strict && f.options?.length && !f.options.includes(s)) fail("VALIDATION", `"${f.label}": choose one of the listed options`); return s; }
    default: return str(v);
  }
}
export function coerceAll(fields: FlowField[], raw: Record<string, unknown>, strict: boolean): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of fields) out[f.key] = coerceField(f, raw?.[f.key], strict);
  return out;
}

export function titleOf(flow: Flow, data: Data): string {
  return flow.titleFields.map((k) => data[k]).filter((x) => x !== "" && x !== undefined && x !== null).join(" · ").slice(0, 120);
}
function cleanPriority(v: unknown): string {
  const p = str(v) || "Normal";
  require_((PRIORITIES as string[]).includes(p), "Priority must be Urgent, High, Normal or Low");
  return p;
}
export function cleanTags(v: unknown): string {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(",")).map(str).filter(Boolean).map((t) => t.slice(0, 24));
  return [...new Set(list)].slice(0, 10).join(",");
}
const uniqueKey = (flow: Flow, data: Data): string | null => {
  const uniq = flow.fields.filter((f) => f.unique);
  if (!uniq.length) return null;
  const parts = uniq.map((f) => String(data[f.key] ?? "").toLowerCase());
  return parts.every((p) => p === "") ? null : parts.join("|");
};

// ---------- create / import ----------
const VISIBILITY = ["assigned", "department", "users", "management"];
const cleanVisibility = (v: unknown) => (VISIBILITY.includes(str(v)) ? str(v) : "assigned");
const cleanUsers = (v: unknown) => [...new Set(str(v).split(",").map((x) => x.trim()).filter(Boolean))].join(",");

/**
 * Record-level access to ONE entry. Seeing is decided in getFlowData; changing needs more: the person works on it (or created it),
 * or the people who do are inside their reach and they may manage FMS. Everyone else gets FORBIDDEN, whatever the screen shows.
 */
export async function requireEntryAccess(ctx: Ctx, item: Rec, tasks: Rec[]) {
  if (ctx.isSuper || ctx.system) return;
  ctx.require("fms", "view");
  const reach = await ctx.reach("fms");
  const involved = [String(item.createdBy), ...tasks.flatMap((t) => [String(t.assigneeId), String(t.doneBy)])].filter(Boolean);
  if (reach.all || involved.some((id) => reach.ids.has(id))) return;
  fail("FORBIDDEN", "You do not have access to this entry");
}

export interface NewEntry {
  data: Record<string, unknown>; createdAt?: string; anchorDate?: string; originalAnchor?: string; postponeCount?: number; postponeReason?: string;
  priority?: string; tags?: string; source?: string; actuals?: Record<string, string>; status?: string; createdBy?: string;
  /** who may see it besides the people working on it: assigned (default) · department · users · management */ visibility?: string; visibleTo?: string;
}

/** Shared by manual entry, CSV / workbook import, the Google-Form intake and recurring entries. */
export async function addEntries(ctx: Ctx, flowId: string, rows: NewEntry[], opts: { lenient?: boolean } = {}): Promise<{ added: Rec[]; skipped: { row: number; reason: string }[] }> {
  const { flow } = await ctx.flow(flowId);
  const tx = ctx.tx;
  require_(flow.rec.status === "Active" || opts.lenient, "This FMS is archived");
  const cal = calendarFor(flow, await tx.rows("Holidays"));
  const items = await tx.rows("Flow_Items");
  const seen = new Set<string>();
  items.filter((i) => i.flowId === flowId && i.status !== "Cancelled").forEach((i) => { const k = uniqueKey(flow, parseData(i)); if (k) seen.add(k); });
  const users = new Set((await tx.rows("Users")).filter((u) => u.status === "Active").map((u) => String(u.userId)));

  const usesPool = flow.steps.some((s) => s.assign?.type === "pool");
  const openLoad = new Map<string, number>();
  const stepCount = new Map<string, number>();
  if (usesPool) {
    const itemOpen = new Set(items.filter((i) => i.flowId === flowId && i.status === "Open").map((i) => String(i.itemId)));
    for (const t of await tx.rows("Flow_Tasks")) {
      if (t.flowId !== flowId) continue;
      stepCount.set(String(t.stepId), (stepCount.get(String(t.stepId)) ?? 0) + 1);
      if (t.status === "Pending" && itemOpen.has(String(t.itemId))) openLoad.set(String(t.assigneeId), (openLoad.get(String(t.assigneeId)) ?? 0) + 1);
    }
  }

  const added: Rec[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const strict = !opts.lenient;
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    try {
      const data = coerceAll(flow.fields, r.data, strict);
      let anchor = "";
      if (flow.anchorField) {
        anchor = normDT(r.anchorDate) || String(data[flow.anchorField] ?? "");
        const label = flow.fields.find((f) => f.key === flow.anchorField)?.label;
        require_(anchor, strict ? `Fill "${label}" — it drives all planned dates` : "Schedule date missing");
      }
      const uk = uniqueKey(flow, data);
      if (uk && seen.has(uk)) fail("DUPLICATE_ITEM", strict ? "This entry already exists" : "Duplicate entry", null);
      if (uk) seen.add(uk);
      const createdAt = normDT(r.createdAt) || ctx.clock.dt;
      const item: Rec = {
        itemId: newId("FIT"), flowId, title: titleOf(flow, data) || `${flow.name} ${normDT(r.createdAt)?.slice(0, 10) || ctx.clock.date}`, dataJson: JSON.stringify(data), anchorDate: anchor, originalAnchor: normDT(r.originalAnchor) || anchor,
        postponeCount: Number(r.postponeCount) || 0, postponeReason: str(r.postponeReason), priority: cleanPriority(r.priority), tags: cleanTags(r.tags),
        source: str(r.source) || "manual", status: "Open", createdAt, createdBy: str(r.createdBy) || ctx.actorId, updatedAt: ctx.clock.stamp, completedAt: "",
        visibility: cleanVisibility(r.visibility), visibleTo: cleanVisibility(r.visibility) === "users" ? cleanUsers(r.visibleTo) : "", department: String(ctx.actor.department ?? ""),
      };
      const tasks: Rec[] = flow.steps.map((s, i) => {
        const assignee = pickAssignee(s, data, { openLoad, stepCount: stepCount.get(s.stepId) ?? 0 }, users);
        stepCount.set(s.stepId, (stepCount.get(s.stepId) ?? 0) + 1);
        openLoad.set(assignee, (openLoad.get(assignee) ?? 0) + 1);
        const given = normDT(r.actuals?.[s.stepId]);
        const actual = given || (s.autoDone ? createdAt : "");
        return {
          taskId: newId("FTK"), itemId: item.itemId, flowId, stepId: s.stepId, seq: i + 1, assigneeId: assignee, status: actual ? "Done" : "Pending", planned: "",
          origPlanned: "", actual, doneBy: actual ? (given ? assignee : ctx.actorId) : "", remarks: "", dataJson: "", extCount: 0, remindedAt: "", overdueAt: "",
          escalatedAt: "", updatedAt: ctx.clock.stamp,
        };
      });
      syncConditions(flow, data, tasks);
      planTasks(flow, item, data, tasks, cal, true);
      refreshItemStatus(item, tasks, ctx.clock.stamp);
      if (r.status === "Cancelled") item.status = "Cancelled";
      tx.insert("Flow_Items", item);
      tasks.forEach((t) => tx.insert("Flow_Tasks", t));
      added.push(item);
    } catch (e) {
      if (strict || !(e instanceof MidapError)) throw e;
      skipped.push({ row: n + 1, reason: e.message });
    }
  }
  if (added.length === 1 && strict) tx.audit("Entry created", "Flow_Items", String(added[0].itemId), null, { flow: flow.name, title: added[0].title, source: added[0].source });
  else if (added.length) tx.audit("Entries added", "Flow_Items", flowId, null, { flow: flow.name, added: added.length, skipped: skipped.length, source: rows[0]?.source ?? "import" });
  return { added, skipped };
}

export async function createEntry(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("fms", "create", "You cannot add entries");
  const fl = await ctx.flow(str(d.flowId));
  forbid(flowVisible(fl.rec as never, { ...ctx.actor, userId: ctx.actorId } as never, (await ctx.reach("fms")).all) || ctx.system, "This FMS is not available to you");
  const { added } = await addEntries(ctx, str(d.flowId), [{ data: (d.data ?? {}) as Record<string, unknown>, priority: str(d.priority) || undefined, tags: str(d.tags), source: str(d.source) || "manual", visibility: str(d.visibility), visibleTo: str(d.visibleTo) }]);
  return pub("Flow_Items", added[0]);
}

export async function importEntries(ctx: Ctx, d: Record<string, unknown>) {
  const rows = Array.isArray(d.rows) ? (d.rows as NewEntry[]) : [];
  require_(rows.length > 0, "Nothing to import");
  require_(rows.length <= 600, "Import at most 600 rows per call");
  const { added, skipped } = await addEntries(ctx, str(d.flowId), rows.map((r) => ({ ...r, source: r.source || "import" })), { lenient: true });
  return { added: added.length, skipped };
}

// ---------- edit ----------
async function entryParts(ctx: Ctx, itemId: string) {
  const items = await ctx.tx.rows("Flow_Items");
  const item = items.find((i) => i.itemId === itemId);
  require_(item, "Unknown entry");
  const { flow } = await ctx.flow(String(item.flowId));
  const tasks = (await ctx.tx.rows("Flow_Tasks")).filter((t) => t.itemId === itemId).sort((a, b) => Number(a.seq) - Number(b.seq));
  await requireEntryAccess(ctx, item, tasks);
  return { item, flow, tasks, items };
}

export async function updateEntry(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("fms", "edit", "You cannot change entries");
  const { item, flow, tasks, items } = await entryParts(ctx, str(d.itemId));
  require_(item.status !== "Cancelled", "This entry is cancelled");
  const old = parseData(item);
  const changed: Record<string, [unknown, unknown]> = {};
  let data = old;
  if (d.data) {
    const input = d.data as Record<string, unknown>;
    data = {};
    for (const f of flow.fields) data[f.key] = input[f.key] !== undefined ? coerceField(f, input[f.key], true) : old[f.key];
    const uk = uniqueKey(flow, data);
    if (uk) {
      const dup = items.find((i) => i !== item && i.flowId === flow.flowId && i.status !== "Cancelled" && uniqueKey(flow, parseData(i)) === uk);
      if (dup) fail("DUPLICATE_ITEM", `Already entered: ${dup.title} (${dup.itemId})`, { existing: pub("Flow_Items", dup) });
    }
    for (const k of Object.keys(data)) if (String(data[k] ?? "") !== String(old[k] ?? "")) changed[k] = [old[k], data[k]];
  }
  if (d.priority !== undefined && cleanPriority(d.priority) !== item.priority) { changed.priority = [item.priority, cleanPriority(d.priority)]; item.priority = cleanPriority(d.priority); }
  if (d.tags !== undefined && cleanTags(d.tags) !== item.tags) { changed.tags = [item.tags, cleanTags(d.tags)]; item.tags = cleanTags(d.tags); }
  if (d.visibility !== undefined) {
    const vis = cleanVisibility(d.visibility), to = vis === "users" ? cleanUsers(d.visibleTo) : "";
    if (vis !== (item.visibility || "assigned") || to !== String(item.visibleTo)) { changed.visibility = [item.visibility || "assigned", vis]; item.visibility = vis; item.visibleTo = to; }
  }
  if (!Object.keys(changed).length) return pub("Flow_Items", item);
  if (d.data) {
    item.dataJson = JSON.stringify(data);
    item.title = titleOf(flow, data);
    const anchorEdited = flow.anchorField && changed[flow.anchorField];
    if (anchorEdited) { item.anchorDate = String(data[flow.anchorField]); if (!item.postponeCount) item.originalAnchor = item.anchorDate; }
    const cal = calendarFor(flow, await ctx.tx.rows("Holidays"));
    const ch = [...syncConditions(flow, data, tasks), ...planTasks(flow, item, data, tasks, cal, false)];
    ch.forEach((t) => (t.updatedAt = ctx.clock.stamp));
    refreshItemStatus(item, tasks, ctx.clock.stamp);
  }
  item.updatedAt = ctx.clock.stamp;
  ctx.tx.audit("Entry edited", "Flow_Items", String(item.itemId), null, changed);
  return pub("Flow_Items", item);
}

export async function postponeEntry(ctx: Ctx, d: Record<string, unknown>) {
  const { item, flow, tasks } = await entryParts(ctx, str(d.itemId));
  require_(flow.anchorField, "This FMS has no schedule date to postpone");
  require_(item.status === "Open", "Only open entries can be postponed");
  const cal = calendarFor(flow, await ctx.tx.rows("Holidays"));
  let next: string;
  if (str(d.newAnchor)) {
    next = normDT(d.newAnchor) || "";
    require_(next, "Invalid new date");
  } else {
    const days = Number(d.days);
    require_(!isNaN(days) && days !== 0 && Math.abs(days) <= 365, "Enter how many days to postpone");
    const p = splitDT(String(item.anchorDate));
    let date = addDays(p.date, Math.trunc(days)), guard = 0;
    while (isOffDay(date, cal) && guard++ < 14) date = addDays(date, 1); // never land on a holiday / weekly-off day
    next = date + (p.time ? ` ${p.time}` : "");
  }
  require_(next !== item.anchorDate, "The new date is the same as the current one");
  require_(str(d.reason), "Give a reason for the postponement");
  const old = String(item.anchorDate);
  item.anchorDate = next;
  item.postponeCount = Number(item.postponeCount) + 1;
  item.postponeReason = str(d.reason);
  item.updatedAt = ctx.clock.stamp;
  const data = parseData(item);
  const ch = planTasks(flow, item, data, tasks, cal, false);
  ch.forEach((t) => { t.updatedAt = ctx.clock.stamp; t.remindedAt = ""; t.overdueAt = ""; t.escalatedAt = ""; });
  ctx.tx.audit("Entry postponed", "Flow_Items", String(item.itemId), { anchor: old }, { anchor: next, reason: item.postponeReason });
  // tell whoever still has work on this entry
  const absences = (await ctx.tx.rows("Absences")).filter((a) => a.deleted !== "Y") as unknown as { userId: string; fromDate: string; toDate: string; backupUserId: string }[];
  const told = new Set<string>();
  for (const t of tasks) {
    if (t.status !== "Pending") continue;
    const who = effectiveAssignee({ assigneeId: String(t.assigneeId), planned: String(t.planned), actual: String(t.actual), status: "Pending" }, absences, ctx.clock.date).userId;
    if (told.has(who)) continue;
    told.add(who);
    ctx.notice({ userId: who, type: "postponed", title: `Postponed: ${item.title}`, body: `${flow.name} — new date ${next}. Reason: ${item.postponeReason}`, link: `/flows/${flow.flowId}?item=${item.itemId}`, itemId: String(item.itemId) });
  }
  return pub("Flow_Items", item);
}

export async function cancelEntry(ctx: Ctx, d: Record<string, unknown>) {
  const { item, tasks } = await entryParts(ctx, str(d.itemId));
  const cancel = d.cancel !== false;
  const old = String(item.status);
  if (cancel) { item.status = "Cancelled"; item.completedAt = ""; }
  else { item.status = "Open"; refreshItemStatus(item, tasks, ctx.clock.stamp); }
  item.updatedAt = ctx.clock.stamp;
  ctx.tx.audit(cancel ? "Entry cancelled" : "Entry restored", "Flow_Items", String(item.itemId), { status: old }, { status: item.status, reason: str(d.reason) });
  return pub("Flow_Items", item);
}

// ---------- comments ----------
export async function addComment(ctx: Ctx, d: Record<string, unknown>) {
  const { item, flow, tasks } = await entryParts(ctx, str(d.itemId));
  const text = str(d.text);
  require_(text, "Write a comment first");
  require_(text.length <= 1000, "Comment is too long (1000 characters max)");
  const c = ctx.tx.insert("Comments", { commentId: newId("CMT"), itemId: item.itemId, flowId: item.flowId, userId: ctx.actorId, text, createdAt: ctx.clock.stamp, deleted: "" });
  const who = new Set<string>([String(item.createdBy), ...tasks.filter((t) => t.status === "Pending").map((t) => String(t.assigneeId))]);
  who.forEach((u) => ctx.notice({ userId: u, type: "comment", title: `${ctx.actor.name} commented on ${item.title}`, body: text.slice(0, 140), link: `/flows/${flow.flowId}?item=${item.itemId}`, itemId: String(item.itemId) }));
  return pub("Comments", c);
}

export async function deleteComment(ctx: Ctx, d: Record<string, unknown>) {
  const c = (await ctx.tx.rows("Comments")).find((x) => x.commentId === str(d.commentId));
  require_(c, "Unknown comment");
  if (c.userId !== ctx.actorId && !ctx.allow("fms", "manage")) fail("FORBIDDEN", "You can only delete your own comments");
  c.deleted = "Y";
  return { commentId: c.commentId };
}

// ---------- bulk ----------
/** Apply one operation to many entries. Failures on individual entries are reported, not fatal. */
export async function bulkEntries(
  ctx: Ctx, d: Record<string, unknown>,
  helpers: { complete: (ctx: Ctx, d: Record<string, unknown>) => Promise<unknown>; reassign: (ctx: Ctx, d: Record<string, unknown>) => Promise<unknown> },
) {
  const ids = (Array.isArray(d.itemIds) ? d.itemIds : []).map(str).filter(Boolean);
  require_(ids.length > 0, "Select at least one entry");
  require_(ids.length <= 200, "Select at most 200 entries at a time");
  const op = str(d.op);
  require_(["postpone", "cancel", "priority", "tags", "complete_step", "reassign_step"].includes(op), "Unknown bulk action");
  if (op === "cancel") ctx.require("fms", "delete", "You cannot cancel entries");
  if (op === "reassign_step") ctx.require("fms", "assign", "You cannot hand steps to other people");
  const tasks = await ctx.tx.rows("Flow_Tasks");
  const results: { itemId: string; ok: boolean; error?: string }[] = [];
  for (const itemId of ids) {
    try {
      if (op === "postpone") await postponeEntry(ctx, { itemId, days: d.days, newAnchor: d.newAnchor, reason: d.reason });
      else if (op === "cancel") await cancelEntry(ctx, { itemId, reason: d.reason });
      else if (op === "priority") await updateEntry(ctx, { itemId, priority: d.priority });
      else if (op === "tags") await updateEntry(ctx, { itemId, tags: d.tags });
      else {
        const t = tasks.find((x) => x.itemId === itemId && x.stepId === str(d.stepId));
        require_(t, "This entry has no such step");
        require_(t.status === "Pending", t.status === "Done" ? "Already done" : "Not applicable");
        if (op === "complete_step") await helpers.complete(ctx, { taskId: t.taskId, remarks: d.remarks, actual: d.actual, data: d.data });
        else await helpers.reassign(ctx, { taskId: t.taskId, assigneeId: d.assigneeId });
      }
      results.push({ itemId, ok: true });
    } catch (e) {
      if (!(e instanceof MidapError)) throw e;
      results.push({ itemId, ok: false, error: e.message });
    }
  }
  ctx.tx.audit("Bulk action", "Flow_Items", "", null, { op, count: ids.length, ok: results.filter((r) => r.ok).length });
  return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
