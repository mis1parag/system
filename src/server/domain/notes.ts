/**
 * Private notepad. A note belongs to ONE person: not the Super Admin, not a manager can read it, and it never shows in any task list, FMS, report, score or dashboard.
 * Every action looks the note up by its owner, so a note id that is not yours simply does not exist.
 */
import { newId, pub, require_, type Rec } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { generateChecklist } from "./checklist.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const mine = async (ctx: Ctx) => (await ctx.tx.rows("Notes")).filter((n) => n.userId === ctx.actorId && n.deleted !== "Y");
const find = async (ctx: Ctx, id: string): Promise<Rec> => { const n = (await mine(ctx)).find((x) => x.noteId === id); require_(n, "That note does not exist"); return n; };

export async function listNotes(ctx: Ctx) {
  const rows = (await mine(ctx)).sort((a, b) => (a.done === "Y" ? 1 : 0) - (b.done === "Y" ? 1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { notes: rows.slice(0, 500).map((n) => pub("Notes", n)) };
}

export async function saveNote(ctx: Ctx, d: Record<string, unknown>) {
  const text = str(d.text);
  require_(text, "Write something first");
  require_(text.length <= 2000, "A note can have 2000 characters at most");
  const due = str(d.dueDate);
  require_(due === "" || isDate(due), "Choose a valid date or leave it empty");
  const id = str(d.noteId);
  const count = (await mine(ctx)).length;
  let rec: Rec;
  if (id) { rec = await find(ctx, id); Object.assign(rec, { text, dueDate: due, updatedAt: ctx.clock.stamp }); }
  else { require_(count < 500, "You have 500 notes. Delete some old ones first."); rec = ctx.tx.insert("Notes", { noteId: newId("NOT"), userId: ctx.actorId, text, done: "", dueDate: due, createdAt: ctx.clock.stamp, updatedAt: ctx.clock.stamp, convertedTo: "", deleted: "" }); }
  return pub("Notes", rec);
}

export async function toggleNote(ctx: Ctx, d: Record<string, unknown>) {
  const n = await find(ctx, str(d.noteId));
  n.done = d.done === false ? "" : "Y"; n.updatedAt = ctx.clock.stamp;
  return pub("Notes", n);
}

export async function deleteNote(ctx: Ctx, d: Record<string, unknown>) {
  const n = await find(ctx, str(d.noteId));
  n.deleted = "Y"; n.updatedAt = ctx.clock.stamp;
  return { noteId: n.noteId };
}

/** Make a note an official task (a one-time checklist task for yourself). Only on purpose; the note stays yours and remembers the task. */
export async function convertNote(ctx: Ctx, d: Record<string, unknown>) {
  const n = await find(ctx, str(d.noteId));
  require_(!n.convertedTo, "This note already became an official task");
  const date = str(d.dueDate) || String(n.dueDate) || ctx.clock.date;
  require_(isDate(date), "Choose a valid date");
  ctx.require("checklist", "view", "The checklist is not available to you, so a note cannot become a task");
  const first = String(n.text).split("\n")[0].slice(0, 200);
  // a task for yourself, created on purpose from your own note (no right to assign work to others is needed)
  const task = ctx.tx.insert("Checklist_Tasks", {
    ctId: newId("CLT"), title: first, doerId: ctx.actorId, backupId: "", department: String(ctx.actor.department ?? ""), freq: "O", startDate: date, endDate: date, proof: "N", kra: "",
    status: "Active", lastGenerated: "", createdAt: ctx.clock.stamp, createdBy: ctx.actorId, updatedAt: ctx.clock.stamp,
  });
  await generateChecklist(ctx, [task]);
  n.convertedTo = String(task.ctId); n.updatedAt = ctx.clock.stamp;
  ctx.tx.audit("Personal note became an official task", "Notes", String(n.noteId), null, { task: task.ctId });
  return { note: pub("Notes", n), task: pub("Checklist_Tasks", task) };
}
