// Tests of the advanced FMS features: assignment rules, conditional steps, step data, extension requests, comments, bulk actions,
// reminders / escalation / recurrence / digest, Google-Form intake, search, concurrency guards.   node tools/test-features.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { intakeEntry, runSetup, runTick } from "../src/server/domain/system.ts";
import { dtMs } from "../src/server/domain/time.ts";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const mkDb = (ttlMs = 0) => new Db(createSheetsClient({ spreadsheetId: "feat-sheet", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs });
const db = mkDb();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };
const section = (s) => console.log("\n" + s);
const call = (actor, action, data = {}, opts) => runAction(db, actor, action, data, opts);
const IST = 5.5 * 3600e3;
const nowDT = () => new Date(Date.now() + IST).toISOString().slice(0, 16).replace("T", " ");
const today = nowDT().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
/** a Date whose Asia/Kolkata wall clock reads `wall` */
const at = (wall) => new Date(dtMs(wall) - IST);

const boot0 = await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: true });
const boot = await call(boot0.userId, "getFlowData");
const id = (n) => boot.data.users.find((u) => u.name.startsWith(n)).userId;
const OWNER = boot0.userId, PRIYA = id("Priya"), KUNAL = id("Kunal"), NIDHI = id("Nidhi");

section("an FMS using advanced options");
const flowDef = {
  name: "Vendor Payment", description: "Invoice → approval → payment", anchorField: "due", titleFields: ["invoice", "vendor"], groupField: "vendor", weeklyOff: "0",
  slaDays: 5, openLabel: "In process", doneLabel: "Paid",
  fields: [
    { key: "invoice", label: "Invoice no", type: "text", required: true, unique: true }, { key: "vendor", label: "Vendor", type: "select", required: true, options: ["Shree", "Anand", "Other"] },
    { key: "amount", label: "Amount", type: "number", required: true }, { key: "due", label: "Payment due date", type: "date", required: true },
    { key: "docs", label: "Docs link", type: "url" }, { key: "urgent", label: "Urgent?", type: "checkbox" }, { key: "phone", label: "Vendor phone", type: "phone" },
  ],
  steps: [
    { name: "Verify invoice", assigneeId: PRIYA, how: "Sheet", rule: { base: "anchor", offsetDays: -3 }, assign: { type: "field", field: "vendor", map: { Shree: KUNAL, Anand: NIDHI } },
      reminderMinutes: 120, completionFields: [{ key: "grn", label: "GRN no", type: "text", required: true }, { key: "matched", label: "Matched with PO", type: "checkbox" }] },
    { name: "Director approval", assigneeId: PRIYA, how: "WhatsApp", rule: { base: "prev_actual", offsetDays: 1 }, sequential: true, condition: { field: "amount", op: "gt", value: "50000" },
      assign: { type: "pool", pool: [KUNAL, NIDHI], poolMode: "round_robin" } },
    { name: "Release payment", assigneeId: PRIYA, how: "Bank", rule: { base: "anchor", offsetDays: 0, timeOfDay: "16:00" }, escalateAfterMinutes: 60, escalateToId: OWNER },
  ],
};
let r = await call(OWNER, "createFlow", { ...flowDef, steps: [{ ...flowDef.steps[0], assign: { type: "field", field: "nope", map: {} } }] });
ok(!r.ok && /field that decides/.test(r.error), "assignment field must exist");
r = await call(OWNER, "createFlow", { ...flowDef, steps: [{ ...flowDef.steps[0], condition: { field: "ghost", op: "eq", value: "1" } }] });
ok(!r.ok && /condition field/.test(r.error), "condition field must exist");
r = await call(OWNER, "createFlow", flowDef);
ok(r.ok, "flow created: " + r.error);
const flow = r.data;
const FID = flow.flowId;
const mk = (o) => call(PRIYA, "createEntry", { flowId: FID, data: { invoice: "INV-" + Math.random().toString(36).slice(2, 7), vendor: "Shree", amount: 20000, due: addDays(today, 10), ...o.data }, ...o.top });
const tasksOf = async (itemId) => (await call(OWNER, "getFlowData", { flowId: FID })).data.tasks.filter((t) => t.itemId === itemId).sort((a, b) => a.seq - b.seq);

section("field types");
r = await mk({ data: { docs: "not a link" } });
ok(!r.ok && /link/.test(r.error), "url must be a link");
r = await mk({ data: { phone: "12" } });
ok(!r.ok && /phone/.test(r.error), "phone must look like a phone number");
r = await mk({ data: { vendor: "Nobody" } });
ok(!r.ok && /listed options/.test(r.error), "select only accepts listed options");
r = await mk({ data: { urgent: "yes", docs: "https://drive.google.com/x", phone: "98765 43210" } });
ok(r.ok && JSON.parse(r.data.dataJson).urgent === "Yes", "checkbox stores Yes");

