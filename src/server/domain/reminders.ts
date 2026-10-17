/**
 * Reminders from a manager to one person or to a group. Who can be reminded is decided on the server: only people inside the sender's reach (module "reminders").
 * Each send has a key made by the screen; sending the same key twice (a double click, a retry after a slow connection) does nothing the second time.
 */
import { fail, newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** The record a reminder is about must be one the recipient really has, so a reminder cannot be used to push any link at anybody. */
async function resolveRelated(ctx: Ctx, type: string, id: string, toIds: string[]): Promise<{ title: string; link: string }> {
  if (!type || type === "other" || !id) return { title: "", link: "" };
  if (type === "fms") {
    const task = (await ctx.tx.rows("Flow_Tasks")).find((t) => t.taskId === id);
    const item = (await ctx.tx.rows("Flow_Items")).find((i) => i.itemId === (task ? task.itemId : id));
    require_(item, "That FMS entry no longer exists");
    const people = new Set((await ctx.tx.rows("Flow_Tasks")).filter((t) => t.itemId === item.itemId).map((t) => String(t.assigneeId)));
    require_(toIds.every((u) => people.has(u)), "Only people who work on that entry can be reminded about it");
    return { title: String(item.title), link: `/flows/${item.flowId}?item=${item.itemId}` };
  }
  if (type === "checklist") {
    const t = (await ctx.tx.rows("Checklist_Tasks")).find((c) => c.ctId === id);
    require_(t, "That checklist task no longer exists");
    require_(toIds.every((u) => u === t.doerId || u === t.backupId), "Only the person who does that task can be reminded about it");
    return { title: String(t.title), link: "/flows/checklist" };
  }
  return fail("VALIDATION", "Choose what the reminder is about (an FMS entry, a checklist task, or nothing)");
}

/** Send, or preview (`preview: true` shows the recipients and the message and sends nothing). */
export async function sendReminders(ctx: Ctx, d: Record<string, unknown>) {
  ctx.require("reminders", "create", "You cannot send reminders");
  const toIds = [...new Set((Array.isArray(d.toIds) ? d.toIds : [str(d.toId)]).map(str).filter(Boolean))];
  require_(toIds.length > 0, "Choose at least one person");
  require_(toIds.length <= 100, "Choose at most 100 people at a time");
  require_(!toIds.includes(ctx.actorId), "You cannot send a reminder to yourself");
  const message = str(d.message);
  require_(message, "Write the reminder");
  require_(message.length <= 500, "The reminder can have 500 characters at most");
  const due = str(d.dueDate);
  require_(due === "" || isDate(due.slice(0, 10)), "Choose a valid due date or leave it empty");
  const users = await ctx.tx.rows("Users");
  const reach = await ctx.reach("reminders");
  const recipients = toIds.map((id) => users.find((u) => u.userId === id));
  require_(recipients.every((u) => u && u.status === "Active"), "One of the people is not active any more");
  const outside = recipients.filter((u) => !(reach.all || reach.ids.has(String(u!.userId))));
  if (outside.length) fail("FORBIDDEN", `You cannot send reminders to ${outside.map((u) => u!.name).slice(0, 3).join(", ")} — outside your access`);
  const related = await resolveRelated(ctx, str(d.relatedType), str(d.relatedId), toIds);
  if (d.preview === true) return { preview: true, count: recipients.length, recipients: recipients.map((u) => ({ userId: u!.userId, name: u!.name })), message, due, about: related.title };

  const key = str(d.sendKey);
  require_(key && key.length <= 80, "This send has no key — reload the page and try again");
  await ctx.db.load(["Reminders"], { fresh: true });
  const rows = await ctx.tx.rows("Reminders");
  const done = rows.filter((r) => r.sendKey === key && r.fromId === ctx.actorId);
  if (done.length) return { duplicate: true, sent: done.length, batchId: done[0].batchId };

  const batchId = newId("RMB");
  for (const u of recipients) {
    const rec = ctx.tx.insert("Reminders", {
      remId: newId("REM"), batchId, sendKey: key, fromId: ctx.actorId, toId: u!.userId, message, relatedType: str(d.relatedType) || "other", relatedId: str(d.relatedId),
      relatedTitle: related.title, link: related.link, dueDate: due, status: "Sent", createdAt: ctx.clock.stamp, readAt: "",
    });
    ctx.notice({ userId: String(u!.userId), type: "reminder", title: `Reminder from ${ctx.actor.name}`, body: `${message}${related.title ? ` · ${related.title}` : ""}${due ? ` · due ${due}` : ""}`.slice(0, 300), link: related.link || "/flows/reminders", dedupeKey: String(rec.remId) });
  }
  ctx.tx.audit("Reminder sent", "Reminders", batchId, null, { recipients: recipients.length, about: related.title, message: message.slice(0, 80) });
  return { duplicate: false, sent: recipients.length, batchId };
}

/** inbox = reminders sent to you; sent = reminders you sent (people with the manage right also see the ones sent by people in their reach). */
export async function listReminders(ctx: Ctx, d: Record<string, unknown>) {
  const box = str(d.box) === "sent" ? "sent" : "inbox";
  const reach = await ctx.reach("reminders");
  const rows = (await ctx.tx.rows("Reminders")).filter((r) => (box === "inbox" ? r.toId === ctx.actorId : r.fromId === ctx.actorId || (ctx.allow("reminders", "manage") && (reach.all || reach.ids.has(String(r.fromId))))))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300);
  return { box, reminders: rows.map((r) => pub("Reminders", r)) };
}

export async function readReminder(ctx: Ctx, d: Record<string, unknown>) {
  const r = (await ctx.tx.rows("Reminders")).find((x) => x.remId === str(d.remId) && x.toId === ctx.actorId);
  require_(r, "That reminder is not yours");
  if (!r.readAt) { r.readAt = ctx.clock.stamp; r.status = "Read"; }
  return pub("Reminders", r as Rec);
}
