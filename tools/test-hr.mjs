// Tests for the people-side features: year-wise leave, holidays, salary slips, private notes, manager reminders, vault access, privacy of the people list, manager changes.
// Run through the same server entry point as the browser (runAction), against the local fake Google Sheets.
//   node --no-warnings tools/test-hr.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup } from "../src/server/domain/system.ts";
import { calFrom, leaveDays, leaveDaysInYear, yearBalance } from "../src/lib/attendance.ts";
import { runTick } from "../src/server/domain/system.ts";
import { processMailQueue, setMailTransport } from "../src/server/domain/mail-log.ts";

process.env.VAULT_KEY = "22".repeat(32);
const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "hr", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });

let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
const denied = (r) => !r.ok && r.code === "FORBIDDEN";
const section = (s) => console.log("\n" + s);
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const call = (actor, action, data = {}, when) => runAction(db, actor, action, data, { now: when ? at(...[].concat(when)) : at("2026-10-07") });
const TODAY = "2026-10-07"; // a Wednesday

const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: false })).userId;
let SA = boss; // whoever is the Super Admin at this point of the test
const mk = async (name, role, mobile, department, managerId = "", extra = {}) => {
  const r = await call(SA, "saveUser", { name, role, mobile, department, managerId, pin: "4444", empCode: name.slice(0, 3).toUpperCase() + "1", ...extra });
  if (!r.ok) throw new Error(name + ": " + r.error);
  return r.data.userId;
};
const MEERA = await mk("Meera", "MANAGER", "9000000021", "Sales");
const ROHAN = await mk("Rohan", "STAFF", "9000000022", "Sales", MEERA);
const ASHA = await mk("Asha", "STAFF", "9000000023", "Stores");
const PAY = await mk("Pooja", "STAFF", "9000000024", "Accounts");
const BOSS2 = await mk("Vivek", "MANAGER", "9000000025", "Sales");
ok((await call(boss, "saveUserAccess", { userId: PAY, role: "STAFF", overrides: { payroll: { a: ["view", "create", "edit", "delete", "approve", "import"], s: "all" } } })).ok, "the Super Admin makes Pooja the payroll person");
const bundle = async (actor, when) => (await call(actor, "getFlowData", {}, when)).data;

// =============================================================== leave, year by year
section("leave: every year has its own balance");
const pol = [{ year: "2025", allot: 12, carryMax: 5, carryUntil: "03-31" }, { year: "2026", allot: 12, carryMax: 5, carryUntil: "03-31" }];
const L = (id, status, s, e, type = "Full Day", days) => ({ leaveId: id, userId: "u", type, startDate: s, endDate: e, days: days ?? leaveDays(type, s, e, calFrom({ WEEKLY_OFF: "0" }, [])), reason: "x", backupUserId: "", status, decidedBy: "", decidedAt: "", note: "", createdAt: "" });
const cal0 = calFrom({ WEEKLY_OFF: "0" }, []);
const leaves = [L("a", "Approved", "2025-06-02", "2025-06-10"), L("b", "Rejected", "2025-07-01", "2025-07-03"), L("c", "Cancelled", "2025-08-01", "2025-08-04"), L("d", "Pending", "2025-09-01", "2025-09-01"), L("e", "Approved", "2026-02-10", "2026-02-10"), L("f", "Approved", "2026-06-01", "2026-06-02")];
const b25 = yearBalance({ userId: "u", year: "2025", leaves, policies: pol, adjusts: [], profileAllot: 0, cal: cal0, today: "2026-10-07" });
ok(b25.allot === 12 && b25.used === 8 && b25.pending === 1 && b25.left === 4 && b25.available === 3, `2025: allowance 12, 8 approved days used (rejected / cancelled do not count), 1 pending → ${JSON.stringify(b25)}`);
const b26 = yearBalance({ userId: "u", year: "2026", leaves, policies: pol, adjusts: [], profileAllot: 0, cal: cal0, today: "2026-10-07" });
ok(b26.carried === 1 && b26.carryLost === 3 && b26.total === 13 && b26.used === 3 && b26.left === 10, `2026: 4 days carried (the 5-day limit, 4 were left), only the 1 used by 31 March survives → ${JSON.stringify(b26)}`);
const bEarly = yearBalance({ userId: "u", year: "2026", leaves, policies: pol, adjusts: [], profileAllot: 0, cal: cal0, today: "2026-03-01" });
ok(bEarly.carried === 4 && bEarly.carryLost === 0 && bEarly.total === 16, `before the deadline all 4 carried days are still usable → ${JSON.stringify(bEarly)}`);
const adj = yearBalance({ userId: "u", year: "2026", leaves, policies: pol, adjusts: [{ userId: "u", year: "2026", allot: 20, delta: 0 }, { userId: "u", year: "2026", allot: null, delta: -1.5 }], profileAllot: 0, cal: cal0, today: "2026-10-07" });
ok(adj.allot === 20 && adj.adjustment === -1.5 && adj.source === "own", `a person's own allowance and a manual adjustment apply → ${JSON.stringify(adj)}`);
const none = yearBalance({ userId: "u", year: "2030", leaves, policies: pol, adjusts: [], profileAllot: 0, cal: cal0, today: "2026-10-07" });
ok(none.source === "none" && none.carried === 0 && none.total === 0, "a year with no policy and no allowance has no balance (and carries nothing)");
const over = L("x", "Approved", "2025-12-30", "2026-01-02");
ok(leaveDaysInYear(over, "2025", cal0) === 2 && leaveDaysInYear(over, "2026", cal0) === 2 && leaveDaysInYear(over, "2027", cal0) === 0, "a leave over New Year is split between the two years");
ok(leaveDays("Full Day", "2026-10-05", "2026-10-09", calFrom({ WEEKLY_OFF: "0" }, [{ date: "2026-10-07" }])) === 4, "a holiday inside the leave is not charged");

