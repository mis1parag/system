// Checklist + scorecard, end to end against the local fake Google Sheets.
//   node --no-warnings tools/test-checklist.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup, runTick } from "../src/server/domain/system.ts";
import { parseFlow } from "../src/lib/flow-parse.ts";
import { buildUnits, teamWeek, weekCard, weekStartOf } from "../src/lib/scorecard.ts";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;
const db = new Db(createSheetsClient({ spreadsheetId: "cl", baseUrl: base }), { ttlMs: 0 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };
const section = (s) => console.log("\n" + s);
// IST wall-clock → Date
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const denied = (r) => !r.ok && r.code === "FORBIDDEN";
const call = (actor, action, data = {}, now) => runAction(db, actor, action, data, { now: now ? at(...[].concat(now)) : undefined });

const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: true })).userId;
const { Users } = await db.load(["Users"], { fresh: true });
const id = (n) => String(Users.find((u) => u.name === n).userId);
const PRIYA = id("Priya Coordinator"), KUNAL = id("Kunal"), NIDHI = id("Nidhi");
const s = await call(boss, "saveUser", { name: "Sonu", role: "STAFF", mobile: "9000000013", pin: "4444" });
const SONU = s.data.userId;

const MON = "2026-10-05"; // a Monday
await call(boss, "addHolidays", { dates: ["2026-10-08"], label: "Test holiday" }, MON);

section("daily task: working days only, holiday and Sunday skipped, a week ahead");
const d1 = await call(boss, "saveChecklistTask", { title: "Post on Instagram", doerId: KUNAL, freq: "D", startDate: MON, department: "PC", backupId: NIDHI }, MON);
ok(d1.ok, `save daily: ${d1.error}`);
let log = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === d1.data.task.ctId);
const days = log.map((l) => l.plannedDate).sort();
ok(days.join() === "2026-10-05,2026-10-06,2026-10-07,2026-10-09,2026-10-10,2026-10-12", `daily dates: ${days.join()}`);
ok(!days.includes("2026-10-11") && !days.includes("2026-10-08"), "no Sunday, no holiday");
const again = await call(boss, "generateChecklist", {}, MON);
ok(again.ok && again.data.created === 0, "generating again creates nothing (no duplicates)");

section("weekly, monthly (clamped / moved off Sunday), one-time (moved off Sunday), fortnightly");
const w = await call(boss, "saveChecklistTask", { title: "Bank reconciliation", doerId: NIDHI, freq: "W", startDate: "2026-10-07" }, MON);
const wl = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === w.data.task.ctId).map((l) => l.plannedDate);
ok(wl.join() === "2026-10-07", `weekly within the horizon: ${wl.join()}`);
const o = await call(boss, "saveChecklistTask", { title: "Renew licence", doerId: KUNAL, freq: "O", startDate: "2026-10-11" }, MON);
const ol = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === o.data.task.ctId).map((l) => l.plannedDate);
ok(ol.join() === "2026-10-12", `one-time on Sunday moves to Monday: ${ol.join()}`);
const m = await call(boss, "saveChecklistTask", { title: "TDS sheet", doerId: NIDHI, freq: "M", startDate: "2026-08-31" }, MON);
ok(m.ok && m.data.created === 0, "monthly: nothing yet inside the coming week");
await call(boss, "generateChecklist", {}, "2026-10-26");
let all = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log;
ok(all.some((l) => l.ctId === m.data.task.ctId && l.plannedDate === "2026-10-31"), "monthly on the 31st lands on 31 Oct");
const m2 = await call(boss, "saveChecklistTask", { title: "Pay rent", doerId: NIDHI, freq: "M", startDate: "2026-09-01" }, "2026-10-28");
all = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log;
ok(all.some((l) => l.ctId === m2.data.task.ctId && l.plannedDate === "2026-11-02"), "monthly on Sun 1 Nov moves to Mon 2 Nov");
const f = await call(boss, "saveChecklistTask", { title: "Deep clean", doerId: SONU, freq: "F", startDate: "2026-09-21" }, MON);
const fl = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === f.data.task.ctId).map((l) => l.plannedDate);
ok(fl.join() === "2026-10-05", `fortnightly from 21 Sep hits 5 Oct: ${fl.join()}`);
const y = await call(boss, "saveChecklistTask", { title: "Audit", doerId: SONU, freq: "Y", startDate: "2025-10-06" }, MON);
const yl = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === y.data.task.ctId).map((l) => l.plannedDate);
ok(yl.join() === "2026-10-06", `yearly: ${yl.join()}`);

