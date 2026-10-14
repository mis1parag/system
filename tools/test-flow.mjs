// End-to-end test of the whole server stack: Sheets API client → fake Sheets server → table layer → FMS engine.
//   node tools/test-flow.mjs ["path to INSTAMART & BLINKIT FMS.xlsx"]
import { existsSync } from "node:fs";
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { intakeEntry, runSetup, runTick } from "../src/server/domain/system.ts";
import { login } from "../src/server/domain/auth.ts";
import { ensureFlow, loadTemplate, readWorkbook } from "./flow-xlsx.mjs";

const XLSX = process.argv[2] || "C:/Users/DELL/Downloads/INSTAMART & BLINKIT FMS.xlsx";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "test-sheet", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };
const section = (s) => console.log("\n" + s);
const call = (actor, action, data = {}, opts) => runAction(db, actor, action, data, opts);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const nowDT = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

section("first-time setup");
let st = await runSetup(db, { name: "Owner", mobile: "9999999999", email: "owner@example.com", pin: "1234", demo: true });
ok(!!st.userId, "setup creates the super admin");
try { await runSetup(db, { name: "X", mobile: "9999999998", pin: "1234" }); ok(false, "second setup refused"); } catch (e) { ok(e.code === "FORBIDDEN", "setup cannot be run twice"); }
const boot = await call(st.userId, "getFlowData");
ok(boot.ok && boot.data.users.length === 4, "demo users created");
const id = (name) => boot.data.users.find((u) => u.name.startsWith(name)).userId;
const OWNER = st.userId, PRIYA = id("Priya"), KUNAL = id("Kunal"), NIDHI = id("Nidhi");
ok(boot.data.settings.TIMEZONE === "Asia/Kolkata", "default settings written");

section("login");
let u = await login(db, "9000000011", "3333");
ok(u.name === "Kunal" && u.role === "STAFF", "staff signs in with mobile + PIN");
for (let i = 0; i < 5; i++) await login(db, "9000000011", "0000").catch(() => {});
try { await login(db, "9000000011", "3333"); ok(false, "locked after 5 wrong PINs"); } catch (e) { ok(e.code === "LOCKED", "locked after 5 wrong PINs"); }
try { await login(db, "nobody@x.com", "1234"); ok(false, "unknown user"); } catch (e) { ok(e.code === "AUTH", "unknown user gets a generic error"); }
const { Users } = await db.load(["Users"], { fresh: true });
const kRow = Users.find((x) => x.userId === KUNAL);
ok(!JSON.stringify((await call(OWNER, "getFlowData")).data).includes("pinHash"), "no PIN hash is ever sent to the browser");

section("permissions + team");
let r = await call(KUNAL, "createFlow", { name: "x" });
ok(!r.ok && r.code === "FORBIDDEN", "staff cannot create an FMS");
r = await call(KUNAL, "saveUser", { name: "X", role: "STAFF", mobile: "9000000099", pin: "1234" });
ok(!r.ok && r.code === "FORBIDDEN", "staff cannot manage the team");
r = await call(PRIYA, "saveUser", { name: "Ravi", role: "STAFF", mobile: "9000000055", pin: "4444" });
ok(r.ok && r.data.role === "STAFF" && !("pinHash" in r.data), "an admin can add a staff member");
const RAVI = r.data?.userId;
r = await call(PRIYA, "saveUser", { name: "Boss 2", role: "ADMIN", mobile: "9000000056", pin: "4444" });
ok(!r.ok && r.code === "FORBIDDEN", "an admin cannot create another admin");
r = await call(OWNER, "saveUser", { userId: OWNER, name: "Owner", role: "STAFF", mobile: "9999999999" });
ok(!r.ok && /at least one active Super Admin/.test(r.error), "the last super admin cannot be demoted");
r = await call(OWNER, "saveUser", { name: "Dup", role: "STAFF", mobile: "9000000055", pin: "4444" });
ok(!r.ok && /already uses this mobile/.test(r.error), "duplicate mobile rejected");
r = await call("USR-NOPE", "getFlowData");
ok(!r.ok && r.code === "UNAUTHORIZED", "unknown actor rejected");
r = await call(OWNER, "nonsense");
ok(!r.ok && r.code === "BAD_ACTION", "unknown action rejected");

section("flow from template");
const tpl = loadTemplate();
const flow = await ensureFlow(db, OWNER, tpl);
const steps = JSON.parse(flow.stepsJson);
ok(steps.length === 6 && steps[0].assigneeId === KUNAL && steps[3].assigneeId === NIDHI, "steps resolved to Kunal / Nidhi");
ok(flow.intakeToken.length >= 20, "an intake token is generated");
r = await call(OWNER, "createFlow", { ...tpl, steps });
ok(!r.ok && /already called/.test(r.error), "duplicate FMS name rejected");

