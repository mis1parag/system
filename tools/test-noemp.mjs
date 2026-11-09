// "Super Admin only" accounts (Kunal Goyal, Akhil): full Super Admin power, but NOT employees —
// no attendance, no leave, no tasks, not in team lists, rankings, reports or salary.
//   node --no-warnings tools/test-noemp.mjs
import { readFileSync } from "node:fs";
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup, runTick } from "../src/server/domain/system.ts";
import { isEmployee } from "../src/lib/people.ts";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "ne", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
const denied = (r) => !r.ok && r.code === "FORBIDDEN";
const section = (s) => console.log("\n" + s);
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const D = "2026-10-07"; // a Wednesday
const call = (actor, action, data = {}, when) => runAction(db, actor, action, data, { now: at(...[].concat(when ?? [D])) });

const owner = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: false })).userId;
const mk = async (name, role, mobile, extra = {}) => { const r = await call(owner, "saveUser", { name, role, mobile, department: "Sales", pin: "4444", empCode: name.slice(0, 3).toUpperCase() + "1", email: name.toLowerCase().replace(/\W/g, "") + "@co.in", ...extra }); if (!r.ok) throw new Error(name + ": " + r.error); return r.data.userId; };
const KUNAL = await mk("Kunal Goyal", "SUPER_ADMIN", "9000000001");
const AKHIL = await mk("Akhil Goyal", "SUPER_ADMIN", "9000000002");
const ASHA = await mk("Asha", "STAFF", "9000000003");
const ROHAN = await mk("Rohan", "STAFF", "9000000004");
const MEERA = await mk("Meera", "MANAGER", "9000000005");
const bundle = async (actor) => (await call(actor, "getFlowData", {})).data;

section("who may mark an account Super Admin only");
ok(denied(await call(ASHA, "setSuperAdminOnly", { userId: KUNAL, on: true })) && denied(await call(MEERA, "setSuperAdminOnly", { userId: KUNAL, on: true })), "an employee or a manager cannot");
ok(!(await call(owner, "setSuperAdminOnly", { userId: ASHA, on: true })).ok, "only a Super Admin account can be marked (not an employee account)");
ok((await call(owner, "setSuperAdminOnly", { userId: KUNAL, on: true })).ok && (await call(owner, "setSuperAdminOnly", { userId: AKHIL, on: true })).ok, "the Super Admin marks Kunal Goyal and Akhil");
const ub = await bundle(ASHA);
ok(ub.users.find((u) => u.userId === KUNAL).notEmployee === "Y" && ub.users.find((u) => u.userId === AKHIL).notEmployee === "Y" && ub.users.find((u) => u.userId === ROHAN).notEmployee === "", "every screen is told who is not an employee");
ok((await bundle(KUNAL)).me.notEmployee === "Y" && (await bundle(owner)).me.notEmployee === "", "…and each person is told about themselves");
ok(isEmployee({ role: "STAFF", notEmployee: "Y" }) === true && isEmployee({ role: "SUPER_ADMIN", notEmployee: "Y" }) === false && isEmployee({ role: "SUPER_ADMIN" }) === true, "the mark counts only on a Super Admin; an ordinary Super Admin stays an employee");
ok((await call(KUNAL, "saveSettings", { settings: { PAY_PRORATE: "N" } })).ok && (await call(AKHIL, "saveAnnouncement", { title: "Hello", audience: "all" })).ok, "they keep their Super Admin powers (settings, notices)");