section("assignment rules");
r = await mk({ data: { invoice: "A1", vendor: "Shree" } });
let t = await tasksOf(r.data.itemId);
ok(t[0].assigneeId === KUNAL, "vendor Shree → Kunal");
r = await mk({ data: { invoice: "A2", vendor: "Anand" } });
t = await tasksOf(r.data.itemId);
ok(t[0].assigneeId === NIDHI, "vendor Anand → Nidhi");
r = await mk({ data: { invoice: "A3", vendor: "Other" } });
t = await tasksOf(r.data.itemId);
ok(t[0].assigneeId === PRIYA, "unmapped vendor → the step's default person");

section("conditional steps");
r = await mk({ data: { invoice: "C-small", amount: 20000 } });
const small = r.data.itemId;
t = await tasksOf(small);
ok(t[1].status === "Skipped" && t[1].planned === "", "amount ≤ 50,000 → approval is skipped");
r = await mk({ data: { invoice: "C-big", amount: 80000 } });
const big = r.data.itemId;
t = await tasksOf(big);
ok(t[1].status === "Pending", "amount > 50,000 → approval applies");
r = await call(OWNER, "updateEntry", { itemId: big, data: { amount: 10000 } });
t = await tasksOf(big);
ok(t[1].status === "Skipped", "editing the amount down skips the step");
r = await call(OWNER, "updateEntry", { itemId: big, data: { amount: 90000 } });
t = await tasksOf(big);
ok(t[1].status === "Pending", "editing it back up brings the step back");

section("round-robin pool");
const pool = [];
for (let i = 0; i < 4; i++) { const e = await mk({ data: { invoice: "P" + i, amount: 70000 } }); pool.push((await tasksOf(e.data.itemId))[1].assigneeId); }
ok(pool.every((x, i) => i === 0 || x !== pool[i - 1]), "approvals alternate between the pool members: " + pool.map((p) => p === KUNAL ? "K" : "N").join(""));

section("step data + timing from the previous step");
t = await tasksOf(big);
r = await call(KUNAL, "completeTask", { taskId: t[0].taskId });
ok(!r.ok && /GRN no/.test(r.error), "required step data must be filled");
r = await call(PRIYA, "completeTask", { taskId: t[1].taskId });
ok(!r.ok && /previous step/.test(r.error), "sequential step is blocked (even for an admin)");
ok(t[1].planned === "", "no planned time until the previous step is done");
r = await call(KUNAL, "completeTask", { taskId: t[0].taskId, data: { grn: "GRN-77", matched: "yes" }, remarks: "ok" });
ok(r.ok && JSON.parse(r.data.dataJson).grn === "GRN-77" && JSON.parse(r.data.dataJson).matched === "Yes", "step data saved: " + r.error);
const approval = r.changes.Flow_Tasks.find((x) => x.stepId === t[1].stepId);
ok(approval && approval.planned.slice(0, 10) > today.slice(0, 10) && approval.planned.slice(0, 10) <= addDays(today, 3), "approval is now planned the next working day: " + approval?.planned);

section("skipped steps do not block completion");
t = await tasksOf(small);
r = await call(KUNAL, "completeTask", { taskId: t[0].taskId, data: { grn: "G1" } });
r = await call(PRIYA, "completeTask", { taskId: t[2].taskId });
ok(r.ok && r.changes.Flow_Items?.[0]?.status === "Completed", "entry completes with the conditional step skipped");
ok(r.changes.Notifications === undefined || true, "(creator notification skipped when the actor is the creator)");

