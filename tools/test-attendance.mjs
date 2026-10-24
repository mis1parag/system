// Attendance + leave, end to end against the local fake Google Sheets.
//   node --no-warnings tools/test-attendance.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup, runTick } from "../src/server/domain/system.ts";
import { attSettings, calFrom, leaveBalance, leaveDays, personDays, personReport } from "../src/lib/attendance.ts";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "att", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };
const section = (s) => console.log("\n" + s);
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const call = (actor, action, data = {}, when) => runAction(db, actor, action, data, { now: when ? at(...[].concat(when)) : undefined });

const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: true })).userId;
const { Users } = await db.load(["Users"], { fresh: true });
const id = (n) => String(Users.find((u) => u.name === n).userId);
const PRIYA = id("Priya Coordinator"), KUNAL = id("Kunal"), NIDHI = id("Nidhi");
const MON = "2026-10-05";
for (const uid of [PRIYA, KUNAL, NIDHI]) { const u = Users.find((x) => x.userId === uid); await call(boss, "saveUser", { userId: uid, name: u.name, mobile: u.mobile, department: "Operations" }, MON); } // one department
await call(boss, "addHolidays", { dates: ["2026-10-08"], label: "Test holiday" }, MON);

section("check in / check out");
const ci = await call(KUNAL, "checkIn", { lat: 28.6979, lng: 77.1663 }, [MON, "09:20"]);
ok(ci.ok && ci.data.checkIn === `${MON} 09:20` && ci.data.lat === 28.6979, `check in: ${ci.error}`);
ok(!(await call(KUNAL, "checkIn", {}, [MON, "09:25"])).ok, "cannot check in twice while checked in");
const co = await call(KUNAL, "checkOut", { lat: 28.7, lng: 77.2 }, [MON, "18:10"]);
ok(co.ok && co.data.checkOut === `${MON} 18:10` && co.data.outLat === 28.7, `check out: ${co.error}`);
ok(!(await call(KUNAL, "checkOut", {}, [MON, "18:11"])).ok, "cannot check out when not checked in");
ok(!(await call(KUNAL, "checkIn", {}, [MON, "18:10"])).ok, "no instant re-check-in");
const bad = await call(NIDHI, "checkIn", { lat: 999, lng: "abc" }, [MON, "09:45"]);
ok(bad.ok && bad.data.lat === null && bad.data.lng === null, "impossible coordinates are ignored, the punch still works");
await call(NIDHI, "checkOut", {}, [MON, "15:00"]);

section("admin corrections");
ok(!(await call(KUNAL, "markAttendance", { userId: KUNAL, date: "2026-10-06", checkIn: "09:00", checkOut: "18:00" }, MON)).ok, "staff cannot edit attendance");
const man = await call(PRIYA, "markAttendance", { userId: KUNAL, date: "2026-10-09", checkIn: "09:50", checkOut: "17:30", note: "forgot to punch" }, [MON, "12:00"]);
ok(man.ok && man.data.source === "manual", `manual entry: ${man.error}`);
ok(!(await call(PRIYA, "markAttendance", { userId: KUNAL, date: "2026-10-09", checkIn: "18:00", checkOut: "09:00" }, MON)).ok, "check-out before check-in is refused");
const fix = await call(PRIYA, "markAttendance", { attId: man.data.attId, checkIn: "09:25", checkOut: "17:30" }, MON);
ok(fix.ok && fix.data.checkIn.endsWith("09:25"), "a punch can be corrected");
const sun = await call(PRIYA, "markAttendance", { userId: KUNAL, date: "2026-10-11", checkIn: "09:00", checkOut: "14:30" }, MON);
ok(sun.ok, "Sunday work can be added");
const tmp = await call(PRIYA, "markAttendance", { userId: NIDHI, date: "2026-10-06", checkIn: "10:00", checkOut: "18:00" }, MON);
ok((await call(PRIYA, "deleteAttendance", { attId: tmp.data.attId }, MON)).ok, "a punch can be removed");