section("validation and permissions");
ok(!(await call(boss, "saveChecklistTask", { title: "", doerId: KUNAL, freq: "D" }, MON)).ok, "task text required");
ok(!(await call(boss, "saveChecklistTask", { title: "x", doerId: KUNAL, freq: "Z" }, MON)).ok, "bad frequency refused");
ok(!(await call(boss, "saveChecklistTask", { title: "x", doerId: KUNAL, backupId: KUNAL, freq: "D" }, MON)).ok, "buddy must differ from the doer");
ok(!(await call(boss, "saveChecklistTask", { title: "x", doerId: KUNAL, freq: "D", startDate: "2026-10-05", endDate: "2026-10-01" }, MON)).ok, "end before start refused");
const forbidden = await call(KUNAL, "saveChecklistTask", { title: "x", doerId: KUNAL, freq: "D" }, MON);
ok(!forbidden.ok && forbidden.code === "FORBIDDEN", "staff cannot create checklist tasks");

section("ticking tasks off");
const monLog = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log;
const kMon = monLog.find((l) => l.ctId === d1.data.task.ctId && l.plannedDate === MON);
const nidhiTry = await call(SONU, "completeChecklist", { clId: kMon.clId }, MON);
ok(!nidhiTry.ok && nidhiTry.code === "FORBIDDEN", "someone else cannot tick Kunal's task");
const done1 = await call(KUNAL, "completeChecklist", { clId: kMon.clId, remarks: "posted" }, MON);
ok(done1.ok && done1.data.status === "Done" && done1.data.actual === "2026-10-05 10:00" && done1.data.doneBy === KUNAL, "doer ticks it");
ok(!(await call(KUNAL, "completeChecklist", { clId: kMon.clId }, MON)).ok, "cannot tick twice");
const kTue = monLog.find((l) => l.ctId === d1.data.task.ctId && l.plannedDate === "2026-10-06");
const late = await call(KUNAL, "completeChecklist", { clId: kTue.clId }, "2026-10-07");
ok(late.ok && late.data.actual.slice(0, 10) === "2026-10-07", "a late tick is stored with the real time");
const pr = await call(boss, "saveChecklistTask", { title: "Upload GST challan", doerId: NIDHI, freq: "D", startDate: MON, proof: "Y" }, MON);
const prEntry = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.ctId === pr.data.task.ctId && l.plannedDate === MON);
ok(!(await call(NIDHI, "completeChecklist", { clId: prEntry.clId }, MON)).ok, "proof-required task refuses a tick without proof");
ok((await call(NIDHI, "completeChecklist", { clId: prEntry.clId, proof: "https://drive.example/challan" }, MON)).ok, "…accepts it with proof");
const wed = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.plannedDate === "2026-10-07" && l.status === "Pending" && (l.doerId === NIDHI));
const many = await call(NIDHI, "completeChecklistMany", { clIds: wed.map((l) => l.clId) }, "2026-10-07");
ok(many.ok && many.data.done >= 1, `tick many: ${many.data?.done} done, ${many.data?.skipped?.length} skipped`);
// a mis-tap can be undone by the doer for half an hour, after that only an admin can
const undo1 = await call(KUNAL, "reopenChecklist", { clId: kMon.clId }, [MON, "10:20"]);
ok(undo1.ok && undo1.data.status === "Pending", "a mis-tap can be undone by the doer within 30 minutes");
await call(KUNAL, "completeChecklist", { clId: kMon.clId }, [MON, "10:25"]);
const undo2 = await call(KUNAL, "reopenChecklist", { clId: kMon.clId }, [MON, "13:00"]);
ok(!undo2.ok, "…but not later");
ok(!(await call(NIDHI, "reopenChecklist", { clId: kMon.clId }, [MON, "10:30"])).ok, "…and not by someone else");
const reopen = await call(boss, "reopenChecklist", { clId: kMon.clId }, MON);
ok(reopen.ok && reopen.data.status === "Pending" && reopen.data.actual === "", "admin can reopen");
await call(KUNAL, "completeChecklist", { clId: kMon.clId }, MON);