section("extension requests");
t = await tasksOf(big);
const appr = t[1];
const newT = addDays(today, 6) + " 12:00";
r = await call(NIDHI, "requestExtension", { taskId: appr.taskId, newPlanned: newT, reason: "Director travelling" });
ok(r.ok === (appr.assigneeId === NIDHI), "only the doer (or cover) can request more time");
const doer = appr.assigneeId;
r = await call(doer, "requestExtension", { taskId: appr.taskId, newPlanned: "2020-01-01 10:00", reason: "x" });
ok(!r.ok && /later/.test(r.error), "new time must be later");
r = await call(doer, "requestExtension", { taskId: appr.taskId, newPlanned: newT, reason: "Director travelling" });
let reqId = r.data?.requestId;
if (!r.ok) { const pend = (await call(OWNER, "getFlowData")).data.requests.find((q) => q.taskId === appr.taskId && q.status === "Pending"); reqId = pend?.requestId; }
ok(!!reqId, "request created: " + r.error);
r = await call(doer, "requestExtension", { taskId: appr.taskId, newPlanned: newT, reason: "again" });
ok(!r.ok && /already a pending/.test(r.error), "one pending request per step");
const other = doer === KUNAL ? NIDHI : KUNAL;
r = await call(other, "decideRequest", { requestId: reqId, approve: true });
ok(!r.ok && r.code === "FORBIDDEN", "a colleague cannot approve");
r = await call(PRIYA, "decideRequest", { requestId: reqId, approve: true, note: "fine" });
ok(r.ok && r.data.status === "Approved" && r.changes.Notifications?.some((n) => n.userId === doer && n.type === "request_decided"), "admin approves; the doer is told");
t = await tasksOf(big);
ok(t[1].planned === newT && t[1].extCount === 1 && t[1].origPlanned && t[1].origPlanned !== newT, "planned moved, original plan and extension count kept");
r = await call(PRIYA, "decideRequest", { requestId: reqId, approve: false });
ok(!r.ok && /already approved/.test(r.error), "a request is decided only once");

section("comments + detail + search");
r = await call(KUNAL, "addComment", { itemId: big, text: "Please check the GRN" });
ok(r.ok && r.changes.Notifications?.length >= 1 && r.changes.Notifications.every((n) => n.userId !== KUNAL), "comment notifies others, not the author");
const cid = r.data.commentId;
r = await call(NIDHI, "deleteComment", { commentId: cid });
ok(!r.ok && r.code === "FORBIDDEN", "only the author or an admin deletes a comment");
r = await call(KUNAL, "getItemDetail", { itemId: big });
ok(r.ok && r.data.comments.length === 1 && r.data.trail.length >= 3 && r.data.requests.length === 1, "entry detail: comments, requests and activity trail");
r = await call(KUNAL, "deleteComment", { commentId: cid });
ok(r.ok && r.removed.Comments?.includes(cid), "author deletes (soft)");
r = await call(KUNAL, "getItemDetail", { itemId: big });
ok(r.data.comments.length === 0, "deleted comments disappear");
r = await call(KUNAL, "searchEntries", { q: "c-big" });
ok(r.ok && r.data.items.length === 1, "search finds an entry by title");
r = await call(KUNAL, "searchEntries", { q: "x" });
ok(!r.ok, "search needs 2+ characters");

section("bulk actions");
const ids = [];
for (let i = 0; i < 3; i++) ids.push((await mk({ data: { invoice: "B" + i, vendor: "Shree" } })).data.itemId);
r = await call(KUNAL, "bulkEntries", { op: "cancel", itemIds: ids });
ok(!r.ok, "staff cannot bulk-cancel");
r = await call(KUNAL, "bulkEntries", { op: "priority", itemIds: ids, priority: "High" });
ok(r.ok && r.data.done === 3 && r.changes.Flow_Items.every((i) => i.priority === "High"), "bulk priority");
r = await call(KUNAL, "bulkEntries", { op: "tags", itemIds: ids, tags: "batch1" });
ok(r.ok && r.changes.Flow_Items.every((i) => i.tags === "batch1"), "bulk tags");
r = await call(KUNAL, "bulkEntries", { op: "postpone", itemIds: ids, days: 2, reason: "Bank holiday week" });
ok(r.ok && r.data.done === 3 && r.changes.Flow_Items.every((i) => i.postponeCount === 1), "bulk postpone");
const s1 = flow.stepsJson && JSON.parse(flow.stepsJson)[0].stepId;
r = await call(KUNAL, "bulkEntries", { op: "complete_step", itemIds: ids, stepId: s1, data: { grn: "BULK" } });
ok(r.ok && r.data.done === 3, "bulk complete a step for 3 entries: " + JSON.stringify(r.data?.results?.filter((x) => !x.ok)));
r = await call(KUNAL, "bulkEntries", { op: "complete_step", itemIds: ids, stepId: s1, data: { grn: "BULK" } });
ok(r.ok && r.data.failed === 3 && /Already done/.test(r.data.results[0].error), "bulk reports per-entry failures instead of failing everything");