section("no attendance, no leave");
ok(!(await call(KUNAL, "checkIn", {}, [D, "09:00"])).ok && !(await call(AKHIL, "checkIn", {}, [D, "09:00"])).ok, "they cannot check in");
ok(!(await call(KUNAL, "checkOut", {}, [D, "18:00"])).ok && !(await call(KUNAL, "closeMyPunch", { attId: "ATT-X", time: "18:00" })).ok, "…or check out");
ok(!(await call(owner, "kioskPunch", { empCode: "KUN1" }, [D, "09:00"])).ok, "the kiosk does not punch them in");
ok(!(await call(owner, "markAttendance", { userId: KUNAL, date: D, checkIn: "09:00", checkOut: "18:00" })).ok, "nobody can mark attendance for them by hand");
const imp = await call(owner, "importAttendance", { rows: [{ userId: KUNAL, checkIn: "2026-10-05 09:00", checkOut: "2026-10-05 18:00" }, { userId: ASHA, checkIn: "2026-10-05 09:00", checkOut: "2026-10-05 18:00" }] });
ok(imp.ok && imp.data.added === 1, "an import skips them and takes the employee's row");
ok(!(await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-10-12", reason: "x" })).ok, "they cannot apply for leave");
ok((await call(ASHA, "checkIn", {}, [D, "09:05"])).ok, "an employee still checks in");

section("no tasks");
ok(!(await call(owner, "saveChecklistTask", { title: "T", doerId: KUNAL, freq: "D", startDate: D })).ok, "no checklist task can be given to them");
ok(!(await call(owner, "saveChecklistTask", { title: "T", doerId: ASHA, backupId: AKHIL, freq: "D", startDate: D })).ok, "…nor made their buddy duty");
const tpl = JSON.parse(readFileSync("src/lib/templates/order-to-delivery.json", "utf8"));
const steps = tpl.steps.map((s) => ({ ...s, assigneeId: ASHA }));
ok(!(await call(owner, "createFlow", { ...tpl, name: "Bad flow", steps: steps.map((s, i) => (i === 0 ? { ...s, assigneeId: KUNAL } : s)) })).ok, "an FMS step cannot be assigned to them");
const flow = await call(owner, "createFlow", { ...tpl, steps });
ok(flow.ok, "an FMS with employees is fine");
const e1 = await call(owner, "createEntry", { flowId: flow.data.flowId, data: { orderNo: "O-1", customer: "A", city: "X", value: 100, promise: "2026-10-12 18:00" } }, D);
ok(e1.ok, "(fixture) an entry");
ok(!(await call(owner, "createEntry", { flowId: flow.data.flowId, data: { orderNo: "O-2", customer: "B", city: "X", value: 100, promise: "2026-10-12 18:00" }, assignees: { s1: AKHIL } }, D)).ok, "an entry cannot hand a step to them");
const tasks = (await call(owner, "getFlowData", {}, D)).data.tasks.filter((t) => t.itemId === e1.data.itemId);
ok(!(await call(owner, "reassignTask", { taskId: tasks[0].taskId, assigneeId: KUNAL }, D)).ok, "a step cannot be handed over to them");
ok((await call(owner, "saveChecklistTask", { title: "Real", doerId: ASHA, freq: "D", startDate: D }, D)).ok, "an employee still gets tasks");
const cl = (await bundle(ASHA)).checklistLog.find((l) => l.doerId === ASHA && l.status === "Pending");
ok(!(await call(owner, "moveWork", { kind: "checklist", ids: [cl.clId], toUserId: KUNAL })).ok, "…and work cannot be moved to them");

section("not in rankings, reports, salary or reminders");
const lb = (await call(ASHA, "getLeaderboard", { month: "2026-10" })).data.board;
ok(lb.every((r) => r.userId !== KUNAL && r.userId !== AKHIL) && lb.some((r) => r.userId === ASHA), "the leaderboard has the employees only");
ok(!(await call(owner, "saveStructure", { userId: KUNAL, earnings: [{ label: "Basic", amount: 1000 }] })).ok, "no salary can be set for them");
await call(owner, "saveStructure", { userId: ASHA, earnings: [{ label: "Basic", amount: 30000 }] });
const pv = (await call(owner, "payrollPreview", { period: "2026-10" }, [D])).data.rows;
ok(pv.every((r) => r.userId !== KUNAL && r.userId !== AKHIL) && pv.some((r) => r.userId === ASHA), "the payroll preview has the employees only");
await runTick(db, undefined, at(D, "10:45"));
const notes = (await db.load(["Notifications"], { fresh: true })).Notifications;
ok(notes.some((n) => n.userId === ROHAN && n.type === "checkin-reminder"), "(fixture) the reminder does go to an employee who has not checked in");
ok(!notes.some((n) => (n.userId === KUNAL || n.userId === AKHIL) && /checkin-reminder|checkout-reminder/.test(String(n.type))), "the check-in reminder never goes to them");

section("changing the mark");
ok((await call(owner, "saveUser", { userId: KUNAL, name: "Kunal Goyal", role: "ADMIN", mobile: "9000000001", department: "Sales", empCode: "KUN1" })).ok && (await bundle(owner)).users.find((u) => u.userId === KUNAL).notEmployee === "", "if they stop being a Super Admin the mark goes with it");
ok((await call(owner, "saveUser", { userId: KUNAL, name: "Kunal Goyal", role: "SUPER_ADMIN", mobile: "9000000001", department: "Sales", empCode: "KUN1" })).ok && (await bundle(owner)).users.find((u) => u.userId === KUNAL).notEmployee === "", "…and does not come back by itself");
ok((await call(owner, "setSuperAdminOnly", { userId: AKHIL, on: false })).ok && (await call(AKHIL, "checkIn", {}, [D, "09:10"])).ok, "taking the mark off makes the person an employee again");

console.log(`\n${pass} passed, ${failed} failed`);
fake.close();
process.exitCode = failed ? 1 : 0;