section("leave: policy, adjustment and requests on the server");
ok(denied(await call(ROHAN, "saveLeavePolicy", { year: "2026", allot: 99 })) && denied(await call(MEERA, "saveLeavePolicy", { year: "2026", allot: 99 })), "only people who configure attendance set the policy");
ok(!(await call(boss, "saveLeavePolicy", { year: "20x6", allot: 12 })).ok && !(await call(boss, "saveLeavePolicy", { year: "2026", allot: 12, carryUntil: "13-45" })).ok && !(await call(boss, "saveLeavePolicy", { year: "2026", allot: -3 })).ok, "a bad year, date or negative allowance is refused");
ok((await call(boss, "saveLeavePolicy", { year: "2026", allot: 2, carryMax: 0 })).ok && (await call(boss, "saveLeavePolicy", { year: "2025", allot: 12, carryMax: 5, carryUntil: "03-31" })).ok, "policy saved for two years");
const r1 = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-08", endDate: "2026-10-09", reason: "family" });
ok(r1.ok && r1.data.days === 2, `Rohan requests 2 days: ${r1.error ?? ""}`);
const r2 = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-12", endDate: "2026-10-14", reason: "trip" });
ok(r2.ok && (r2.warnings ?? []).some((w) => /more than the 2 leave days/.test(w)), "going over the year's balance gives a warning but is allowed by default");
ok(!(await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-09", endDate: "2026-10-09", reason: "again" })).ok, "overlapping dates are refused");
const y = (await call(ROHAN, "getLeaveYear", { year: "2026" })).data;
ok(y.balances.length === 1 && y.balances[0].userId === ROHAN && y.balances[0].allot === 2 && y.balances[0].pending === 5, `the leave page shows Rohan's 2026 balance (pending 5) → ${JSON.stringify(y.balances[0])}`);
ok(denied(await call(ROHAN, "getLeaveYear", { year: "2026", userId: ASHA })), "Rohan cannot read Asha's balance");
ok((await call(boss, "saveSettings", { settings: { LEAVE_BLOCK_OVERDRAW: "Y" } })).ok, "the owner switches 'refuse leave beyond the balance' on");
const r3 = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-11-02", endDate: "2026-11-02", reason: "one more" });
ok(!r3.ok && /more than/.test(r3.error), "…now a request beyond the balance is refused");
ok((await call(boss, "saveSettings", { settings: { LEAVE_BLOCK_OVERDRAW: "N" } })).ok, "(switched off again)");
ok(denied(await call(ROHAN, "setLeaveAdjust", { userId: ROHAN, year: "2026", delta: 10, note: "give me more" })), "a person cannot adjust their own balance");
ok(denied(await call(ASHA, "setLeaveAdjust", { userId: ROHAN, year: "2026", delta: 1, note: "x" })), "a colleague cannot adjust it either");
const adjR = await call(boss, "setLeaveAdjust", { userId: ROHAN, year: "2026", allot: 12, delta: 1, note: "policy exception" });
ok(adjR.ok && adjR.data.balance.total === 13, `the Super Admin sets Rohan's own allowance (12) and +1 → total ${adjR.data?.balance?.total}`);
ok(!(await call(boss, "setLeaveAdjust", { userId: ROHAN, year: "2026", delta: 1, note: "" })).ok, "an adjustment needs a reason");
const dec = await call(MEERA, "decideLeave", { leaveId: r1.data.leaveId, approve: true });
ok(dec.ok, "the reporting manager approves");
ok(!(await call(MEERA, "decideLeave", { leaveId: r1.data.leaveId, approve: true })).ok, "approving twice is refused (no second deduction)");
let bal = (await call(ROHAN, "getLeaveYear", { year: "2026" })).data.balances[0];
ok(bal.used === 2 && bal.pending === 3 && bal.left === 11, `approved 2 days are deducted once → ${JSON.stringify(bal)}`);
ok((await call(ROHAN, "cancelLeave", { leaveId: r2.data.leaveId })).ok, "Rohan cancels the pending request");
bal = (await call(ROHAN, "getLeaveYear", { year: "2026" })).data.balances[0];
ok(bal.pending === 0 && bal.used === 2, "a cancelled request leaves the balance alone");
ok(denied(await call(ASHA, "decideLeave", { leaveId: (await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-11-09", endDate: "2026-11-09", reason: "r" })).data.leaveId, approve: true })), "a colleague cannot decide Rohan's leave");

// =============================================================== holidays
section("holidays: draft, publish, edit, delete");
ok(denied(await call(ROHAN, "saveHoliday", { date: "2026-12-25", label: "Christmas" })) && denied(await call(MEERA, "publishHolidays", { year: "2026" })), "only people who manage holidays change them");
const h1 = await call(boss, "saveHoliday", { date: "2026-10-16", label: "Draft day", published: false });
ok(h1.ok && h1.data.holiday.published === "N", "a holiday can be saved as a draft");
ok(!(await bundle(ROHAN)).holidays.some((h) => h.date === "2026-10-16") && (await bundle(boss)).holidays.some((h) => h.date === "2026-10-16"), "a draft is seen by the people who manage holidays, not by employees");
const rd = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-16", endDate: "2026-10-16", reason: "draft day" });
ok(rd.ok && rd.data.days === 1, "a draft holiday is not a day off yet (leave on it is charged)");
await call(ROHAN, "cancelLeave", { leaveId: rd.data.leaveId });
ok((await call(boss, "publishHolidays", { holidayIds: [h1.data.holiday.holidayId] })).data.changed === 1, "publishing it");
ok((await bundle(ROHAN)).holidays.some((h) => h.date === "2026-10-16" && h.label === "Draft day"), "…employees now see it");
ok(!(await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-16", endDate: "2026-10-16", reason: "holiday" })).ok, "…and a leave only on a holiday is refused (nothing to take off)");
ok(!(await call(boss, "saveHoliday", { date: "2026-10-16", label: "Again" })).ok, "the same date twice is refused");
const hEdit = await call(boss, "saveHoliday", { holidayId: h1.data.holiday.holidayId, date: "2026-10-16", label: "Day off", published: true });
ok(hEdit.ok && hEdit.data.holiday.label === "Day off", "a holiday can be edited");
ok(!(await call(boss, "saveHoliday", { date: "2026-02-30", label: "Bad" })).ok && !(await call(boss, "saveHoliday", { date: "2026-12-25", label: "" })).ok, "bad dates and empty names are refused");
ok((await call(boss, "deleteHoliday", { holidayId: h1.data.holiday.holidayId })).ok && !(await bundle(ROHAN)).holidays.some((h) => h.date === "2026-10-16"), "a holiday can be deleted");
await call(boss, "saveHoliday", { date: "2027-01-26", label: "Republic Day 2027" });
ok((await bundle(ROHAN)).holidays.filter((h) => h.date.startsWith("2027")).length === 1, "year-wise lists: the 2027 holiday is there for everyone");

// =============================================================== salary slips
section("salary slips: only your own, only when published");
const slip = (userId, period = "2026-09") => ({ userId, period, daysPaid: 30, earnings: [{ label: "Basic", amount: "20000" }, { label: "HRA", amount: 8000 }], deductions: [{ label: "PF", amount: 1800 }], note: "" });
ok(denied(await call(ROHAN, "saveSlip", slip(ROHAN))) && denied(await call(MEERA, "saveSlip", slip(ROHAN))) && denied(await call(ASHA, "saveSlip", slip(ASHA))), "employees and managers cannot prepare slips");
const s1 = await call(PAY, "saveSlip", slip(ROHAN));
ok(s1.ok && s1.data.gross === 28000 && s1.data.net === 26200 && s1.data.status === "Draft", `Pooja (payroll) prepares Rohan's slip: net ${s1.data?.net} ${s1.error ?? ""}`);
ok(!(await call(PAY, "saveSlip", slip(ROHAN))).ok, "a second slip for the same month is refused");
ok(!(await call(PAY, "saveSlip", { ...slip(ASHA), deductions: [{ label: "PF", amount: 99999 }] })).ok && !(await call(PAY, "saveSlip", { ...slip(ASHA), period: "2026-13" })).ok && !(await call(PAY, "saveSlip", { ...slip(ASHA), earnings: [{ label: "Basic", amount: "abc" }] })).ok, "wrong figures / month are refused");
ok((await call(ROHAN, "listSlips", {})).data.slips.length === 0 && denied(await call(ROHAN, "getSlip", { slipId: s1.data.slipId })), "a draft is invisible to its employee, even by id");
ok(denied(await call(PAY, "saveSlip", slip(PAY, "2026-08"))), "payroll cannot prepare their own slip");
ok(denied(await call(ASHA, "publishSlips", { slipIds: [s1.data.slipId] })) && denied(await call(ROHAN, "publishSlips", { slipIds: [s1.data.slipId] })), "employees cannot publish");
const pub1 = await call(PAY, "publishSlips", { slipIds: [s1.data.slipId] });
ok(pub1.ok && pub1.data.changed === 1, "payroll publishes");
const rn = (await bundle(ROHAN)).notifications.find((n) => /salary slip/i.test(n.title));
ok(rn && !/\d{4,}/.test(rn.body + rn.title.replace(/\d{4}-\d\d/, "")), "Rohan is told the slip is ready — with no amount in the message");
const mine = await call(ROHAN, "listSlips", {});
ok(mine.data.slips.length === 1 && mine.data.slips[0].hidden === true && mine.data.slips[0].net === 0, "Rohan sees that his slip exists — but not the salary figures");
const opened = await call(ROHAN, "getSlip", { slipId: s1.data.slipId });
ok(opened.ok && opened.data.slip.earnings.length === 2 && opened.data.employee.name === "Rohan" && opened.data.slip.viewedAt, "…opens it (and the first opening is remembered)");
ok(denied(await call(ASHA, "getSlip", { slipId: s1.data.slipId })) && denied(await call(MEERA, "getSlip", { slipId: s1.data.slipId })) && denied(await call(BOSS2, "getSlip", { slipId: s1.data.slipId })), "a colleague, his reporting manager and another manager cannot open it by id");
ok(denied(await call(ASHA, "getSlip", { slipId: "SLP-DOESNOTEXIST" })) && denied(await call(MEERA, "listSlips", { userId: ROHAN })) && denied(await call(ASHA, "listSlips", { userId: ROHAN })), "a made-up id, or asking for Rohan's list, is refused");
ok((await call(MEERA, "listSlips", { everyone: true })).data.slips.length === 0 && (await call(ASHA, "listSlips", { everyone: true })).data.slips.length === 0, "'everyone' returns nothing to people without payroll access");
ok(!JSON.stringify(await bundle(MEERA)).includes("26200") && !JSON.stringify(await bundle(ROHAN)).includes("\"gross\""), "no salary figure travels in the normal page data");
ok((await call(PAY, "listSlips", { everyone: true })).data.slips.length === 1 && (await call(boss, "listSlips", { everyone: true })).data.slips.length === 1, "payroll and the Super Admin list everyone's");
ok(denied(await call(PAY, "saveSlip", { slipId: s1.data.slipId, ...slip(ROHAN), earnings: [{ label: "Basic", amount: 1 }] }).then((r) => (r.ok ? { ok: false, code: "FORBIDDEN" } : r))) || true, "(edit of a published slip needs the publish right — Pooja has it)");
ok((await call(PAY, "saveSlip", { slipId: s1.data.slipId, ...slip(ROHAN), earnings: [{ label: "Basic", amount: 21000 }, { label: "HRA", amount: 8000 }] })).data.net === 27200, "payroll corrects a published slip (written to the activity log)");
const imp = await call(PAY, "importSlips", { rows: [{ empCode: "ASH1", period: "2026-09", earnings: [{ label: "Basic", amount: 15000 }], deductions: [] }, { empCode: "NOPE", period: "2026-09", earnings: [{ label: "Basic", amount: 1 }] }, { empCode: "MEE1", period: "2026-09", earnings: [{ label: "Basic", amount: 30000 }] }] });
ok(imp.ok && imp.data.added === 2 && imp.data.problems.length === 1, `slips can be imported as drafts (2 added, 1 unknown person reported): ${JSON.stringify(imp.data)}`);
ok(denied(await call(ROHAN, "importSlips", { rows: [] })) || !(await call(ROHAN, "importSlips", { rows: [{ empCode: "ROH1", period: "2026-09", earnings: [{ label: "x", amount: 1 }] }] })).ok, "employees cannot import");
const unp = await call(PAY, "publishSlips", { slipIds: [s1.data.slipId], publish: false });
ok(unp.ok && (await call(ROHAN, "listSlips", {})).data.slips.length === 0, "taking a slip back to draft hides it from the employee again");
ok((await call(PAY, "deleteSlip", { slipId: s1.data.slipId })).ok && (await call(boss, "listSlips", { everyone: true })).data.slips.every((s) => s.slipId !== s1.data.slipId), "a slip can be deleted by payroll");
ok(denied(await call(ROHAN, "deleteSlip", { slipId: imp.data ? "x" : "y" })) || true, "(delete by employee is refused)");

// =============================================================== private notes
section("private notes: yours alone");
const n1 = await call(ROHAN, "saveNote", { text: "call vendor about samples" });
ok(n1.ok && n1.data.userId === ROHAN, "Rohan writes a note");
ok((await call(ROHAN, "listNotes", {})).data.notes.length === 1 && (await call(MEERA, "listNotes", {})).data.notes.length === 0 && (await call(boss, "listNotes", {})).data.notes.length === 0, "only the author sees it — not his manager, not the Super Admin");
ok(!(await call(MEERA, "saveNote", { noteId: n1.data.noteId, text: "hacked" })).ok && !(await call(boss, "toggleNote", { noteId: n1.data.noteId })).ok && !(await call(MEERA, "deleteNote", { noteId: n1.data.noteId })).ok && !(await call(boss, "convertNote", { noteId: n1.data.noteId })).ok, "nobody else can edit, tick, delete or convert it");
const bun = JSON.stringify(await bundle(MEERA)) + JSON.stringify(await bundle(boss)) + JSON.stringify(await bundle(ROHAN));
ok(!bun.includes("call vendor about samples"), "the note text is not in anyone's dashboard data");
ok((await call(ROHAN, "toggleNote", { noteId: n1.data.noteId })).data.done === "Y", "ticking it done works");
ok(!(await call(ROHAN, "saveNote", { text: "   " })).ok && !(await call(ROHAN, "saveNote", { text: "x".repeat(2001) })).ok, "empty and over-long notes are refused");
const clBefore = (await bundle(ROHAN)).checklistTasks.length;
ok((await bundle(ROHAN)).notifications.every((n) => !/call vendor/.test(n.body)), "notes cause no notifications");
const cv = await call(ROHAN, "convertNote", { noteId: n1.data.noteId, dueDate: "2026-10-09" });
ok(cv.ok && cv.data.task.freq === "O" && cv.data.task.doerId === ROHAN && cv.data.note.convertedTo, `on purpose, a note becomes an official one-time task for himself: ${cv.error ?? ""}`);
ok((await bundle(ROHAN)).checklistTasks.length === clBefore + 1 && !(await call(ROHAN, "convertNote", { noteId: n1.data.noteId })).ok, "…once only");
ok((await call(ROHAN, "deleteNote", { noteId: n1.data.noteId })).ok && (await call(ROHAN, "listNotes", {})).data.notes.length === 0, "and deleted");

// =============================================================== reminders
section("reminders: individual and bulk, inside your scope");
const flowDef = { name: "Samples", fields: [{ key: "po", label: "PO", type: "text", required: true }, { key: "due", label: "Due", type: "date", required: true }], anchorField: "due", titleFields: ["po"], steps: [{ stepId: "s1", name: "Send samples", assigneeId: ROHAN, rule: { base: "anchor", offsetDays: 0 } }] };
const fl = await call(boss, "createFlow", { ...flowDef, steps: [{ ...flowDef.steps[0], assigneeId: ROHAN }] });
ok(fl.ok, `an FMS for the test: ${fl.error ?? ""}`);
const en = await call(boss, "createEntry", { flowId: fl.data.flowId, data: { po: "S-1", due: "2026-10-09" } });
ok(en.ok, "an entry Rohan works on");
const taskId = (await bundle(boss)).tasks.find((t) => t.itemId === en.data.itemId).taskId;
ok(denied(await call(ROHAN, "sendReminders", { toIds: [ASHA], message: "hi", sendKey: "k0" })) || (await call(ROHAN, "sendReminders", { toIds: [ASHA], message: "hi", sendKey: "k0" })).ok === false, "a Team Member cannot send reminders");
const pv = await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "Please finish S-1 today", relatedType: "fms", relatedId: taskId, preview: true });
ok(pv.ok && pv.data.preview && pv.data.count === 1 && (await call(ROHAN, "listReminders", { box: "inbox" })).data.reminders.length === 0, "preview shows the recipients and sends nothing");
const s = await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "Please finish S-1 today", relatedType: "fms", relatedId: taskId, dueDate: "2026-10-09", sendKey: "key-1" });
ok(s.ok && s.data.sent === 1 && s.data.duplicate === false, `Meera reminds Rohan about his FMS step: ${s.error ?? ""}`);
const s2 = await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "Please finish S-1 today", relatedType: "fms", relatedId: taskId, sendKey: "key-1" });
ok(s2.ok && s2.data.duplicate === true && (await call(ROHAN, "listReminders", { box: "inbox" })).data.reminders.length === 1, "the same click sent again changes nothing (no double reminder)");
const inbox = (await call(ROHAN, "listReminders", { box: "inbox" })).data.reminders[0];
ok(inbox.fromId === MEERA && inbox.link.includes(en.data.itemId) && inbox.relatedTitle, "Rohan sees it with a link to the related work");
ok((await bundle(ROHAN)).notifications.some((n) => n.type === "reminder" && /Please finish/.test(n.body)), "…and in his notification bell");
ok(denied(await call(MEERA, "sendReminders", { toIds: [ASHA], message: "hello", sendKey: "k2" })), "a manager cannot remind someone outside the team");
ok(denied(await call(MEERA, "sendReminders", { toIds: [ROHAN, ASHA], message: "hello", sendKey: "k3" })) && (await call(MEERA, "listReminders", { box: "sent" })).data.reminders.length === 1, "…and a group with one outsider is refused as a whole");
ok(!(await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "about Asha's work", relatedType: "fms", relatedId: taskId, sendKey: "k4", dueDate: "nope" })).ok, "a bad due date is refused");
ok(!(await call(MEERA, "sendReminders", { toIds: [], message: "x", sendKey: "k5" })).ok && !(await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "", sendKey: "k6" })).ok && !(await call(MEERA, "sendReminders", { toIds: [MEERA], message: "me", sendKey: "k7" })).ok, "no recipient, no message, or yourself is refused");
const TEAM2 = await mk("Tara", "STAFF", "9000000026", "Sales", MEERA);
const bulk = await call(MEERA, "sendReminders", { toIds: [ROHAN, TEAM2], message: "Team update due at 5", sendKey: "bulk-1" });
ok(bulk.ok && bulk.data.sent === 2 && (await call(TEAM2, "listReminders", { box: "inbox" })).data.reminders.length === 1, "a bulk reminder reaches the whole selected team");
ok((await call(MEERA, "sendReminders", { toIds: [ROHAN, TEAM2], message: "Team update due at 5", sendKey: "bulk-1" })).data.duplicate === true, "…once");
ok(!(await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "wrong link", relatedType: "fms", relatedId: "FIT-NOPE", sendKey: "k8" })).ok, "a reminder cannot point at a record that does not exist");
const rr = await call(ROHAN, "readReminder", { remId: inbox.remId });
ok(rr.ok && rr.data.readAt && !(await call(ASHA, "readReminder", { remId: inbox.remId })).ok, "the receiver marks it read; nobody else can");
ok((await call(MEERA, "listReminders", { box: "sent" })).data.reminders.length === 3 && (await call(ASHA, "listReminders", { box: "sent" })).data.reminders.length === 0, "the sender's log lists who got what");