section("the report maths (same rules as the Drive sheet)");
const bundle = (await call(PRIYA, "getFlowData", {}, "2026-10-12")).data;
const set = attSettings(bundle.settings), cal = calFrom(bundle.settings, bundle.holidays);
const now = "2026-10-12 19:00"; // Monday evening after 6:30 PM
const kd = personDays(bundle.attendance, bundle.leaves, KUNAL, "2026-10-05", "2026-10-11", now, cal, set);
const st = (d) => kd.find((x) => x.date === d).status;
ok(st("2026-10-05") === "present" && kd[0].hours === 8.83, `Mon present, 8h50 (${kd[0].hours})`);
ok(st("2026-10-06") === "absent" && st("2026-10-07") === "absent", "Tue / Wed without a punch are absent");
ok(st("2026-10-08") === "holiday" && st("2026-10-11") === "off", "holiday and Sunday are not working days");
ok(kd.find((x) => x.date === "2026-10-11").overtime, "Sunday work of 4h+ is overtime");
const kr = personReport(KUNAL, kd, set);
ok(kr.workingDays === 5 && kr.present === 2 && kr.absent === 3, `Kunal: ${kr.workingDays} working (Sat counts), ${kr.present} present, ${kr.absent} absent`);
ok(kr.attendancePct === 40 && kr.late === 0 && kr.early === 0, `attendance ${kr.attendancePct}% · late ${kr.late} · early ${kr.early}`);
ok(kr.overtime === 1, "overtime counted");
const nd = personDays(bundle.attendance, bundle.leaves, NIDHI, "2026-10-05", "2026-10-05", now, cal, set)[0];
ok(nd.status === "half" && nd.late && nd.early, `Nidhi 09:45–15:00 = half day, late and early (${nd.status})`);
const pendingToday = personDays([], [], KUNAL, "2026-10-12", "2026-10-12", "2026-10-12 11:00", cal, set)[0];
const absentLate = personDays([], [], KUNAL, "2026-10-12", "2026-10-12", "2026-10-12 19:00", cal, set)[0];
ok(pendingToday.status === "pending" && absentLate.status === "absent", "today is 'not yet' until 6:30 PM, then absent");