const onBeh = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.ctId === d1.data.task.ctId && l.plannedDate === "2026-10-07" && l.status === "Pending");
const behalf = await call(boss, "completeChecklist", { clId: onBeh.clId }, "2026-10-07");
ok(behalf.ok && behalf.data.doneBy === KUNAL && /ticked by Owner/.test(behalf.data.remarks), "an admin ticking for someone credits that person");

section("buddy / backup covers while the doer is away");
const away = await call(boss, "createAbsence", { userId: KUNAL, fromDate: "2026-10-09", toDate: "2026-10-10", backupUserId: SONU, reason: "leave" }, MON);
ok(away.ok, `absence: ${away.error}`);
const fri = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log;
const kFri = fri.find((l) => l.ctId === d1.data.task.ctId && l.plannedDate === "2026-10-09");

ok(!(await call(SONU, "completeChecklist", { clId: kFri.clId }, "2026-10-09")).ok, "while Kunal is away the task's buddy (Nidhi) covers — not the absence backup");
ok((await call(NIDHI, "completeChecklist", { clId: kFri.clId }, "2026-10-09")).ok, "the buddy can tick Kunal's task");
const nb = await call(boss, "saveChecklistTask", { title: "Check returns", doerId: KUNAL, freq: "O", startDate: "2026-10-09" }, "2026-10-09");
const nbEntry = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.ctId === nb.data.task.ctId);
ok(nbEntry && (await call(SONU, "completeChecklist", { clId: nbEntry.clId }, "2026-10-09")).ok, "without a buddy the absence backup (Sonu) covers");

section("pause, edit schedule, bulk add");
const fut = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === d1.data.task.ctId && l.status === "Pending" && l.plannedDate >= "2026-10-12");
ok(fut.length >= 1, "daily task has future pending entries");
const paused = await call(boss, "saveChecklistTask", { ctId: d1.data.task.ctId, title: "Post on Instagram", doerId: KUNAL, freq: "D", startDate: MON, status: "Paused" }, "2026-10-09");
ok(paused.ok, `pause: ${paused.error}`);
let after = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === d1.data.task.ctId);
ok(after.filter((l) => l.plannedDate >= "2026-10-09" && l.status === "Pending").length === 0, "pausing cancels the coming entries");
ok(after.some((l) => l.plannedDate === MON && l.status === "Done"), "…and keeps the history");
const resumed = await call(boss, "saveChecklistTask", { ctId: d1.data.task.ctId, title: "Post on Instagram", doerId: KUNAL, freq: "W", startDate: "2026-10-12", status: "Active" }, "2026-10-09");
after = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === d1.data.task.ctId && l.status === "Pending" && l.plannedDate >= "2026-10-09");
ok(resumed.ok && after.map((l) => l.plannedDate).join() === "2026-10-12", `resumed as weekly: ${after.map((l) => l.plannedDate).join()}`);

const bulk = await call(boss, "bulkAddChecklistTasks", {
  defaultStart: "2026-10-09",
  rows: [
    { title: "Create TDS sheet", doer: "Nidhi", freq: "monthly", startDate: "07/10/2026", department: "Accounts" },
    { title: "Clear returns", doer: "kunal", freq: "D", buddy: "Nidhi" },
    { title: "Mystery task", doer: "Nobody", freq: "D" },
    { title: "Bad frequency", doer: "Nidhi", freq: "sometimes" },
    { title: "Bad date", doer: "Nidhi", freq: "D", startDate: "31/02/2026" },
    { title: "Clear returns", doer: "Kunal", freq: "D" },
    { title: "", doer: "Kunal", freq: "D" },
  ],
}, "2026-10-09");
ok(bulk.ok && bulk.data.added === 2, `bulk added ${bulk.data?.added}`);
ok(bulk.data.skipped.length === 5 && bulk.data.unknownDoers.join() === "Nobody", `bulk skipped: ${JSON.stringify(bulk.data.skipped.map((x) => x.reason))}`);