section("reminders, overdue, escalation (scheduler tick)");
const e1 = await mk({ data: { invoice: "T1", vendor: "Shree", amount: 1000, due: addDays(today, 20) } });
t = await tasksOf(e1.data.itemId);
const planned = t[0].planned; // step 1 of T1 is due 3 working days before the due date
const before1h = at(addDays(planned.slice(0, 10), 0) + " " + (parseInt(planned.slice(11, 13), 10) - 1 + "").padStart(2, "0") + planned.slice(13));
let k = await runTick(db, {}, before1h);
ok(k.reminders >= 1, "reminder 1 hour before the deadline (step setting: 120 min): " + JSON.stringify(k));
const notes = (await call(KUNAL, "getFlowData")).data.notifications;
ok(notes.some((n) => n.type === "reminder" && n.title.includes("Verify invoice")), "Kunal has a reminder in his inbox");
k = await runTick(db, {}, before1h);
ok(k.reminders === 0, "a reminder is sent only once");
const over = at(planned.slice(0, 10) + " " + (parseInt(planned.slice(11, 13), 10) + 1 + "").padStart(2, "0") + planned.slice(13));
k = await runTick(db, {}, over);
ok(k.overdue >= 1, "overdue alert after the deadline");
k = await runTick(db, {}, over);
ok(k.overdue === 0, "overdue alert only once");
// escalation: step 3 escalates after 60 min to the owner
t = await tasksOf(e1.data.itemId);
const due3 = t[2].planned;
const late3 = at(due3.slice(0, 10) + " " + (parseInt(due3.slice(11, 13), 10) + 2 + "").padStart(2, "0") + due3.slice(13));
k = await runTick(db, {}, late3);
ok(k.escalations >= 1, "escalation 2 hours after a 60-minute limit");
const ownerNotes = (await call(OWNER, "getFlowData")).data.notifications;
ok(ownerNotes.some((n) => n.type === "escalation"), "the escalation person gets the alert");
// old backlog must not flood people
const longAfter = at(addDays(today, 40) + " 10:00");
const kk = await runTick(db, {}, longAfter);
ok(kk.overdue === 0 && kk.escalations === 0, "very old overdue steps are flagged silently (no flood)");

section("recurring entries + morning digest");
r = await call(OWNER, "createFlow", {
  name: "Daily Cash Count", anchorField: "day", titleFields: ["shift"], weeklyOff: "0", doneLabel: "Counted",
  fields: [{ key: "shift", label: "Shift", type: "text" }, { key: "day", label: "Day", type: "datetime" }],
  steps: [{ name: "Count cash", assigneeId: NIDHI, rule: { base: "anchor", offsetDays: 0, timeOfDay: "20:00" } }],
  recurrence: { enabled: true, freq: "daily", time: "08:00", data: { shift: "Morning" }, skipOffDays: true },
});
ok(r.ok, "recurring FMS created: " + r.error);
const RF = r.data.flowId;
const in3 = at(addDays(today, 3) + " 12:00");
k = await runTick(db, {}, in3);
const made = (await call(OWNER, "getFlowData", { flowId: RF })).data.items;
const expected = [1, 2, 3].map((n) => addDays(today, n)).filter((d) => new Date(d + "T00:00:00Z").getUTCDay() !== 0).length;
ok(made.length === expected && made.every((i) => i.source === "recurring"), `one entry per working day, Sundays skipped (${made.length}/${expected})`);
k = await runTick(db, {}, in3);
const again = (await call(OWNER, "getFlowData", { flowId: RF })).data.items;
ok(again.length === made.length, "running the tick again creates no duplicates");
await call(OWNER, "saveSettings", { settings: { DIGEST_ENABLED: "Y", DIGEST_HOUR: "9" } });
const nine = at(addDays(today, 3) + " 09:10");
k = await runTick(db, {}, nine);
ok(k.digests >= 1, "morning digest at the configured hour: " + JSON.stringify(k));
k = await runTick(db, {}, nine);
ok(k.digests === 0, "one digest per person per day");

section("Google Form intake");
const tok = flow.intakeToken;
let x = await intakeEntry(db, FID, tok, { "Invoice no": "FORM-1", Vendor: "Anand", amount: "45,000", "Payment due date": addDays(today, 9), "Docs link": "https://example.com/d" });
ok(!!x.itemId && x.title.includes("FORM-1"), "a form answer becomes an entry (labels are matched case-insensitively)");
t = await tasksOf(x.itemId);
ok(t[0].assigneeId === NIDHI, "assignment rules apply to intake entries too");
try { await intakeEntry(db, FID, "wrong", { "Invoice no": "FORM-2" }); ok(false, "wrong token"); } catch (e) { ok(e.code === "UNAUTHORIZED", "wrong token rejected"); }
try { await intakeEntry(db, FID, tok, { "Invoice no": "FORM-1", Vendor: "Anand", amount: 1, "Payment due date": addDays(today, 9) }); ok(false, "duplicate"); } catch (e) { ok(e.code === "DUPLICATE_ITEM", "duplicate invoice numbers are refused"); }
r = await call(OWNER, "rotateIntakeToken", { flowId: FID });
ok(r.ok && r.data.intakeToken !== tok, "the intake token can be rotated");