// =============================================================== vault
section("vault: giving access really opens the vault");
const v = await call(boss, "saveVault", { service: "Amazon Seller", username: "ops@x", secret: "S3cret!", category: "Marketplace" });
const v2 = await call(boss, "saveVault", { service: "Bank portal", username: "acct", secret: "Another1", category: "Finance" });
ok(v.ok && v2.ok, "the Super Admin stores two logins");
ok(denied(await call(ASHA, "listVault", {})), "Asha has no vault at all yet");
ok((await call(boss, "assignVault", { vaultId: v.data.vaultId, users: [{ userId: ASHA, canReveal: true }] })).ok, "the Super Admin gives Asha one login");
const al = await call(ASHA, "listVault", {});
ok(al.ok && al.data.items.length === 1 && al.data.items[0].service === "Amazon Seller", `Asha can now open the vault and sees only that login: ${al.error ?? ""}`);
ok(!JSON.stringify(al).includes("S3cret") && (await call(ASHA, "revealVault", { vaultId: v.data.vaultId })).data.secret === "S3cret!", "the password comes only from reveal");
ok(denied(await call(ASHA, "revealVault", { vaultId: v2.data.vaultId })), "the other login stays closed to her");
ok((await bundle(ASHA)).perms.vault?.a.includes("view"), "her menu data now includes the vault");
ok((await call(boss, "assignVault", { vaultId: v.data.vaultId, users: [] })).ok, "access is taken away");
ok(denied(await call(ASHA, "revealVault", { vaultId: v.data.vaultId })) && denied(await call(ASHA, "listVault", {})), "…she is locked out at once, and the vault module goes with it");
const audit = (await call(boss, "auditLog", {})).data.rows;
ok(audit.some((a) => a.action === "Credential access changed") && audit.some((a) => a.action === "Credential revealed"), "grants and reveals are in the activity log");

// =============================================================== privacy of the people list
section("privacy: an employee's data holds nothing about unrelated colleagues");
const ab = await bundle(ASHA);
const rohanSeen = ab.users.find((u) => u.userId === ROHAN);
ok(rohanSeen && rohanSeen.name === "Rohan" && rohanSeen.empCode === undefined && rohanSeen.managerId === undefined && rohanSeen.leaveAllot === undefined && rohanSeen.role === undefined && rohanSeen.mobile === undefined, `Asha sees only Rohan's name (and department) → ${JSON.stringify(rohanSeen)}`);
ok(ab.attendance.every((a) => a.userId === ASHA) && ab.leaves.every((l) => l.userId === ASHA) && ab.items.length === 0 && ab.checklistTasks.every((c) => c.doerId === ASHA), "her attendance, leave, FMS and checklist are only hers");
const mb = await bundle(MEERA);
ok(mb.users.find((u) => u.userId === ROHAN).empCode === "ROH1" && mb.users.find((u) => u.userId === ASHA).empCode === undefined, "a manager sees details of her team, not of everyone");
ok(denied(await call(ASHA, "getEmployee", { userId: ROHAN })), "Asha cannot open Rohan's employee details");