if (existsSync(XLSX)) {
  section("import the real workbook and compare with the sheet's own planned times");
  const { rows, holidays } = await readWorkbook(XLSX);
  r = await call(OWNER, "addHolidays", { dates: holidays, label: "wb" });
  ok(r.ok && r.data.added === holidays.length, `holidays imported (${holidays.length})`);
  let added = 0; const t0 = Date.now();
  for (let i = 0; i < rows.length; i += 150) {
    const res = await call(OWNER, "importEntries", { flowId: flow.flowId, rows: rows.slice(i, i + 150).map(({ sheetRow, cached, ...x }) => x) });
    if (!res.ok) { console.log("import error", res.error); break; }
    added += res.data.added;
  }
  ok(added === rows.length, `all ${rows.length} POs imported (got ${added}) in ${Date.now() - t0} ms`);
  const fd = await call(OWNER, "getFlowData", { flowId: flow.flowId, all: "1" });
  const items = fd.data.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.itemId.localeCompare(b.itemId));
  const byRow = new Map(rows.map((x) => [x.data.po + "|" + x.createdAt, x]));
  const tasksBy = {};
  fd.data.tasks.forEach((t) => ((tasksBy[t.itemId] ||= {})[t.stepId] = t));
  const cmp = { s2: [0, 0], s3: [0, 0], s4: [0, 0], s5: [0, 0], s6: [0, 0] };
  const bad = [];
  for (const it of items) {
    const data = JSON.parse(it.dataJson);
    const row = byRow.get(data.po + "|" + it.createdAt) || rows.find((x) => x.data.po === data.po);
    for (const s of Object.keys(cmp)) {
      const want = row.cached[s];
      if (!want) continue;
      if (s === "s2" && row.sheetRow < 246) continue; // older rows used an appointment-based formula; later rows (and ours) use the dispatch date
      const got = tasksBy[it.itemId][s].planned;
      const same = s === "s4" ? got.slice(0, 10) === want.slice(0, 10) : got === want; // step 4: the sheet ignores its own "11 AM" note
      cmp[s][same ? 0 : 1]++;
      if (!same && bad.length < 6) bad.push(`row ${row.sheetRow} ${s}: sheet ${want} vs ours ${got} (anchor ${it.anchorDate})`);
    }
  }
  console.log("   match / mismatch per step:", JSON.stringify(cmp));
  bad.forEach((b) => console.log("     ", b));
  const mism = Object.values(cmp).reduce((a, [, m]) => a + m, 0), total = Object.values(cmp).reduce((a, [g, m]) => a + g + m, 0);
  ok(mism / total < 0.01, `planned times match the sheet for ≥99% of ${total} comparisons (mismatches: ${mism})`);
  ok(items.filter((i) => i.status === "Completed").length > 600, "most historic POs are Completed");
  ok(items.filter((i) => i.postponeCount > 0).length === rows.filter((x) => x.postponeCount).length, "postponed entries preserved");
} else console.log("(workbook not found — skipping the import comparison)");

section("new entry, completion, gating");
const appt = `${addDays(today, 6)} 15:00`;
const base = { location: "Test Hub", po: "PO-TEST-1", boxes: 10, dispatchDate: `${today} 09:00`, appointmentDate: appt, mode: "Blinkit" };
r = await call(KUNAL, "createEntry", { flowId: flow.flowId, data: { ...base, appointmentDate: "" } });
ok(!r.ok && /Appointment date/.test(r.error), "required fields are enforced");
r = await call(KUNAL, "createEntry", { flowId: flow.flowId, data: { ...base, boxes: "many" } });
ok(!r.ok && /number/.test(r.error), "numbers are validated");
r = await call(KUNAL, "createEntry", { flowId: flow.flowId, data: base, priority: "Urgent", tags: "vip, cold-chain, VIP" });
ok(r.ok && r.data.priority === "Urgent" && r.data.tags === "vip,cold-chain,VIP", "entry created with priority and tags: " + r.error);
const itemId = r.data?.itemId;
ok(r.changes.Flow_Items.length === 1 && r.changes.Flow_Tasks.length === 6, "the response carries the new rows (no refetch needed)");
let tasks = r.changes.Flow_Tasks.sort((a, b) => a.seq - b.seq);
ok(tasks[0].status === "Done" && tasks[0].doneBy === KUNAL, "step 1 auto-done at entry");
ok(tasks[3].planned.endsWith("11:00") && tasks[3].planned.startsWith(appt.slice(0, 10)), "step 4 planned at 11:00 on the appointment day: " + tasks[3].planned);
ok(tasks[2].planned < tasks[3].planned && tasks[3].planned < tasks[4].planned && tasks[4].planned < tasks[5].planned, "planned times are in order");
ok(tasks.every((t) => !t.planned || t.origPlanned === t.planned), "the first plan is remembered");
r = await call(KUNAL, "completeTask", { taskId: tasks[1].taskId, actual: `${addDays(today, 1)} 10:00` });
ok(!r.ok && /future/.test(r.error), "completion time cannot be in the future");
r = await call(NIDHI, "completeTask", { taskId: tasks[1].taskId });
ok(!r.ok && r.code === "FORBIDDEN", "someone else's step cannot be completed");
r = await call(KUNAL, "completeTask", { taskId: tasks[1].taskId, remarks: "Confirmed by Aakash" });
ok(r.ok && r.data.status === "Done" && r.data.doneBy === KUNAL && r.data.remarks === "Confirmed by Aakash", "assignee completes a step: " + r.error);
r = await call(KUNAL, "completeTask", { taskId: tasks[1].taskId });
ok(!r.ok && /already done/.test(r.error), "cannot complete twice");
r = await call(KUNAL, "reopenTask", { taskId: tasks[1].taskId });
ok(!r.ok && r.code === "FORBIDDEN", "only an admin can undo a step");
r = await call(PRIYA, "reopenTask", { taskId: tasks[1].taskId });
ok(r.ok && r.data.status === "Pending" && !r.data.actual, "admin reopens a step");

