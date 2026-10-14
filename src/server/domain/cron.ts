/**
 * The scheduler tick: reminders, overdue alerts, escalations, recurring entries and the morning digest.
 * Idempotent — safe to call every few minutes from Vercel Cron, an external pinger, or opportunistically when the app is opened.
 */
import type { FlowRec } from "../../lib/flow-types.ts";
import { parseFlow } from "../../lib/flow-parse.ts";
import { effectiveAssignee, taskState } from "../../lib/flow-shared.ts";
import { Ctx } from "./ctx.ts";
import { addEntries } from "./entries.ts";
import { absenceRows } from "./tasks.ts";
import { checklistTick } from "./checklist.ts";
import { attendanceTick } from "./attendance-tick.ts";
import { addDays, isOffDay, minutesBetween, weekday } from "./time.ts";
import { calendarFor } from "./engine.ts";

const STALE_DAYS = 3; // tasks overdue for longer than this are flagged silently (no flood of alerts for old backlog)

export interface TickResult { reminders: number; overdue: number; escalations: number; recurring: number; digests: number; checklistCreated: number; checklistReminders: number; attendanceReminders: number }

export async function tick(ctx: Ctx): Promise<TickResult> {
  const out: TickResult = { reminders: 0, overdue: 0, escalations: 0, recurring: 0, digests: 0, checklistCreated: 0, checklistReminders: 0, attendanceReminders: 0 };
  const tx = ctx.tx;
  await tx.load("Users", "Flows", "Flow_Items", "Flow_Tasks", "Absences", "Holidays");
  const now = ctx.clock;
  const defRemind = ctx.settingNum("REMINDER_MINUTES"), defEsc = ctx.settingNum("ESCALATE_AFTER_MINUTES");
  const absences = await absenceRows(ctx);
  const users = await tx.rows("Users");
  const userById = new Map(users.map((u) => [String(u.userId), u]));
  const admins = users.filter((u) => u.status === "Active" && (u.role === "ADMIN" || u.role === "SUPER_ADMIN")).map((u) => String(u.userId));
  const flows = new Map((await tx.rows("Flows")).map((f) => [String(f.flowId), parseFlow({ ...f } as unknown as FlowRec)]));
  const openItems = new Map((await tx.rows("Flow_Items")).filter((i) => i.status === "Open").map((i) => [String(i.itemId), i]));

  for (const t of await tx.rows("Flow_Tasks")) {
    if (t.status !== "Pending" || !t.planned) continue;
    const item = openItems.get(String(t.itemId));
    const flow = flows.get(String(t.flowId));
    if (!item || !flow) continue;
    const step = flow.steps.find((s) => s.stepId === t.stepId);
    const remind = step?.reminderMinutes || defRemind, esc = step?.escalateAfterMinutes || defEsc;
    const toDue = minutesBetween(now.dt, String(t.planned)); // > 0: not yet due
    const who = effectiveAssignee({ assigneeId: String(t.assigneeId), planned: String(t.planned), actual: "", status: "Pending" }, absences, now.date).userId;
    const link = `/flows/${flow.flowId}?item=${item.itemId}`;
    const label = `${step?.name ?? "Step"} · ${item.title}`;
    const stale = toDue < -STALE_DAYS * 1440;

    if (remind > 0 && toDue > 0 && toDue <= remind && !t.remindedAt) {
      t.remindedAt = now.stamp;
      ctx.notice({ userId: who, type: "reminder", title: `Due in ${toDue < 90 ? `${toDue} min` : `${Math.round(toDue / 60)} h`}: ${step?.name ?? "step"}`, body: `${item.title} · ${flow.name}`, link, itemId: String(item.itemId), taskId: String(t.taskId), dedupeKey: `rem|${t.taskId}|${t.planned}`, self: true });
      out.reminders++;
    }
    if (toDue <= 0 && !t.overdueAt) {
      t.overdueAt = now.stamp;
      if (!stale) {
        ctx.notice({ userId: who, type: "overdue", title: `Overdue: ${step?.name ?? "step"}`, body: `${item.title} · ${flow.name} (was due ${String(t.planned)})`, link, itemId: String(item.itemId), taskId: String(t.taskId), dedupeKey: `od|${t.taskId}|${t.planned}`, self: true });
        out.overdue++;
      }
    }
    if (esc > 0 && -toDue >= esc && !t.escalatedAt) {
      t.escalatedAt = now.stamp;
      if (!stale) {
        const boss = step?.escalateToId || String(userById.get(String(t.assigneeId))?.managerId || "");
        const targets = boss ? [boss] : admins;
        for (const u of targets) {
          ctx.notice({ userId: u, type: "escalation", title: `Escalation: ${userById.get(who)?.name ?? "someone"} is ${Math.round(-toDue / 60)} h late`, body: `${label} (${flow.name})`, link, itemId: String(item.itemId), taskId: String(t.taskId), dedupeKey: `esc|${t.taskId}|${t.planned}`, self: true });
        }
        out.escalations++;
      }
    }
  }

  // recurring entries
  for (const rec of await tx.rows("Flows")) {
    const flow = flows.get(String(rec.flowId));
    if (!flow || flow.archived || !flow.recurrence) continue;
    const rc = flow.recurrence;
    const last = String(rec.lastRunAt || now.dt);
    const cal = calendarFor(flow, await tx.rows("Holidays"));
    const due: string[] = [];
    for (let d = last.slice(0, 10); d <= now.date && due.length < 5; d = addDays(d, 1)) {
      const dom = Number(d.slice(8));
      const lastDom = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
      const hit = rc.freq === "daily" || (rc.freq === "weekly" && (rc.weekdays ?? []).includes(weekday(d))) || (rc.freq === "monthly" && dom === Math.min(rc.monthDay || 1, lastDom));
      const at = `${d} ${rc.time}`;
      if (hit && at > last && at <= now.dt && !(rc.skipOffDays && isOffDay(d, cal))) due.push(at);
    }
    // another server may have run this tick a moment ago: only go on if the flow's last-run stamp is unchanged in the sheet
    const fresh = due.length ? await tx.freshRow("Flows", rec) : null;
    if (due.length && fresh && String(fresh.lastRunAt) === String(rec.lastRunAt)) {
      const rows = due.map((at) => {
        const data: Record<string, unknown> = { ...rc.data };
        if (flow.anchorField && !data[flow.anchorField]) data[flow.anchorField] = at;
        return { data, createdAt: at, source: "recurring" };
      });
      const { added } = await addEntries(ctx, flow.flowId, rows, { lenient: true });
      out.recurring += added.length;
      rec.lastRunAt = now.dt;
    }
    if (!rec.lastRunAt) rec.lastRunAt = now.dt;
  }

  // morning digest
  if (ctx.setting("DIGEST_ENABLED") === "Y" && Number(now.time.slice(0, 2)) === ctx.settingNum("DIGEST_HOUR")) {
    const existing = new Set((await tx.rows("Notifications")).filter((n) => n.type === "digest" && String(n.createdAt).slice(0, 10) === now.date).map((n) => String(n.userId)));
    const tally = new Map<string, { overdue: number; today: number }>();
    for (const t of await tx.rows("Flow_Tasks")) {
      if (t.status !== "Pending" || !openItems.has(String(t.itemId))) continue;
      const st = taskState({ assigneeId: String(t.assigneeId), planned: String(t.planned), actual: "", status: "Pending" }, now.dt);
      if (st !== "overdue" && st !== "today") continue;
      const who = effectiveAssignee({ assigneeId: String(t.assigneeId), planned: String(t.planned), actual: "", status: "Pending" }, absences, now.date).userId;
      const c = tally.get(who) ?? tally.set(who, { overdue: 0, today: 0 }).get(who)!;
      if (st === "overdue") c.overdue++; else c.today++;
    }
    for (const [uid, c] of tally) {
      if (existing.has(uid) || userById.get(uid)?.status !== "Active") continue;
      ctx.notice({ userId: uid, type: "digest", title: `Good morning — ${c.overdue} overdue, ${c.today} due today`, body: "Open My Tasks to see them.", link: "/flows/tasks", dedupeKey: `digest|${uid}|${now.date}`, self: true });
      out.digests++;
    }
  }
  const cl = await checklistTick(ctx);
  out.checklistCreated = cl.created;
  out.checklistReminders = cl.reminders;
  const at = await attendanceTick(ctx);
  out.attendanceReminders = at.checkIn + at.checkOut;
  return out;
}