section("leave requests");
const lr = await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-10-06", endDate: "2026-10-07", reason: "family function", backupUserId: NIDHI }, MON);
ok(lr.ok && lr.data.days === 2 && lr.data.status === "Pending", `leave requested: ${lr.error}`);
ok(!(await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-10-07", endDate: "2026-10-09", reason: "x" }, MON)).ok, "overlapping leave is refused");
ok(!(await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-10-08", endDate: "2026-10-08", reason: "x" }, MON)).ok, "a leave on a holiday only is refused");
ok(!(await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-11-02", endDate: "2026-11-03", reason: "" }, MON)).ok, "a reason is required");
ok(!(await call(NIDHI, "decideLeave", { leaveId: lr.data.leaveId, approve: true }, MON)).ok, "a colleague cannot approve");
const appr = await call(PRIYA, "decideLeave", { leaveId: lr.data.leaveId, approve: true, note: "ok" }, MON);
ok(appr.ok && appr.data.status === "Approved", "an admin approves");
const ab = (await db.load(["Absences"], { fresh: true })).Absences.find((a) => a.userId === KUNAL && a.fromDate === "2026-10-06");
ok(ab && ab.backupUserId === NIDHI, "approval marks the absence, so the backup gets his FMS steps");
ok(!(await call(PRIYA, "decideLeave", { leaveId: lr.data.leaveId, approve: false }, MON)).ok, "cannot decide twice");
const b2 = (await call(PRIYA, "getFlowData", {}, "2026-10-12")).data;
const kd2 = personDays(b2.attendance, b2.leaves, KUNAL, "2026-10-05", "2026-10-09", now, cal, set);
ok(kd2.find((x) => x.date === "2026-10-06").status === "leave" && kd2.find((x) => x.date === "2026-10-07").status === "leave", "approved leave days are 'on leave', not absent");
const rep2 = personReport(KUNAL, kd2, set);
ok(rep2.absent === 0 && rep2.leave === 2, `absent ${rep2.absent}, leave ${rep2.leave}`);
ok(leaveDays("Short Leave", "2026-10-06", "2026-10-06", cal) === 0 && leaveDays("First Half Day", "2026-10-06", "2026-10-06", cal) === 0.5 && leaveDays("Full Day", "2026-10-05", "2026-10-12", cal) === 6, "leave day counting (short 0, half 0.5, full = working days)");
const q = await call(PRIYA, "saveUser", { userId: KUNAL, name: "Kunal", mobile: Users.find((u) => u.userId === KUNAL).mobile, email: "kunal@example.com", leaveAllot: 3, empCode: "PAR773" }, MON);
ok(q.ok, `employee id + allotment saved: ${q.error}`);
ok(!(await call(PRIYA, "saveUser", { userId: NIDHI, name: "Nidhi", mobile: Users.find((u) => u.userId === NIDHI).mobile, empCode: "par773" }, MON)).ok, "an employee id cannot be shared");
const lr2 = await call(KUNAL, "requestLeave", { type: "Full Day", startDate: "2026-10-19", endDate: "2026-10-22", reason: "trip" }, MON);
ok(lr2.ok && (lr2.warnings ?? []).some((w) => /more than the 3 leave days/.test(w)), "going over the allotted days warns but allows");
const bal = leaveBalance(3, (await call(PRIYA, "getFlowData", {}, MON)).data.leaves, KUNAL, "2026");
ok(bal.used === 2 && bal.pending === 4 && bal.left === 1, `balance: used ${bal.used}, pending ${bal.pending}, left ${bal.left}`);
ok((await call(KUNAL, "cancelLeave", { leaveId: lr2.data.leaveId }, MON)).ok, "the person can cancel a pending request");
ok(!(await call(KUNAL, "cancelLeave", { leaveId: lr.data.leaveId }, MON)).ok, "…but not an approved one");
await call(PRIYA, "saveUser", { userId: NIDHI, name: "Nidhi", mobile: Users.find((u) => u.userId === NIDHI).mobile, managerId: KUNAL }, MON);
const nl = await call(NIDHI, "requestLeave", { type: "Short Leave", startDate: "2026-10-14", reason: "doctor" }, MON);
ok(nl.ok && nl.data.days === 0, "short leave takes no days off");
ok((await call(KUNAL, "decideLeave", { leaveId: nl.data.leaveId, approve: true }, MON)).ok, "a manager can decide for their team");
const pl = await call(PRIYA, "requestLeave", { userId: PRIYA, type: "First Half Day", startDate: "2026-10-15", reason: "x" }, MON);
ok(!(await call(KUNAL, "decideLeave", { leaveId: pl.data.leaveId, approve: true }, MON)).ok, "…but not for someone outside their team");

section("import, visibility, settings");
const imp = await call(boss, "importAttendance", { rows: [
  { userId: KUNAL, checkIn: "2026-01-05 09:30", checkOut: "2026-01-05 18:00", lat: 28.6, lng: 77.1 },
  { userId: KUNAL, checkIn: "2026-01-05 09:30", checkOut: "2026-01-05 18:00" },
  { userId: "nobody", checkIn: "2026-01-06 09:30", checkOut: "2026-01-06 18:00" },
  { userId: KUNAL, checkIn: "2026-01-07 09:30", checkOut: "2026-01-07 08:00" },
] }, MON);
ok(imp.ok && imp.data.added === 1 && imp.data.skipped === 3, `import added ${imp.data?.added}, skipped ${imp.data?.skipped}`);
const sv = (await call(boss, "getFlowData", {}, "2026-10-12")).data, av = (await call(PRIYA, "getFlowData", {}, "2026-10-12")).data, kv = (await call(KUNAL, "getFlowData", {}, "2026-10-12")).data;
ok(sv.attendance.some((a) => a.date === "2026-01-05"), "the Super Admin sees all history");
ok(!av.attendance.some((a) => a.date === "2026-01-05") && av.attendance.some((a) => a.userId === NIDHI), "an Admin sees everyone, but the last 120 days");
ok(kv.attendance.every((a) => a.userId === KUNAL || a.userId === NIDHI) && kv.attendance.some((a) => a.userId === KUNAL) && kv.leaves.every((l) => l.userId === KUNAL || l.userId === NIDHI), "a User sees only their own punches (and their reports')");
ok(!(await call(boss, "saveSettings", { settings: { ATT_LATE_AFTER: "late" } }, MON)).ok && !(await call(boss, "saveSettings", { settings: { ATT_FULL_HOURS: "0" } }, MON)).ok, "attendance settings are validated");
ok((await call(boss, "saveSettings", { settings: { ATT_LATE_AFTER: "10:00", ATT_FULL_HOURS: "7" } }, MON)).ok, "…and can be changed");

section("kiosk, photos and self-punch rules");
const TUE = "2026-10-13";
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";
ok(!(await call(KUNAL, "kioskPunch", { empCode: "PAR773" }, [TUE, "09:00"])).ok, "staff cannot use the kiosk (an admin signs in on the reception PC)");
const k1 = await call(PRIYA, "kioskPunch", { empCode: "par773", photo: JPG }, [TUE, "09:05"]);
ok(k1.ok && k1.data.action === "in" && k1.data.name === "Kunal" && k1.data.time === "09:05", `kiosk checks in by employee id (any case): ${k1.error}`);
ok(k1.data.attendance.source === "kiosk" && k1.data.attendance.userId === KUNAL && k1.data.attendance.inPhoto.startsWith("PHO"), "…saved as Kunal's punch with a photo id");
const dbl = await call(PRIYA, "kioskPunch", { empCode: "PAR773" }, [TUE, "09:05"]);
ok(!dbl.ok && /just now/.test(dbl.error) && (await call(PRIYA, "getFlowData", {}, TUE)).data.attendance.filter((r) => r.userId === KUNAL && r.date === TUE).length === 1, "a double scan at the kiosk is ignored with a clear message — still one open check-in, no zero-minute day");
const ph = await call(KUNAL, "getPunchPhoto", { photoId: k1.data.attendance.inPhoto }, TUE);
ok(ph.ok && ph.data.image === JPG, "the person can see their own photo");
ok(!(await call(NIDHI, "getPunchPhoto", { photoId: k1.data.attendance.inPhoto }, TUE)).ok, "…but nobody else except an admin");
ok((await call(PRIYA, "getPunchPhoto", { photoId: k1.data.attendance.inPhoto }, TUE)).ok, "an admin can see it");
const k2 = await call(PRIYA, "kioskPunch", { empCode: "PAR773", photo: "not an image" }, [TUE, "17:40"]);
ok(k2.ok && k2.data.action === "out" && k2.data.attendance.checkOut === `${TUE} 17:40` && k2.data.attendance.outPhoto === "", "the same ID again checks out; a bad photo is ignored, the punch still works");
ok(!(await call(PRIYA, "kioskPunch", { empCode: "NOBODY1" }, [TUE, "17:41"])).ok && !(await call(PRIYA, "kioskPunch", { empCode: "" }, [TUE, "17:41"])).ok, "unknown or empty ID is refused");
const big = "data:image/jpeg;base64," + "A".repeat(46000);
const k3 = await call(PRIYA, "kioskPunch", { empCode: "PAR773", photo: big }, [TUE, "17:50"]);
ok(k3.ok && k3.data.attendance.inPhoto === "", "a photo that is too large is dropped (cell limit), not an error");
const pb = (await call(PRIYA, "getFlowData", {}, TUE)).data;
ok(!JSON.stringify(pb).includes("/9j/4AAQ"), "photo data is not part of the page data");
ok((await call(boss, "saveSettings", { settings: { ATT_SELF_PUNCH: "N" } }, TUE)).ok && !(await call(boss, "saveSettings", { settings: { ATT_PHOTO: "maybe" } }, TUE)).ok, "the self-punch setting can be changed and is validated");
const sp = await call(NIDHI, "checkIn", {}, [TUE, "09:10"]);
ok(!sp.ok && /kiosk/i.test(sp.error), "with self-punch off, staff must use the kiosk");
ok((await call(PRIYA, "checkIn", {}, [TUE, "09:10"])).ok, "…admins can still punch themselves");
await call(boss, "saveSettings", { settings: { ATT_SELF_PUNCH: "Y" } }, TUE);
const sp2 = await call(NIDHI, "checkIn", { photo: JPG }, [TUE, "09:12"]);
ok(sp2.ok && sp2.data.inPhoto.startsWith("PHO"), "self check-in can carry a photo");

section("forgot to check in / out");
const WED = "2026-10-14";
const tk = await runTick(db, undefined, at(WED, "09:50"));
ok(tk.attendanceReminders >= 1, `people who have not checked in get a reminder: ${tk.attendanceReminders}`);
const nb2 = (await db.load(["Notifications"], { fresh: true })).Notifications.filter((n) => n.type === "checkin-reminder" && String(n.createdAt).startsWith(WED));
ok(nb2.some((n) => n.userId === KUNAL), "Kunal is reminded");
ok((await runTick(db, undefined, at(WED, "10:05"))).attendanceReminders === 0, "…only once a day");
await call(KUNAL, "checkIn", {}, [WED, "10:00"]);
const tk2 = await runTick(db, undefined, at(WED, "18:40"));
ok((await db.load(["Notifications"], { fresh: true })).Notifications.some((n) => n.type === "checkout-reminder" && n.userId === KUNAL && String(n.createdAt).startsWith(WED)), `still checked in after 18:30 → reminded to check out (${tk2.attendanceReminders})`);
const nob = (await call(PRIYA, "markAttendance", { userId: KUNAL, date: "2026-10-02", checkIn: "09:30" }, WED));
ok(nob.ok && !nob.data.checkOut, "an old punch that was never closed");
ok(!(await call(NIDHI, "closeMyPunch", { attId: nob.data.attId, time: "18:00" }, WED)).ok, "only the person can close their own punch");
ok(!(await call(KUNAL, "closeMyPunch", { attId: nob.data.attId, time: "09:00" }, WED)).ok, "the check-out must be after the check-in");
const att = async () => (await call(boss, "getFlowData", {}, WED)).data.attendance.find((x) => x.attId === nob.data.attId);
const cl2 = await call(KUNAL, "closeMyPunch", { attId: nob.data.attId, time: "18:05", reason: "left in a hurry" }, WED);
ok(cl2.ok && cl2.data.pending === true && !(await att()).checkOut, "asking to close an old punch does NOT mark it — the check-out stays empty until it is approved");
ok(!(await call(KUNAL, "closeMyPunch", { attId: nob.data.attId, time: "18:10" }, WED)).ok, "a second request while the first waits is refused");
const rq = (await call(KUNAL, "getFlowData", {}, WED)).data.requests.find((r) => r.kind === "checkout" && r.status === "Pending");
ok(rq && rq.newPlanned === "2026-10-02 18:05" && rq.taskId === nob.data.attId, "Kunal sees his request, and the manager gets it in Approvals");
ok((await call(boss, "getFlowData", {}, WED)).data.requests.some((r) => r.requestId === rq.requestId) && (await call(boss, "getFlowData", {}, WED)).data.notifications.some((n) => /forgot to check out/.test(n.title)), "…the approver is notified");
ok(!(await call(KUNAL, "decideRequest", { requestId: rq.requestId, approve: true }, WED)).ok && !(await call(NIDHI, "decideRequest", { requestId: rq.requestId, approve: true }, WED)).ok, "he cannot approve his own check-out, and neither can a colleague");
const rj = await call(boss, "decideRequest", { requestId: rq.requestId, approve: false, note: "not sure you stayed" }, WED);
ok(rj.ok && !(await att()).checkOut, "declined: the day stays without a check-out");
const again = await call(KUNAL, "closeMyPunch", { attId: nob.data.attId, time: "18:10" }, WED);
ok(again.ok && again.data.pending, "after a decline he may ask again");
const rq2 = (await call(KUNAL, "getFlowData", {}, WED)).data.requests.find((r) => r.kind === "checkout" && r.status === "Pending");
const ap = await call(boss, "decideRequest", { requestId: rq2.requestId, approve: true }, WED);
ok(ap.ok && (await att()).checkOut === "2026-10-02 18:10" && /approved by/.test((await att()).note), "approved: only now the check-out is written (and the day counts)");
ok(!(await call(boss, "decideRequest", { requestId: rq2.requestId, approve: true }, WED)).ok, "a request is decided only once");
ok(!(await call(KUNAL, "closeMyPunch", { attId: nob.data.attId, time: "18:20" }, WED)).ok, "a closed punch cannot be changed again");
ok(!(await call(boss, "saveSettings", { settings: { ATT_GATE: "sometimes" } }, WED)).ok && (await call(boss, "saveSettings", { settings: { ATT_GATE: "prompt", ATT_REMIND_CHECKIN: "09:30" } }, WED)).ok, "check-in screen settings are validated and can be changed");

console.log(`\n${pass} passed, ${fail} failed`);
fake.close();
process.exit(fail ? 1 : 0);