section("scorecard maths");
const bundle = (await call(boss, "getFlowData", {}, "2026-10-09")).data;
ok(Array.isArray(bundle.checklistTasks) && bundle.checklistTasks.length > 5 && Array.isArray(bundle.checklistLog), "bundle carries checklist data");
const units = buildUnits({ flows: [], items: [], tasks: [], checklistTasks: bundle.checklistTasks, checklistLog: bundle.checklistLog });
const wk = weekStartOf("2026-10-09");
ok(wk === MON, `week starts on Monday (${wk})`);
const kc = weekCard(units, KUNAL, MON, "2026-10-09");
const kd = kc.rows.find((r) => r.system === "Non-daily checklist"); // the Instagram task became weekly above, so its history now sits here
const kdc = kc.rows.find((r) => r.system === "Daily checklist");
ok(kdc && kdc.due === 1 && kdc.done === 0, `Kunal daily row: ${kdc?.due} due`);
// Kunal's daily tasks: Mon done on time, Tue done late, Wed ticked by the admin on his behalf, Thu = holiday, Fri (Clear returns) still open; Fri's Instagram post was done by his buddy
ok(kd && kd.due === 3 && kd.done === 3 && kd.doneOnTime === 2, `Kunal non-daily: due ${kd?.due} done ${kd?.done} on time ${kd?.doneOnTime}`);
ok(kd && kd.notDonePct === 0 && kd.notOnTimePct === 33.3, `percentages: ${kd?.notDonePct} / ${kd?.notOnTimePct}`);
const nc = weekCard(units, NIDHI, MON, "2026-10-09");
const fri9 = units.find((u) => u.who === NIDHI && u.planned === "2026-10-09" && u.done);
ok(!!fri9, "work done by the buddy counts for the buddy");
ok(nc.rows.some((r) => r.group === "NDC") && nc.rows.some((r) => r.group === "DC"), "rows are split Daily / Non-daily");
const team = teamWeek(units, MON, "2026-10-09");
ok(team.length >= 3 && team.every((t) => t.trend.length === 6), "team table with a 6-week trend");
const nothing = weekCard(units, boss, MON, "2026-10-09");
ok(nothing.score === null && nothing.total.planned === 0, "someone with no work has no score");
const future = weekCard(units, KUNAL, "2026-10-12", "2026-10-09");
ok(future.total.due === 0 && future.total.upcoming >= 0, "a future week has nothing due yet");
// FMS steps join the same scorecard
const flowId = (await call(boss, "createFlow", {
  name: "Mini FMS", fields: [{ key: "po", label: "PO", type: "text", required: true }, { key: "due", label: "Due", type: "date", required: true }], anchorField: "due", titleFields: ["po"],
  steps: [{ name: "Auto", assigneeId: KUNAL, rule: { base: "none" }, autoDone: true }, { name: "Dispatch", assigneeId: KUNAL, rule: { base: "anchor", offsetDays: 0 } }],
}, MON)).data.flowId;
await call(boss, "createEntry", { flowId, data: { po: "P1", due: "2026-10-06" } }, MON);
const b2 = (await call(boss, "getFlowData", {}, "2026-10-09")).data;
const u2 = buildUnits({ flows: b2.flows.map(parseFlow), items: b2.items, tasks: b2.tasks, checklistTasks: b2.checklistTasks, checklistLog: b2.checklistLog });
const fmsUnits = u2.filter((u) => u.group === "FMS");
ok(fmsUnits.length === 1 && fmsUnits[0].system === "Mini FMS · Dispatch" && !fmsUnits[0].done, "FMS steps appear as rows (auto-done steps are left out)");

section("reminders + staff only see their own");
const t1 = await runTick(db, undefined, at("2026-10-09", "17:05"));
ok(t1.checklistReminders >= 1, `evening reminders: ${t1.checklistReminders}`);
const t2 = await runTick(db, undefined, at("2026-10-09", "17:20"));
ok(t2.checklistReminders === 0, "reminders are sent once a day");
const nb2 = (await call(NIDHI, "getFlowData", {}, "2026-10-09")).data;
ok(nb2.checklistTasks.every((t) => t.doerId === NIDHI || t.backupId === NIDHI), "staff bundle only has their own checklist tasks");
ok(nb2.checklistLog.length > 0 && nb2.checklistLog.every((l) => nb2.checklistTasks.some((t) => t.ctId === l.ctId)), "…and only their entries");
const sk = await call(boss, "skipChecklist", { clId: (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.status === "Pending").clId, remarks: "client closed" }, "2026-10-09");
ok(sk.ok && sk.data.status === "Skipped", "admin can skip an entry with a reason");