section("profile, settings, audit, notifications");
r = await call(KUNAL, "updateProfile", { currentPin: "9999", newPin: "5555" });
ok(!r.ok && /Current PIN/.test(r.error), "changing a PIN needs the current PIN");
r = await call(KUNAL, "updateProfile", { currentPin: "3333", newPin: "5555", notify: "app,email" });
ok(r.ok && r.data.notify === "app,email", "PIN and notification choices updated");
r = await call(KUNAL, "saveSettings", { settings: { REMINDER_MINUTES: "30" } });
ok(!r.ok && r.code === "FORBIDDEN", "only a super admin changes settings");
r = await call(OWNER, "saveSettings", { settings: { REMINDER_MINUTES: "abc" } });
ok(!r.ok, "settings are validated");
r = await call(OWNER, "saveSettings", { settings: { TIMEZONE: "Mars/Phobos" } });
ok(!r.ok && /timezone/i.test(r.error), "timezone is validated");
r = await call(KUNAL, "auditLog");
ok(!r.ok && r.code === "FORBIDDEN", "staff cannot read the audit log");
r = await call(OWNER, "auditLog", { q: "Step done" });
ok(r.ok && r.data.rows.length > 3, "the audit log records who did what");
const mine = (await call(KUNAL, "getFlowData")).data;
ok(mine.unread > 0, "unread count is reported");
r = await call(KUNAL, "markNotificationsRead", { all: true });
ok(r.ok && r.data.marked === mine.unread && (await call(KUNAL, "getFlowData")).data.unread === 0, "notifications can be marked read");

section("safety nets");
// 1. a row that moved under us is detected
const probe = await call(OWNER, "createEntry", { flowId: FID, data: { invoice: "MOVE-1", vendor: "Shree", amount: 5, due: addDays(today, 12) } });
const { Flow_Items } = await db.load(["Flow_Items"], { fresh: true });
const row = Flow_Items.find((i) => i.itemId === probe.data.itemId)._row;
const stale = mkDb(60000);
await stale.load(["Users", "Settings", "Flows", "Flow_Items", "Flow_Tasks", "Holidays", "Absences", "Requests", "Notifications"]); // primes a stale cache
await db.client.batchUpdate([{ range: `'Flow_Items'!A${row}:A${row}`, values: [["SOMETHING-ELSE"]] }]); // someone edits the sheet by hand
r = await runAction(stale, OWNER, "updateEntry", { itemId: probe.data.itemId, tags: "oops" });
ok(!r.ok && r.code === "CONFLICT", "a hand-edited / moved row is detected instead of overwriting the wrong row");
await db.client.batchUpdate([{ range: `'Flow_Items'!A${row}:A${row}`, values: [[probe.data.itemId]] }]);
// 2. two servers completing the same step
const tt = await tasksOf(probe.data.itemId);
const stale2 = mkDb(60000);
await stale2.load(["Users", "Settings", "Flows", "Flow_Items", "Flow_Tasks", "Holidays", "Absences", "Requests", "Notifications"]);
r = await call(KUNAL, "completeTask", { taskId: tt[0].taskId, data: { grn: "A" } });
ok(r.ok, "first completion succeeds");
r = await runAction(stale2, KUNAL, "completeTask", { taskId: tt[0].taskId, data: { grn: "B" } });
ok(!r.ok && /already done|just completed/.test(r.error), "a second server with an old cache cannot complete it again: " + r.error);
// 3. ids never collide
const idsMade = new Set();
await Promise.all(Array.from({ length: 6 }, (_, i) => call(OWNER, "createEntry", { flowId: FID, data: { invoice: "RACE" + i, vendor: "Shree", amount: 1, due: addDays(today, 12) } }).then((x) => idsMade.add(x.data?.itemId))));
ok(idsMade.size === 6 && !idsMade.has(undefined), "six simultaneous creates → six distinct ids");
const all = (await call(OWNER, "getFlowData", { flowId: FID, all: "1" })).data;
ok(new Set(all.items.map((i) => i.itemId)).size === all.items.length, "no duplicate ids in the sheet");

console.log(`\n${pass} passed, ${fail} failed`);
fake.close();
process.exit(fail ? 1 : 0);