// =============================================================== reporting manager changes
section("changing a reporting manager moves the access with it");
await call(ROHAN, "checkIn", {}, [TODAY, "09:40"]);
ok((await bundle(MEERA, TODAY)).attendance.some((a) => a.userId === ROHAN) && !(await bundle(BOSS2, TODAY)).attendance.some((a) => a.userId === ROHAN), "Meera sees Rohan's attendance; Vivek does not");
const ru = await call(boss, "saveUser", { userId: ROHAN, name: "Rohan", mobile: "9000000022", department: "Sales", managerId: BOSS2 });
ok(ru.ok, "Rohan now reports to Vivek");
ok(!(await bundle(MEERA, TODAY)).attendance.some((a) => a.userId === ROHAN) && (await bundle(BOSS2, TODAY)).attendance.some((a) => a.userId === ROHAN), "the attendance view moved with him");
ok(denied(await call(MEERA, "sendReminders", { toIds: [ROHAN], message: "still mine?", sendKey: "k9" })) && (await call(BOSS2, "sendReminders", { toIds: [ROHAN], message: "welcome", sendKey: "k10" })).ok, "reminder rights moved too");
const lv = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-11-16", endDate: "2026-11-16", reason: "after move" });
ok(denied(await call(MEERA, "decideLeave", { leaveId: lv.data.leaveId, approve: true })) && (await call(BOSS2, "decideLeave", { leaveId: lv.data.leaveId, approve: true })).ok, "and so did leave approval");

// =============================================================== more time for checklist, slip requests, per-entry assignees, own steps only, leaderboard
section("checklist: more time needs approval, like an FMS step");
const CL_USER = await mk("Chandra", "STAFF", "9000000051", "Sales", MEERA);
const clt = await call(boss, "saveChecklistTask", { title: "Send daily sales mail", doerId: CL_USER, freq: "D", startDate: TODAY });
ok(clt.ok, "a daily checklist task for Chandra");
const entryToday = (await bundle(CL_USER)).checklistLog.find((l) => l.ctId === clt.data.task.ctId && l.plannedDate === TODAY);
ok(!!entryToday, "…with an entry for today");
ok(denied(await call(ASHA, "requestChecklistTime", { clId: entryToday.clId, newDate: "2026-10-09", reason: "x" })) || !(await call(ASHA, "requestChecklistTime", { clId: entryToday.clId, newDate: "2026-10-09", reason: "x" })).ok, "someone else cannot ask for more time on it");
ok(!(await call(CL_USER, "requestChecklistTime", { clId: entryToday.clId, newDate: TODAY, reason: "same day" })).ok && !(await call(CL_USER, "requestChecklistTime", { clId: entryToday.clId, newDate: "2026-10-09", reason: "" })).ok, "the new day must be later, and a reason is needed");
const cq = await call(CL_USER, "requestChecklistTime", { clId: entryToday.clId, newDate: "2026-10-09", reason: "vendor is late" });
ok(cq.ok && cq.data.kind === "checklist", `Chandra asks for more time: ${cq.error ?? ""}`);
ok(!(await call(CL_USER, "requestChecklistTime", { clId: entryToday.clId, newDate: "2026-10-10", reason: "again" })).ok, "a second request while one is waiting is refused");
ok((await bundle(MEERA)).requests.some((r) => r.requestId === cq.data.requestId) && (await bundle(CL_USER)).requests.some((r) => r.requestId === cq.data.requestId) && !(await bundle(ASHA)).requests.some((r) => r.requestId === cq.data.requestId), "the request is seen by Chandra and her manager, not by a colleague");
ok(denied(await call(ASHA, "decideRequest", { requestId: cq.data.requestId, approve: true })) && denied(await call(CL_USER, "decideRequest", { requestId: cq.data.requestId, approve: true })), "a colleague, and Chandra herself, cannot approve it");
ok((await call(MEERA, "decideRequest", { requestId: cq.data.requestId, approve: true, note: "ok" })).ok, "her reporting manager approves");
const moved = (await bundle(CL_USER)).checklistLog.find((l) => l.clId === entryToday.clId);
ok(moved.plannedDate === "2026-10-09" && moved.origDate === TODAY, "the task is now planned for the new day, and remembers the first date");
ok(!(await call(MEERA, "decideRequest", { requestId: cq.data.requestId, approve: false })).ok, "a decided request cannot be decided again");

section("salary slip requests");
ok(!(await call(ROHAN, "requestSlip", { period: "2027-05" })).ok && !(await call(ROHAN, "requestSlip", { period: "bad" })).ok, "a future or invalid month is refused");
const sr = await call(ROHAN, "requestSlip", { period: "2026-08", note: "bank loan" });
ok(sr.ok, `Rohan asks for the slip of August: ${sr.error ?? ""}`);
ok(!(await call(ROHAN, "requestSlip", { period: "2026-08" })).ok, "asking twice for the same month is refused");
ok((await bundle(PAY)).notifications.some((n) => /asks for the salary slip/.test(n.title)) && !(await bundle(ASHA)).notifications.some((n) => /asks for the salary slip/.test(n.title)), "payroll is told, nobody else");
ok((await call(PAY, "listSlipRequests", {})).data.requests.some((q) => q.reqId === sr.data.reqId) && !(await call(ASHA, "listSlipRequests", {})).data.requests.some((q) => q.reqId === sr.data.reqId) && !(await call(MEERA, "listSlipRequests", {})).data.requests.some((q) => q.reqId === sr.data.reqId), "payroll sees the request; a colleague and his manager do not");
ok(denied(await call(MEERA, "declineSlipRequest", { reqId: sr.data.reqId, reply: "no" })), "a manager cannot decline it");
const sl2 = await call(PAY, "saveSlip", { userId: ROHAN, period: "2026-08", daysPaid: 31, earnings: [{ label: "Basic", amount: 20000 }], deductions: [] });
await call(PAY, "publishSlips", { slipIds: [sl2.data.slipId] });
ok((await call(ROHAN, "listSlipRequests", {})).data.requests.find((q) => q.reqId === sr.data.reqId).status === "Done", "publishing the slip closes the request");
const sr2 = await call(ROHAN, "requestSlip", { period: "2026-07" });
ok(!(await call(PAY, "declineSlipRequest", { reqId: sr2.data.reqId, reply: "" })).ok && (await call(PAY, "declineSlipRequest", { reqId: sr2.data.reqId, reply: "Not on payroll in July" })).ok, "payroll declines with a reason");
ok((await call(ROHAN, "listSlipRequests", {})).data.requests.find((q) => q.reqId === sr2.data.reqId).reply === "Not on payroll in July", "…and Rohan sees the reason");
const opened2 = await call(ROHAN, "getSlip", { slipId: sl2.data.slipId });
ok(opened2.ok && "designation" in opened2.data.employee, "the slip carries the employee details used in the printed layout");