section("an already set-up sheet gets the new tabs by itself");
const fake2 = createFakeSheets({});
await new Promise((r) => fake2.listen(0, r));
const c2 = createSheetsClient({ spreadsheetId: "old", baseUrl: `http://localhost:${fake2.address().port}` });
const db2 = new Db(c2, { ttlMs: 0 });
await runSetup(db2, { name: "Old", mobile: "9888888888", pin: "1234" });
const oldTabs = ["Users", "Flows", "Flow_Items", "Flow_Tasks", "Comments", "Requests", "Notifications", "Holidays", "Absences", "Settings", "Audit_Log"];
const fake3 = createFakeSheets({});
await new Promise((r) => fake3.listen(0, r));
const c3 = createSheetsClient({ spreadsheetId: "legacy", baseUrl: `http://localhost:${fake3.address().port}` });
await c3.addTabs(oldTabs);
const db3 = new Db(c3, { ttlMs: 0 });
await db3.ensureReadyOnce();
const tabs3 = (await c3.listTabs()).map((t) => t.title);
ok(oldTabs.length === 11 && tabs3.includes("Checklist_Tasks") && tabs3.includes("Checklist_Log"), `legacy sheet upgraded: ${tabs3.length} tabs`);

section("adding the whole team at once (email sign-in, departments, people who left)");
const newTeam = [
  { name: "Asha", department: "Accounts", email: "asha@example.com" },
  { name: "Bina", department: "CRM", email: "bina@example.com" },
  { name: "Chet", department: "MIS", email: "chet@example.com", role: "ADMIN" },
  { name: "Dev", department: "Dispatch", email: "dev@example.com", status: "Inactive" },
  { name: "", email: "noname@example.com" },
  { name: "Esha", department: "CRM", email: "not-an-email" },
];
const bu = await call(boss, "bulkSaveUsers", { rows: newTeam }, MON);
ok(bu.ok && bu.data.created === 4, `bulk users created ${bu.data?.created}: ${JSON.stringify(bu.data?.skipped)}`);
ok(bu.data.skipped.length === 2, "a row without a name and a bad email are skipped with a reason");
ok(bu.data.credentials.length === 3 && bu.data.credentials.every((c) => /^\d{4}$/.test(c.pin) && c.login.includes("@")), "PINs are returned once, only for people who can sign in");
const asha = bu.data.credentials.find((c) => c.name === "Asha");
const { login } = await import("../src/server/domain/auth.ts");
const li = await login(db, "ASHA@example.com", asha.pin);
ok(li.name === "Asha", "a person with no mobile signs in with their email + PIN");
let devOk = true; try { await login(db, "dev@example.com", "0000"); devOk = false; } catch { /* a person who left cannot sign in */ }
ok(devOk, "a person who left cannot sign in");
const rerun = await call(boss, "bulkSaveUsers", { rows: newTeam.slice(0, 4).map((t) => ({ ...t, department: t.department + " X" })) }, MON);
ok(rerun.ok && rerun.data.created === 0 && rerun.data.updated === 4, `running it rerun updates instead of duplicating (${rerun.data?.created} new, ${rerun.data?.updated} updated)`);
const allUsers2 = (await db.load(["Users"], { fresh: true })).Users;
ok(allUsers2.filter((u) => u.name === "Asha").length === 1 && allUsers2.find((u) => u.name === "Asha").department === "Accounts X", "department is stored on the person");
const asAdmin = await call(PRIYA, "bulkSaveUsers", { rows: [{ name: "Fay", email: "fay@example.com", role: "ADMIN" }, { name: "Gus", email: "gus@example.com" }] }, MON);
ok(asAdmin.ok && asAdmin.data.created === 1 && asAdmin.data.skipped.length === 1, "an Admin can add Staff but not other admins");
ok(!(await call(KUNAL, "bulkSaveUsers", { rows: [{ name: "Hax", email: "hax@example.com" }] }, MON)).ok, "staff cannot add people");