section("postponement");
const before = tasks.map((t) => t.planned);
r = await call(KUNAL, "postponeEntry", { itemId, days: 3 });
ok(!r.ok && /reason/.test(r.error), "reason is required");
r = await call(KUNAL, "postponeEntry", { itemId, days: 3, reason: "Hub closed" });
ok(r.ok && r.data.postponeCount === 1 && r.data.originalAnchor === appt, "postponed, original appointment kept: " + r.error);
const after = Object.fromEntries(r.changes.Flow_Tasks.map((t) => [t.stepId, t.planned]));
ok(after.s3 > before[2] && after.s6 > before[5], "later planned times moved");
ok(!after.s2 || after.s2 === before[1], "step 2 is based on the dispatch date, so it did not move");
ok(new Date(r.data.anchorDate.slice(0, 10) + "T00:00:00Z").getUTCDay() !== 0, "postponed date never lands on the weekly off day");
ok(r.changes.Notifications?.some((n) => n.type === "postponed"), "people with pending steps are notified");

section("absence → backup gets the task");
const fd2 = await call(PRIYA, "getFlowData", { flowId: flow.flowId });
tasks = fd2.data.tasks.filter((t) => t.itemId === itemId).sort((a, b) => a.seq - b.seq);
const t3 = tasks[2];
const absTo = t3.planned.slice(0, 10);
r = await call(KUNAL, "createAbsence", { fromDate: today, toDate: absTo, backupUserId: KUNAL });
ok(!r.ok && /different person/.test(r.error), "backup must be someone else");
r = await call(NIDHI, "createAbsence", { userId: KUNAL, fromDate: today, toDate: absTo, backupUserId: PRIYA });
ok(r.ok && r.data.userId === NIDHI, "a non-admin can only mark their own absence (userId forced to self)");
await call(NIDHI, "deleteAbsence", { absenceId: r.data.absenceId });
r = await call(KUNAL, "createAbsence", { fromDate: today, toDate: absTo, backupUserId: NIDHI, reason: "Leave" });
ok(r.ok && r.changes.Notifications?.some((n) => n.userId === NIDHI && n.type === "cover"), "staff marks own absence; the backup is told");
const absId = r.data?.absenceId;
r = await call(NIDHI, "completeTask", { taskId: t3.taskId });
ok(r.ok && r.data.doneBy === NIDHI, "backup completes Kunal's step while he is away: " + r.error);
r = await call(NIDHI, "deleteAbsence", { absenceId: absId });
ok(!r.ok && r.code === "FORBIDDEN", "cannot remove another person's absence");
r = await call(KUNAL, "deleteAbsence", { absenceId: absId });
ok(r.ok && r.removed.Absences?.includes(absId), "owner removes own absence (soft delete, reported as removed)");
r = await call(NIDHI, "completeTask", { taskId: tasks[4].taskId });
ok(!r.ok && r.code === "FORBIDDEN", "after the absence is removed, the backup loses access");

section("holidays, edits, cancel, flow editing");
const planned6 = tasks[5].planned.slice(0, 10);
r = await call(OWNER, "addHolidays", { dates: [planned6], label: "Test holiday", flowId: flow.flowId });
ok(r.ok && r.data.replanned >= 1, "adding a holiday re-plans pending steps");
const fd3 = await call(PRIYA, "getFlowData", { flowId: flow.flowId });
ok(fd3.data.tasks.find((t) => t.taskId === tasks[5].taskId).planned.slice(0, 10) > planned6, "pending step moved past the holiday");
r = await call(OWNER, "addHolidays", { dates: ["2026-13-45"] });
ok(!r.ok, "invalid holiday date rejected");
r = await call(KUNAL, "updateEntry", { itemId, data: { boxes: 12 }, tags: "vip" });
ok(r.ok && JSON.parse(r.data.dataJson).boxes === 12 && r.data.tags === "vip", "entry fields can be edited");
r = await call(KUNAL, "cancelEntry", { itemId });
ok(!r.ok && r.code === "FORBIDDEN", "only admin cancels");
r = await call(PRIYA, "cancelEntry", { itemId, reason: "Duplicate PO" });
ok(r.ok && r.data.status === "Cancelled", "admin cancels an entry");
r = await call(KUNAL, "completeTask", { taskId: tasks[4].taskId });
ok(!r.ok && /cancelled/.test(r.error), "cancelled entries cannot be worked on");

console.log(`\n${pass} passed, ${fail} failed`);
fake.close();
process.exit(fail ? 1 : 0);