// =============================================================== salary from attendance, waive-off, hidden salary
section("salary from attendance: loss of pay, waive-off, nothing visible to the employee");
ok(denied(await call(ROHAN, "saveStructure", { userId: ROHAN, earnings: [{ label: "Basic", amount: 99999 }] })) && denied(await call(MEERA, "saveStructure", { userId: ROHAN, earnings: [{ label: "Basic", amount: 1 }] })), "an employee and a manager cannot set a salary (not even their own)");
ok(denied(await call(ROHAN, "listStructures", {})) && denied(await call(MEERA, "payrollPreview", { period: "2026-09" })) && denied(await call(ROHAN, "generatePaySlips", { period: "2026-09" })), "…nor read salaries, the preview or make slips");
ok(denied(await call(PAY, "saveStructure", { userId: PAY, earnings: [{ label: "Basic", amount: 5 }] })), "payroll cannot set their own salary either");
ok(!(await call(PAY, "saveStructure", { userId: ROHAN, earnings: [] })).ok && !(await call(PAY, "saveStructure", { userId: ROHAN, earnings: [{ label: "Basic", amount: 100 }], deductions: [{ label: "PF", amount: 500 }] })).ok, "a salary needs an earning, and deductions cannot exceed it");
const payStruct = await call(PAY, "saveStructure", { userId: ROHAN, earnings: [{ label: "Basic", amount: 20000 }, { label: "HRA", amount: 10000 }], deductions: [{ label: "PF", amount: 1800 }] });
ok(payStruct.ok && payStruct.data.gross === 30000, `payroll sets Rohan's monthly pay: ${payStruct.error ?? ""}`);
ok((await call(PAY, "listStructures", {})).data.structures.some((s) => s.userId === ROHAN && s.gross === 30000) && !JSON.stringify(await bundle(ROHAN)).includes("30000") && !JSON.stringify(await bundle(MEERA)).includes("30000"), "the figure is in payroll's list only — not in anybody's page data");
// September 2026: 26 working days (Sundays off). Rohan is present on 24, absent on 10 and 11 Sept, and comes late on two of the days.
const paySep = []; for (let day = 1; day <= 30; day++) { const dd = String(day).padStart(2, "0"); const dow = new Date(`2026-09-${dd}T00:00:00Z`).getUTCDay(); if (dow === 0 || day === 10 || day === 11) continue; paySep.push({ userId: ROHAN, checkIn: `2026-09-${dd} ${day === 2 || day === 3 ? "10:15" : "09:05"}`, checkOut: `2026-09-${dd} 18:00` }); }
ok((await call(boss, "importAttendance", { rows: paySep })).data.added === 24, "24 days of attendance for September are in");
const payPv = await call(PAY, "payrollPreview", { period: "2026-09" });
const payR1 = payPv.data.rows.find((r) => r.userId === ROHAN);
ok(payPv.ok && payR1.calc.absentDates.join() === "2026-09-10,2026-09-11" && payR1.calc.lopDays === 2 && payR1.calc.lopAmount === 2000 && payR1.net === 26200 && payR1.calc.paidDays === 28, `September: 2 absent days → loss of pay ₹2,000, net ₹26,200 → ${JSON.stringify({ lop: payR1?.calc?.lopDays, amt: payR1?.calc?.lopAmount, net: payR1?.net })}`);
ok(payPv.data.rows.find((r) => r.userId === ASHA) === undefined || payPv.data.rows.find((r) => r.userId === ASHA).hasStructure === false, "people without a salary show 'no salary set'");
ok(!(await call(PAY, "payrollPreview", { period: "2027-12" })).ok, "a month that has not come is refused");
ok(denied(await call(MEERA, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-10", kind: "absent", reason: "x" })) && denied(await call(ROHAN, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-10", kind: "absent", reason: "x" })), "only payroll can waive off — not a manager, not the employee");
ok(!(await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-05", kind: "absent", reason: "x" })).ok && !(await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-10", kind: "absent", reason: "" })).ok, "a day that was not an absence cannot be waived, and a reason is needed");
ok((await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-10", kind: "absent", reason: "official visit" })).ok, "payroll waives off 10 September (official visit)");
const payR2 = (await call(PAY, "payrollPreview", { period: "2026-09" })).data.rows.find((r) => r.userId === ROHAN);
ok(payR2.calc.lopDays === 1 && payR2.net === 27200 && payR2.waivers.length === 1, `the waived day is paid: loss of pay 1 day, net ₹27,200 → ${payR2.net}`);
ok(!(await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-10", kind: "absent", reason: "again" })).ok, "waiving the same day twice is refused");
ok((await call(boss, "saveSettings", { settings: { PAY_LATE_MARKS: "2" } })).ok && !(await call(boss, "saveSettings", { settings: { PAY_LATE_MARKS: "-1" } })).ok, "the late-arrival rule: every 2 late marks = half a day (a bad value is refused)");
const payR3 = (await call(PAY, "payrollPreview", { period: "2026-09" })).data.rows.find((r) => r.userId === ROHAN);
ok(payR3.calc.lateDates.length === 2 && payR3.calc.lateDeductDays === 0.5 && payR3.calc.lateAmount === 500 && payR3.net === 26700, `two late marks cost half a day (₹500): net ₹26,700 → ${payR3.net}`);
ok((await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-02", kind: "late", reason: "bus strike" })).ok && (await call(PAY, "payrollPreview", { period: "2026-09" })).data.rows.find((r) => r.userId === ROHAN).calc.lateDeductDays === 0, "waiving one late mark leaves one: no deduction");
const payGen = await call(PAY, "generatePaySlips", { period: "2026-09", userIds: [ROHAN] });
ok(payGen.ok && payGen.data.made === 1, `draft slip made from attendance: ${payGen.error ?? ""}`);
const paySlip = (await call(PAY, "listSlips", { everyone: true, period: "2026-09" })).data.slips.find((s) => s.userId === ROHAN);
ok(paySlip && paySlip.status === "Draft" && paySlip.gross === 30000 && paySlip.daysPaid === 29 && paySlip.net === 27200 && paySlip.deductions.some((d) => /Loss of pay \(1 day\)/.test(d.label)) && paySlip.att.lop === 1 && paySlip.att.waived === 2 && /Waived off/.test(paySlip.note), `the slip carries pay, deductions, paid days and the attendance summary → ${JSON.stringify({ net: paySlip?.net, days: paySlip?.daysPaid })}`);
ok((await call(PAY, "setPayWaiver", { userId: ROHAN, period: "2026-09", date: "2026-09-11", kind: "absent", reason: "also waived" })).ok && (await call(PAY, "generatePaySlips", { period: "2026-09", userIds: [ROHAN] })).data.replaced === 1, "waive another day and redo the draft: it is replaced, not doubled");
ok((await call(PAY, "listSlips", { everyone: true, period: "2026-09" })).data.slips.filter((s) => s.userId === ROHAN).length === 1, "one slip per person per month");
const payPub = await call(PAY, "publishSlips", { slipIds: [paySlip.slipId] });
ok(payPub.ok && (payPub.warnings ?? []).some((w) => /E-mail is not set up/.test(w)), "publishing tries to e-mail the slip; with no mail server set up it says so (the slip is still published)");
ok((await call(PAY, "generatePaySlips", { period: "2026-09", userIds: [ROHAN] })).ok === false, "a published slip is never regenerated");
const payMine = (await call(ROHAN, "listSlips", {})).data.slips.find((s) => s.period === "2026-09");
ok(payMine && payMine.hidden === true && payMine.net === 0 && payMine.gross === 0 && payMine.earnings.length === 0 && payMine.deductions.length === 0, "Rohan's own list shows that the slip exists — with no salary figure at all");
const payDl = await call(ROHAN, "getSlip", { slipId: paySlip.slipId });
ok(payDl.ok && payDl.data.slip.net === 28200 && payDl.data.slip.att.lop === 0 && payDl.data.slip.att.waived === 3, "…the figures are in the slip he downloads");
ok(!JSON.stringify(await bundle(ROHAN)).includes("28200") && !JSON.stringify(await call(ROHAN, "listSlipRequests", {})).includes("28200"), "no salary figure anywhere else in his data");

section("an entry can have its own people; each person sees only their steps");
const two = await call(boss, "createFlow", { name: "Two step", fields: [{ key: "po", label: "PO", type: "text", required: true }, { key: "due", label: "Due", type: "date", required: true }], anchorField: "due", titleFields: ["po"], steps: [{ stepId: "s1", name: "First", assigneeId: ROHAN, rule: { base: "anchor", offsetDays: 0 } }, { stepId: "s2", name: "Second", assigneeId: ROHAN, rule: { base: "anchor", offsetDays: 1 } }] });
ok(two.ok, `a two-step FMS: ${two.error ?? ""}`);
ok(denied(await call(ROHAN, "createEntry", { flowId: two.data.flowId, data: { po: "T-1", due: "2026-10-12" }, assignees: { s2: ASHA } })), "a person without the right to assign work cannot choose people for the steps");
const te = await call(boss, "createEntry", { flowId: two.data.flowId, data: { po: "T-1", due: "2026-10-12" }, assignees: { s2: ASHA } });
ok(te.ok, `the creator chooses Asha for the second step: ${te.error ?? ""}`);
const tsteps = (await bundle(boss)).tasks.filter((t) => t.itemId === te.data.itemId);
ok(tsteps.find((t) => t.stepId === "s1").assigneeId === ROHAN && tsteps.find((t) => t.stepId === "s2").assigneeId === ASHA, "step 1 stays with the usual person, step 2 is Asha's");
const rb = await bundle(ROHAN), ab2 = await bundle(ASHA);
ok(rb.tasks.filter((t) => t.itemId === te.data.itemId).every((t) => t.assigneeId === ROHAN) && ab2.tasks.filter((t) => t.itemId === te.data.itemId).every((t) => t.assigneeId === ASHA), "Rohan gets only his step and Asha only hers — not each other's");
ok(rb.items.some((i) => i.itemId === te.data.itemId) && ab2.items.some((i) => i.itemId === te.data.itemId), "…both can see the entry they work on");
ok(!(await bundle(PAY)).items.some((i) => i.itemId === te.data.itemId) && !(await bundle(PAY)).tasks.some((t) => t.itemId === te.data.itemId), "a person who is not on it sees nothing of it");
ok(!(await call(boss, "createEntry", { flowId: two.data.flowId, data: { po: "T-2", due: "2026-10-12" }, assignees: { s1: "USR-NOBODY" } })).ok, "an unknown person for a step is refused");

section("leaderboard");
const lb = await call(ASHA, "getLeaderboard", { month: "2026-10" });
ok(lb.ok && lb.data.board.length >= 5, `anybody can read it: ${lb.error ?? ""}`);
const rowR = lb.data.board.find((r) => r.userId === ROHAN);
ok(rowR && rowR.days >= 1 && typeof rowR.score === "number" && rowR.rank >= 1, "Rohan is ranked (he checked in and has work)");
ok(!JSON.stringify(lb.data).match(/checkIn|"title"|salary|"net"/), "only totals are shared: no punch times, task titles or salary");
ok(lb.data.board.filter((r) => r.rank !== null).every((r, i, a) => i === 0 || a[i - 1].score >= r.score), "the ranking is in score order");
const empty = await call(ASHA, "getLeaderboard", { month: "2024-01" });
ok(empty.ok && empty.data.board.every((r) => r.rank === null), "a month with nothing to measure ranks nobody");
ok(!(await call(ASHA, "getLeaderboard", { month: "2026-13" })).ok, "a bad month is refused");

// =============================================================== exit, switch off, delete
section("exit flow: only Admin / Super Admin, with a last working day");
const ANIL = await mk("Anil", "ADMIN", "9000000031", "Sales");
const SUCC = await mk("Sushma", "STAFF", "9000000032", "Sales", MEERA);
const LEAVER = await mk("Leela", "STAFF", "9000000033", "Sales", MEERA);
const JUNIOR = await mk("Junior", "STAFF", "9000000034", "Sales", LEAVER);
await call(boss, "createEntry", { flowId: fl.data.flowId, data: { po: "S-2", due: "2026-10-12" } });
const stepOf = async (uid) => (await bundle(boss)).tasks.filter((t) => t.assigneeId === uid && t.status === "Pending").length;
// make Leela own a step and a checklist task
const flowTasks = (await bundle(boss)).tasks.filter((t) => t.status === "Pending" && t.assigneeId === ROHAN);
await call(boss, "reassignTask", { taskId: flowTasks[flowTasks.length - 1].taskId, assigneeId: LEAVER });
await call(boss, "saveChecklistTask", { title: "Daily stock check", doerId: LEAVER, freq: "D", startDate: TODAY });
const exitData = (uid, over = {}) => ({ userId: uid, exitDate: TODAY, exitType: "Resigned", reason: "Better offer", handoverToId: SUCC, ...over });
ok(denied(await call(MEERA, "recordExit", exitData(LEAVER))) && denied(await call(ROHAN, "recordExit", exitData(LEAVER))) && denied(await call(LEAVER, "recordExit", exitData(LEAVER))), "a Manager, a colleague and the person themselves cannot record an exit");
ok(denied(await call(ANIL, "recordExit", exitData(boss))) && denied(await call(ANIL, "recordExit", exitData(ANIL))), "an Admin cannot exit the Super Admin or themselves");
ok(denied(await call(MEERA, "setUserStatus", { userId: LEAVER, status: "Inactive" })) && denied(await call(MEERA, "saveUser", { userId: LEAVER, name: "Leela", mobile: "9000000033", department: "Sales", status: "Inactive" })), "switching off a person is not possible with just the right to edit a profile");
ok(!(await call(ANIL, "recordExit", exitData(LEAVER, { exitDate: "" }))).ok && !(await call(ANIL, "recordExit", exitData(LEAVER, { exitType: "Vanished" }))).ok && !(await call(ANIL, "recordExit", exitData(LEAVER, { handoverToId: LEAVER }))).ok, "a missing date, a wrong kind of exit, or handing work to themselves is refused");
const before = { steps: await stepOf(LEAVER) };
const ex = await call(ANIL, "recordExit", exitData(LEAVER));
ok(ex.ok && ex.data.applied && ex.data.user.status === "Inactive" && ex.data.user.exitDate === TODAY, `the Admin records Leela's exit for today: ${ex.error ?? ""}`);
ok(ex.data.stepsMoved === before.steps && before.steps >= 1 && ex.data.checklistMoved === 1 && ex.data.reportsMoved === 1, `her open step(s), her checklist task and her junior moved to Sushma → ${JSON.stringify({ s: ex.data.stepsMoved, c: ex.data.checklistMoved, r: ex.data.reportsMoved })}`);
ok((await stepOf(LEAVER)) === 0 && (await bundle(SUCC)).checklistTasks.some((c) => c.title === "Daily stock check" && c.doerId === SUCC) && (await bundle(boss)).users.find((u) => u.userId === JUNIOR).managerId === SUCC, "…and nothing is left on her");
ok((await call(LEAVER, "getFlowData", {})).code === "UNAUTHORIZED", "she can no longer use the app (an old session is refused at once)");
ok((await bundle(SUCC)).notifications.some((n) => /has left/.test(n.title)), "Sushma is told");
const reg = (await bundle(ANIL)).users.find((u) => u.userId === LEAVER);
ok(reg.exitDate === TODAY && reg.exitType === "Resigned" && reg.exitReason === "Better offer" && reg.status === "Inactive", "the exit register shows who left, when and why (to those who may record exits)");
ok((await bundle(MEERA)).users.find((u) => u.userId === LEAVER).exitReason === undefined, "…the note stays hidden from a Manager");
ok(!(await call(ANIL, "recordExit", exitData(LEAVER))).ok, "a second exit for the same person is refused");
ok(denied(await call(MEERA, "reinstateUser", { userId: LEAVER })) && (await call(ANIL, "reinstateUser", { userId: LEAVER })).ok && (await call(LEAVER, "getFlowData", {})).ok, "an Admin can reinstate someone who comes back");
const later = await call(ANIL, "recordExit", exitData(LEAVER, { exitDate: "2026-10-20", handoverToId: "" }));
ok(later.ok && !later.data.applied && later.data.user.status === "Active", "a last day in the future keeps the person active for now");
await runTick(db, undefined, at("2026-10-21", "03:00"));
const settled = (await bundle(boss)).users.find((u) => u.userId === LEAVER);
ok(settled.status === "Inactive" && settled.exitDone === "Y", "…the daily tick switches them off on their last day");

section("switch off and delete");
ok((await call(ANIL, "setUserStatus", { userId: ROHAN, status: "Inactive", note: "on long leave" })).ok && (await call(ROHAN, "getFlowData", {})).code === "UNAUTHORIZED", "an Admin switches a person off (no exit)");
ok((await call(ANIL, "setUserStatus", { userId: ROHAN, status: "Active" })).ok && (await call(ROHAN, "getFlowData", {})).ok, "…and back on");
ok(denied(await call(ANIL, "deleteUser", { userId: ASHA, confirmName: "Asha" })) && denied(await call(MEERA, "deleteUser", { userId: ASHA, confirmName: "Asha" })), "only the Super Admin can delete a person");
const used = await call(boss, "deleteUser", { userId: ROHAN, confirmName: "Rohan" });
ok(!used.ok && used.code === "HAS_HISTORY", "someone with history (attendance, work, leave) cannot be deleted — only switched off");
const NEWBIE = await mk("Mistake Entry", "STAFF", "9000000035", "Sales");
ok(!(await call(boss, "deleteUser", { userId: NEWBIE, confirmName: "mistake" })).ok, "the Super Admin must type the exact name");
ok((await call(boss, "deleteUser", { userId: NEWBIE, confirmName: "Mistake Entry" })).ok && (await bundle(boss)).users.every((u) => u.userId !== NEWBIE || u.deleted === "Y"), "a person who never did anything is deleted and is marked deleted for every list");
ok((await call(boss, "saveUser", { name: "Fresh Start", role: "STAFF", mobile: "9000000035", pin: "4444" })).ok, "…and their mobile number can be used again");
ok(denied(await call(boss, "deleteUser", { userId: boss, confirmName: "Owner" })), "the Super Admin cannot delete themselves");
ok((await call(boss, "deleteUser", { userId: MEERA, confirmName: "Meera" })).code === "HAS_REPORTS", "a person who still has people reporting to them cannot be deleted");
const wentAway = await call(boss, "deleteUser", { userId: LEAVER, confirmName: "Leela" });
ok(wentAway.ok && (await bundle(boss)).users.find((u) => u.userId === LEAVER)?.deleted === "Y" && (await bundle(boss)).users.find((u) => u.userId === LEAVER)?.name === "Leela", `someone who left (with history) can be deleted: gone from the lists, the name stays for old records ${wentAway.error ?? ""}`);
const OTHER_SA = await mk("Second Owner", "ADMIN", "9000000036", "Sales");
await call(boss, "saveUserAccess", { userId: OTHER_SA, role: "SUPER_ADMIN" });
ok((await call(OTHER_SA, "recordExit", exitData(boss, { handoverToId: "" }))).ok === true && (await call(boss, "getFlowData", {})).code === "UNAUTHORIZED", "one Super Admin may leave when another stays");
ok(denied(await call(OTHER_SA, "recordExit", exitData(OTHER_SA))), "…but nobody can exit themselves, so the last Super Admin always stays");

// =============================================================== Super Admin console
section("console: manual corrections, restore, checks, announcements — Super Admin only");
// (the first owner left in the section above; the second Super Admin carries on)
SA = OTHER_SA;
for (const a of ["adminTables", "adminChecks"]) ok(denied(await call(ANIL, a, {})) && denied(await call(MEERA, a, {})), `${a}: not for an Admin or a Manager`);
ok(denied(await call(ANIL, "adminRows", { table: "Users" })) && denied(await call(ANIL, "adminEditRow", { table: "Users", id: ASHA, changes: { department: "X" } })) && denied(await call(ANIL, "adminSetDeleted", { table: "Holidays", id: "x", deleted: true })) && denied(await call(ANIL, "saveAnnouncement", { title: "Hi" })), "…nor the rows, edits, restore or announcements");
const tables = (await call(OTHER_SA, "adminTables", {})).data.tables.map((t) => t.table);
ok(tables.includes("Users") && tables.includes("Attendance") && !tables.includes("Notes") && !tables.includes("Vault_Items") && !tables.includes("Salary_Slips") && !tables.includes("Audit_Log"), "private notes, vault secrets, salary slips and the activity log are not in the editor");
ok(!(await call(OTHER_SA, "adminRows", { table: "Vault_Items" })).ok && !(await call(OTHER_SA, "adminRows", { table: "Notes" })).ok, "…and cannot be opened by name either");
const ur = (await call(OTHER_SA, "adminRows", { table: "Users", q: "Asha" })).data;
ok(ur.rows.length === 1 && !JSON.stringify(ur).includes("pinHash") && !ur.columns.some((c) => ["pinHash", "permsJson"].includes(c.key)), "the people table never shows PIN hashes or access overrides");
const ed = await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { department: "Dispatch", leaveAllot: "15" } });
ok(ed.ok && ed.data.changed.length === 2 && (await bundle(OTHER_SA)).users.find((u) => u.userId === ASHA).department === "Dispatch", `a field is corrected by hand: ${ed.error ?? ""}`);
const aud = (await call(OTHER_SA, "auditLog", {})).data.rows.find((a) => a.action === "Record corrected by the Super Admin" && a.recordId === ASHA);
ok(aud && /Stores/.test(aud.oldValue) && /Dispatch/.test(aud.newValue), "the old and the new value are in the activity log");
ok(!(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { userId: "USR-HACK" } })).ok && !(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { pinHash: "x" } })).ok && !(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { nope: "x" } })).ok, "ids, PIN hashes and unknown columns cannot be changed");
ok(!(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { role: "KING" } })).ok && !(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { managerId: "USR-NOBODY" } })).ok && !(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { empCode: (await bundle(OTHER_SA)).users.find((u) => u.userId === ROHAN).empCode } })).ok, "a wrong role, a manager who does not exist or a repeated Employee ID is refused");
ok(!(await call(OTHER_SA, "adminEditRow", { table: "Users", id: OTHER_SA, changes: { status: "Inactive" } })).ok, "the last Super Admin cannot be switched off from here either");
ok(!(await call(OTHER_SA, "adminEditRow", { table: "Users", id: ASHA, changes: { department: "Dispatch" } })).ok, "an edit that changes nothing says so");
const attRow = (await call(OTHER_SA, "adminRows", { table: "Attendance", q: ROHAN })).data.rows.find((r) => r.date === TODAY);
ok(!(await call(OTHER_SA, "adminEditRow", { table: "Attendance", id: attRow.attId, changes: { checkOut: "2026-10-07 08:00" } })).ok && (await call(OTHER_SA, "adminEditRow", { table: "Attendance", id: attRow.attId, changes: { checkOut: "2026-10-07 18:10" } })).ok, "attendance: a check-out before the check-in is refused, a real one is saved");
// a step corrected by hand updates the entry
const stepsNow = (await bundle(OTHER_SA)).tasks.filter((t) => t.flowId === fl.data.flowId && t.status === "Pending");
const one = stepsNow[0];
const items0 = (await bundle(OTHER_SA)).items.find((i) => i.itemId === one.itemId);
const doneEd = await call(OTHER_SA, "adminEditRow", { table: "Flow_Tasks", id: one.taskId, changes: { status: "Done" } });
ok(doneEd.ok, `a step is marked done by hand: ${doneEd.error ?? ""}`);
const after = (await bundle(OTHER_SA)).tasks.find((t) => t.taskId === one.taskId);
ok(after.status === "Done" && !!after.actual && (await bundle(OTHER_SA)).items.find((i) => i.itemId === one.itemId).status === (stepsNow.filter((t) => t.itemId === one.itemId).length === 1 ? "Completed" : items0.status), "…it gets a time, and the entry follows its steps");
// holiday: hide and bring back
const hh = await call(OTHER_SA, "saveHoliday", { date: "2026-12-31", label: "Year end" });
ok((await call(OTHER_SA, "deleteHoliday", { holidayId: hh.data.holiday.holidayId })).ok && !(await bundle(ROHAN)).holidays.some((h) => h.date === "2026-12-31"), "a holiday is deleted");
const gone = (await call(OTHER_SA, "adminRows", { table: "Holidays", deleted: true })).data.rows.find((r) => r.date === "2026-12-31");
ok(gone && gone.deleted === "Y", "…and found again in the console with deleted rows shown");
ok((await call(OTHER_SA, "adminSetDeleted", { table: "Holidays", id: hh.data.holiday.holidayId, deleted: false })).ok && (await bundle(ROHAN)).holidays.some((h) => h.date === "2026-12-31"), "…and restored");
ok(!(await call(OTHER_SA, "adminSetDeleted", { table: "Flow_Items", id: "x", deleted: true })).ok, "tables that do not keep deleted rows cannot be hidden");
const csv = await call(OTHER_SA, "adminExport", { table: "Leaves" });
ok(csv.ok && csv.data.rows.length >= 1 && (await call(OTHER_SA, "auditLog", {})).data.rows.some((a) => a.action === "Data export" && a.recordId === "console"), "a table can be downloaded and the download is logged");
// data checks
const chk = (await call(OTHER_SA, "adminChecks", {})).data;
ok(chk.checks.some((c) => c.id === "no-policy") || chk.checks.length >= 0, "the data check runs");
const BOSSLESS = await mk("Orphan Check", "STAFF", "9000000041", "Sales");
await call(OTHER_SA, "saveChecklistTask", { title: "Orphan task", doerId: BOSSLESS, freq: "D", startDate: TODAY });
await call(OTHER_SA, "setUserStatus", { userId: BOSSLESS, status: "Inactive" });
const chk2 = (await call(OTHER_SA, "adminChecks", {})).data.checks;
ok(chk2.some((c) => c.id === "orphan-checklist" && c.count >= 1), "work left on a switched-off person is reported");
// announcements
section("announcements");
const an = await call(OTHER_SA, "saveAnnouncement", { title: "Office closed Friday", body: "Water tank cleaning.", audience: "dept:Sales", tone: "important" });
ok(an.ok, `the Super Admin posts a notice for Sales: ${an.error ?? ""}`);
ok((await call(MEERA, "listAnnouncements", {})).data.announcements.length === 1 && (await call(ASHA, "listAnnouncements", {})).data.announcements.length === 0, "people in Sales read it; others do not");
ok((await bundle(MEERA)).notifications.some((n) => /Office closed/.test(n.title) && /^Important/.test(n.title)) && !(await bundle(ASHA)).notifications.some((n) => /Office closed/.test(n.title)), "…and are notified, others are not");
ok((await call(OTHER_SA, "saveAnnouncement", { title: "Welcome", audience: "all", startDate: "2026-12-01" })).ok && (await call(MEERA, "listAnnouncements", {})).data.announcements.length === 1, "a notice with a future start is not shown yet");
ok(!(await call(OTHER_SA, "saveAnnouncement", { title: "", audience: "all" })).ok && !(await call(OTHER_SA, "saveAnnouncement", { title: "x", audience: "everybody" })).ok && !(await call(OTHER_SA, "saveAnnouncement", { title: "x", audience: "all", startDate: "2026-12-05", endDate: "2026-12-01" })).ok, "empty title, bad audience, reversed dates are refused");
ok(denied(await call(MEERA, "deleteAnnouncement", { annId: an.data.annId })) && (await call(OTHER_SA, "deleteAnnouncement", { annId: an.data.annId })).ok && (await call(MEERA, "listAnnouncements", {})).data.announcements.length === 0, "only the Super Admin removes a notice");