section("the Super Admin sees everything, other roles see a recent window");
const oldT = await call(boss, "saveChecklistTask", { title: "Old weekly report", doerId: NIDHI, freq: "O", startDate: "2026-01-07" }, "2026-01-07");
const oldE = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.ctId === oldT.data.task.ctId);
await call(NIDHI, "completeChecklist", { clId: oldE.clId }, "2026-01-07");
const superView = (await call(boss, "getFlowData", {}, "2026-10-09")).data;
const adminView = (await call(PRIYA, "getFlowData", {}, "2026-10-09")).data;
ok(superView.checklistLog.some((l) => l.clId === oldE.clId), "Super Admin gets old, finished checklist entries too");
ok(!adminView.checklistLog.some((l) => l.clId === oldE.clId), "an Admin gets the recent window only");
ok(superView.checklistTasks.length >= adminView.checklistTasks.length && superView.users.length === adminView.users.length, "the Super Admin sees at least everything an Admin sees");


section("delete ONE task (its unfinished entries go, history stays, nothing else changes)");
const dA = await call(boss, "saveChecklistTask", { title: "Task A to delete", doerId: KUNAL, freq: "D", startDate: MON }, MON);
const dB = await call(boss, "saveChecklistTask", { title: "Task B stays", doerId: KUNAL, freq: "D", startDate: MON }, MON);
const logOf = async (ctId) => (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.filter((l) => l.ctId === ctId);
const aBefore = await logOf(dA.data.task.ctId), bBefore = await logOf(dB.data.task.ctId);
const aFirst = aBefore.sort((x, y) => x.plannedDate.localeCompare(y.plannedDate))[0];
await call(KUNAL, "completeChecklist", { clId: aFirst.clId }, MON);
ok(denied(await call(NIDHI, "deleteChecklistTask", { ctId: dA.data.task.ctId }, MON)) && denied(await call(KUNAL, "deleteChecklistTask", { ctId: dA.data.task.ctId }, MON)), "an ordinary user cannot delete tasks (not even their own)");
ok(!(await call(boss, "deleteChecklistTask", { ctId: "CLT-NOPE" }, MON)).ok, "an unknown task is refused");
const del = await call(boss, "deleteChecklistTask", { ctId: dA.data.task.ctId, reason: "not needed" }, MON);
const aAfter = await logOf(dA.data.task.ctId), bAfter = await logOf(dB.data.task.ctId);
ok(del.ok && del.data.kept === 1 && del.data.cancelled === aBefore.length - 1, `the task's unfinished entries are cancelled (${del.data?.cancelled}), the ticked one stays (${del.data?.kept})`);
ok(aAfter.filter((l) => l.status === "Pending").length === 0 && aAfter.filter((l) => l.status === "Done").length === 1, "nothing of it is pending any more; the done entry is still there");
ok(bAfter.length === bBefore.length && bAfter.every((l) => l.status === "Pending"), "the other task of the same person is untouched");
ok(!(await call(KUNAL, "getFlowData", {}, MON)).data.checklistTasks.some((t) => t.ctId === dA.data.task.ctId), "it is gone from Kunal's lists");
ok(!(await call(boss, "deleteChecklistTask", { ctId: dA.data.task.ctId }, MON)).ok, "deleting it twice is refused");
const back = await call(boss, "saveChecklistTask", { ctId: dA.data.task.ctId, title: "Task A to delete", doerId: KUNAL, freq: "D", startDate: MON, status: "Active" }, MON);
ok(back.ok && back.data.created > 0 && (await call(KUNAL, "getFlowData", {}, MON)).data.checklistTasks.some((t) => t.ctId === dA.data.task.ctId), "a deleted task can be brought back (its entries are created again)");
ok(denied(await call(NIDHI, "deleteChecklistTask", { ctId: dB.data.task.ctId }, MON)), "(still) only people with the right can delete");

section("upcoming: not for daily tasks; yes for non-daily and one-time. Proof: a picture or a note, at least one");
const PIC = "data:image/jpeg;base64," + "B".repeat(600);
const FUT = "2026-10-12";
const dd = await call(boss, "saveChecklistTask", { title: "Daily upcoming test", doerId: KUNAL, freq: "D", startDate: MON }, MON);
const ww = await call(boss, "saveChecklistTask", { title: "Weekly upcoming test", doerId: KUNAL, freq: "W", startDate: FUT, proof: "Y" }, MON);
const oo = await call(boss, "saveChecklistTask", { title: "One-time upcoming test", doerId: KUNAL, freq: "O", startDate: FUT, proof: "Y" }, MON);
const entryOf = async (ctId, date) => (await logOf(ctId)).find((l) => l.plannedDate === date);
const dEntry = (await logOf(dd.data.task.ctId)).filter((l) => l.plannedDate > MON).sort((x, y) => x.plannedDate.localeCompare(y.plannedDate))[0];
const wEntry = await entryOf(ww.data.task.ctId, FUT), oEntry = await entryOf(oo.data.task.ctId, FUT);
ok(dEntry && wEntry && oEntry, "(fixture) an upcoming daily, weekly and one-time entry exist");
const upD = await call(KUNAL, "completeChecklist", { clId: dEntry.clId }, MON);
ok(!upD.ok && /daily task can only be ticked on its own day/.test(upD.error), "a DAILY task cannot be ticked before its day");
ok(!(await call(KUNAL, "completeChecklistMany", { clIds: [dEntry.clId] }, MON)).data.done, "…not even with 'tick many'");
ok(!(await call(boss, "completeChecklist", { clId: dEntry.clId }, MON)).ok, "…and not by an admin either");
const noProof = await call(KUNAL, "completeChecklist", { clId: wEntry.clId }, MON);
ok(!noProof.ok && /picture or write a note/.test(noProof.error), "a weekly task that needs proof refuses neither picture nor note");
ok(!(await call(KUNAL, "completeChecklist", { clId: wEntry.clId, proofImage: "data:image/png;base64,AAAA" }, MON)).ok && !(await call(KUNAL, "completeChecklist", { clId: wEntry.clId, proofImage: "junk" }, MON)).ok, "a PNG or junk is not accepted as a picture");
const wDone = await call(KUNAL, "completeChecklist", { clId: wEntry.clId, proofImage: PIC }, MON);
ok(wDone.ok && wDone.data.status === "Done" && wDone.data.proofImg && String(wDone.data.actual).slice(0, 10) < FUT, "a NON-DAILY task can be done ahead of time — with a picture only");
const oDone = await call(KUNAL, "completeChecklist", { clId: oEntry.clId, proof: "Sent by email to the CA" }, MON);
ok(oDone.ok && oDone.data.status === "Done" && !oDone.data.proofImg, "a ONE-TIME task can be done ahead of time — with a note only");
const lg = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log;
ok(lg.find((l) => l.clId === wEntry.clId).actual.slice(0, 10) <= FUT && lg.find((l) => l.clId === oEntry.clId).actual.slice(0, 10) <= FUT, "done ahead of time counts as on time");
const prf = await call(KUNAL, "getChecklistProof", { clId: wEntry.clId }, MON);
ok(prf.ok && prf.data.image === PIC, "the person can open their proof picture");
ok((await call(boss, "getChecklistProof", { clId: wEntry.clId }, MON)).ok, "…and so can the Super Admin");
ok(denied(await call(NIDHI, "getChecklistProof", { clId: wEntry.clId }, MON)), "…but not a colleague");
ok(!(await call(KUNAL, "getChecklistProof", { clId: oEntry.clId }, MON)).ok, "an entry without a picture says so");
ok(!JSON.stringify((await call(NIDHI, "getFlowData", {}, MON)).data).includes("BBBBBBBB"), "the picture is not part of the page data");
const upDaily2 = await call(KUNAL, "completeChecklist", { clId: dEntry.clId }, dEntry.plannedDate);
ok(upDaily2.ok, "on its own day the daily task can be ticked");

console.log(`\n${pass} passed, ${fail} failed`);
[fake, fake2, fake3].forEach((x) => x.close());
process.exit(fail ? 1 : 0);