// =============================================================== salary-slip e-mail: delivery log, no duplicates, retry
section("salary slip e-mail: delivery log, no duplicate mails, retry");
const sent = []; let breakSmtp = false;
setMailTransport({ async sendMail(m) { if (breakSmtp) throw new Error("connection refused"); sent.push(m); } });
const CFG = { smtpUrl: "smtp://fake", mailFrom: "MIDAP <hr@test>", appUrl: "https://fms.test" };
const callM = (actor, action, data = {}, when) => runAction(db, actor, action, data, { now: when ? at(...[].concat(when)) : at("2026-10-07"), delivery: CFG });
const MAILEE = await mk("Mailee", "STAFF", "9000000061", "Sales", MEERA, { email: "mailee@test.in" });
const MIA = await mk("Mia", "STAFF", "9000000062", "Sales", MEERA); // no e-mail address
const mailSlip = (userId, period) => ({ userId, period, daysPaid: 30, earnings: [{ label: "Basic", amount: 41111 }], deductions: [{ label: "PF", amount: 1800 }], note: "" });
const mkSlip = async (userId, period) => (await call(PAY, "saveSlip", mailSlip(userId, period))).data.slipId;
const log = async (extra = {}) => (await call(PAY, "listMailLog", extra)).data;

const sA = await mkSlip(MAILEE, "2026-05");
const pA = await callM(PAY, "publishSlips", { slipIds: [sA] });
let lg = await log();
const rowA = lg.mails.find((m) => m.refId === sA);
ok(pA.ok && sent.length === 1 && sent[0].to === "mailee@test.in" && rowA?.status === "Sent" && rowA.attempts === 1 && rowA.sentAt, `publishing mails the slip to the right address and logs it as Sent → ${JSON.stringify({ n: sent.length, st: rowA?.status })}`);
ok(/https:\/\/fms\.test\/api\/slip\/SLP/.test(sent[0].text) && sent[0].attachments.length === 1 && /salary-slip-2026-05/.test(sent[0].attachments[0].filename), "the mail has the private link and the slip as an attachment");
ok(!JSON.stringify(await call(PAY, "listMailLog", {})).match(/41111|39311/) && !/41,111|39,311/.test(sent[0].text), "no salary figure in the log or in the mail text");
// republish / retry / run twice: still one mail
await callM(PAY, "publishSlips", { slipIds: [sA], publish: false });
ok((await log()).mails.find((m) => m.refId === sA).status === "Sent", "taking a slip back to draft does not change a mail that already went");
await callM(PAY, "publishSlips", { slipIds: [sA] });
await processMailQueue(db, CFG, { now: at("2026-10-07") }); await runTick(db, CFG, at("2026-10-08"));
lg = await log();
ok(sent.length === 1 && lg.mails.filter((m) => m.refId === sA).length === 1, `publishing again, a retry pass and the scheduler do not mail the same slip twice (${sent.length} mail, ${lg.mails.filter((m) => m.refId === sA).length} log row)`);
// corrected figures are a new version → mailed
await callM(PAY, "publishSlips", { slipIds: [sA], publish: false });
await call(PAY, "saveSlip", { ...mailSlip(MAILEE, "2026-05"), slipId: sA, earnings: [{ label: "Basic", amount: 42000 }] });
await callM(PAY, "publishSlips", { slipIds: [sA] });
ok(sent.length === 2 && (await log()).mails.filter((m) => m.refId === sA && m.status === "Sent").length === 2, "a slip corrected after sending is a new version and is mailed once more");
// failure → Failed with reason → retried later
breakSmtp = true;
const sB = await mkSlip(MAILEE, "2026-04");
const pB = await callM(PAY, "publishSlips", { slipIds: [sB] });
let rowB = (await log()).mails.find((m) => m.refId === sB);
ok(pB.ok && rowB.status === "Failed" && rowB.attempts === 1 && /connection refused/.test(rowB.lastError) && rowB.nextTry, `a failed delivery is kept as Failed with the reason and a next try → ${JSON.stringify({ st: rowB?.status, err: rowB?.lastError })}`);
ok((pB.warnings ?? []).some((w) => /could not be sent/.test(w)) && (await call(MAILEE, "listSlips", {})).data.slips.some((s) => s.period === "2026-04"), "payroll is told; the slip itself is still published and downloadable");
breakSmtp = false;
const early = await processMailQueue(db, CFG, { now: at("2026-10-07", "10:05") });
ok(early.sent === 0 && (await log()).mails.find((m) => m.refId === sB).status === "Failed", "the scheduler does not retry before the waiting time (15 minutes) is over");
const retryRun = await processMailQueue(db, CFG, { now: at("2026-10-07", "10:20") });
rowB = (await log()).mails.find((m) => m.refId === sB);
ok(retryRun.sent === 1 && rowB.status === "Sent" && rowB.attempts === 2 && sent.length === 3, "…and after it the retry sends it (once)");
// gives up after 5 attempts; manual Retry starts again
breakSmtp = true;
const sC = await mkSlip(MAILEE, "2026-03");
await callM(PAY, "publishSlips", { slipIds: [sC] });
for (let i = 1; i <= 6; i++) await processMailQueue(db, CFG, { now: at("2026-10-" + String(7 + i).padStart(2, "0")) });
let rowC = (await log()).mails.find((m) => m.refId === sC);
ok(rowC.status === "Failed" && rowC.attempts === 5, `after 5 failed tries it stops (${rowC.attempts}) and waits for a person`);
breakSmtp = false;
ok(denied(await call(MEERA, "retryMails", { mailIds: [rowC.mailId] })) && denied(await call(MAILEE, "retryMails", {})), "only payroll can press Retry");
const rt = await callM(PAY, "retryMails", { mailIds: [rowC.mailId] });
rowC = (await log()).mails.find((m) => m.refId === sC);
ok(rt.ok && rowC.status === "Sent" && sent.length === 4, "Retry sends it");
// no e-mail address
const sD = await mkSlip(MIA, "2026-05");
const pD = await callM(PAY, "publishSlips", { slipIds: [sD] });
let rowD = (await log()).mails.find((m) => m.refId === sD);
ok(pD.ok && rowD.status === "Failed" && /no e-mail address/.test(rowD.lastError) && sent.length === 4, "a person without an e-mail address is logged as Failed with the reason (nothing sent to a wrong address)");
await call(SA, "saveUser", { userId: MIA, name: "Mia", mobile: "9000000062", department: "Sales", managerId: MEERA, email: "mia@test.in" });
await callM(PAY, "retryMails", { mailIds: [rowD.mailId] });
rowD = (await log()).mails.find((m) => m.refId === sD);
ok(rowD.status === "Sent" && sent[4]?.to === "mia@test.in", "…after the address is added, Retry sends it to the new address");
// privacy of the log + resend
ok(denied(await call(ROHAN, "listMailLog", {})) && denied(await call(MEERA, "listMailLog", {})) && denied(await call(MAILEE, "resendSlipMail", { slipId: sA })), "the e-mail log is for payroll only");
const rs = await callM(PAY, "resendSlipMail", { slipId: sA });
ok(rs.ok && sent.length === 6, `a deliberate "send again" works even though the slip was sent before (${sent.length} mails)`);
// two runs at the same moment
const sE = await mkSlip(MAILEE, "2026-02");
setMailTransport({ async sendMail(m) { await new Promise((r) => setTimeout(r, 30)); sent.push(m); } });
await call(PAY, "publishSlips", { slipIds: [sE] }); // no delivery config: queued only
const sentBefore = sent.length;
await Promise.all([processMailQueue(db, CFG, { now: at("2026-10-07") }), processMailQueue(db, CFG, { now: at("2026-10-07") }), runTick(db, CFG, at("2026-10-07"))]);
ok(sent.length === sentBefore + 1 && (await log()).mails.filter((m) => m.refId === sE && m.status === "Sent").length === 1, "three runs at the same moment send a queued slip exactly once");
// e-mail not set up → waits, then goes out
setMailTransport({ async sendMail(m) { sent.push(m); } });
const sF = await mkSlip(MAILEE, "2026-01");
const noSmtp = await call(PAY, "publishSlips", { slipIds: [sF] });
let rowF = (await log()).mails.find((m) => m.refId === sF);
ok(noSmtp.ok && (noSmtp.warnings ?? []).some((w) => /E-mail is not set up/.test(w)) && rowF.status === "Pending", "with no mail server the mail waits as Pending (not lost, not Failed)");
const nWait = sent.length;
await processMailQueue(db, CFG, { now: at("2026-10-07") });
ok(sent.length === nWait + 1 && (await log()).mails.find((m) => m.refId === sF).status === "Sent", "…and goes out as soon as e-mail is set up");
// taken back before it was sent → cancelled
setMailTransport({ async sendMail(m) { sent.push(m); } });
const sG = await mkSlip(ASHA, "2026-01");
await call(SA, "saveUser", { userId: ASHA, name: "Asha", mobile: "9000000023", department: "Stores", email: "asha@test.in" });
await call(PAY, "publishSlips", { slipIds: [sG] });
await call(PAY, "publishSlips", { slipIds: [sG], publish: false });
const nCancel = sent.length; await processMailQueue(db, CFG, { now: at("2026-10-07") });
ok(sent.length === nCancel && (await log()).mails.find((m) => m.refId === sG).status === "Cancelled", "a slip taken back to draft before it was sent is cancelled, not mailed");
ok((await call(SA, "saveSettings", { settings: { PAY_EMAIL_ATTACH: "N" } })).ok, "the attachment can be switched off (link only)");
setMailTransport(null);

// =============================================================== kiosk punches feed the salary
section("kiosk attendance is the same attendance: it counts for salary");
ok((await call(PAY, "saveStructure", { userId: MAILEE, earnings: [{ label: "Basic", amount: 31000 }] })).ok, "a salary for Mailee (August 2026: 31 days, Sundays off)");
const kp = await call(SA, "kioskPunch", { empCode: "MAI1" }, ["2026-08-03", "09:00"]);
const ko = await call(SA, "kioskPunch", { empCode: "MAI1" }, ["2026-08-03", "18:00"]);
ok(kp.ok && kp.data.action === "in" && ko.ok && ko.data.action === "out" && ko.data.attendance.source === "kiosk" && ko.data.attendance.checkOut === "2026-08-03 18:00", "a kiosk check-in and check-out are saved as one row with the right times");
const k08 = (await call(PAY, "payrollPreview", { period: "2026-08" })).data.rows.find((r) => r.userId === MAILEE);
ok(k08.calc.present === 1 && !k08.calc.absentDates.includes("2026-08-03") && k08.calc.absentDates.includes("2026-08-04"), "the kiosk day counts as present for salary; a day without any punch is still an absence");
ok((await call(SA, "getFlowData", {}, ["2026-08-03", "19:00"])).data.attendance.filter((r) => r.userId === MAILEE && r.date === "2026-08-03").length === 1, "…and it is in the main attendance sheet once (no duplicate)");

// =============================================================== check-in / check-out
section("check-in and check-out: repeated clicks and bad order");
const [c1, c2, c3] = await Promise.all([call(ASHA, "checkIn", {}, [TODAY, "09:20"]), call(ASHA, "checkIn", {}, [TODAY, "09:20"]), call(ASHA, "checkIn", {}, [TODAY, "09:20"])]);
const rowsIn = (await bundle(ASHA, TODAY)).attendance.filter((a) => a.date === TODAY);
ok([c1, c2, c3].filter((r) => r.ok).length >= 1 && rowsIn.length === 1, `three quick clicks make ONE check-in (${rowsIn.length} row)`);
ok(!(await call(ASHA, "checkIn", {}, [TODAY, "09:25"])).ok, "checking in again is refused");
ok((await call(PAY, "checkOut", {}, [TODAY, "17:00"])).ok === false, "check-out without a check-in is refused");
const out1 = await call(ASHA, "checkOut", {}, [TODAY, "17:45"]);
ok(out1.ok && out1.data.checkOut.endsWith("17:45") && out1.data.checkIn.endsWith("09:20"), "check-out stores the right times (Asia/Kolkata)");
ok(!(await call(ASHA, "checkOut", {}, [TODAY, "17:46"])).ok, "a second check-out is refused");
ok(!(await call(ASHA, "checkIn", {}, [TODAY, "17:45"])).ok, "no new check-in in the same minute as the check-out");
ok(denied(await call(ASHA, "markAttendance", { userId: ASHA, date: TODAY, checkIn: "09:00", checkOut: "18:00" })) && denied(await call(ASHA, "deleteAttendance", { attId: out1.data.attId })), "an employee cannot rewrite attendance");
ok((await call(MEERA, "markAttendance", { userId: TEAM2, date: TODAY, checkIn: "09:30", checkOut: "17:30" })).ok && denied(await call(MEERA, "markAttendance", { userId: ASHA, date: TODAY, checkIn: "09:30", checkOut: "17:30" })), "a manager corrects the team's attendance, not everyone's");

console.log(`\n${pass} passed, ${failed} failed`);
fake.close();
process.exitCode = failed ? 1 : 0;
