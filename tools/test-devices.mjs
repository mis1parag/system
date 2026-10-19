// Registered laptops, compulsory camera, the people excused from them — and Google-only sign-in.
//   node --no-warnings tools/test-devices.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup } from "../src/server/domain/system.ts";
import { login } from "../src/server/domain/auth.ts";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "d", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
const denied = (r) => !r.ok && r.code === "FORBIDDEN";
const section = (s) => console.log("\n" + s);
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const call = (actor, action, data = {}, when) => runAction(db, actor, action, data, { now: at(...[].concat(when ?? ["2026-10-07"])), meta: { ip: "10.0.0.5", device: "Chrome · Windows" } });
const day = (n) => `2026-10-${String(n).padStart(2, "0")}`; // 7 Oct 2026 is a Wednesday
const PHOTO = "data:image/jpeg;base64," + "A".repeat(400);
const LAPTOP_A = "tok-laptop-A-".padEnd(40, "a"), LAPTOP_B = "tok-laptop-B-".padEnd(40, "b"), PHONE = "tok-phone-C-".padEnd(40, "c");

const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: false })).userId;
const mk = async (name, role, mobile, extra = {}) => { const r = await call(boss, "saveUser", { name, role, mobile, department: "Sales", pin: "4444", empCode: name.slice(0, 3).toUpperCase() + "1", email: name.toLowerCase() + "@co.in", ...extra }); if (!r.ok) throw new Error(name + ": " + r.error); return r.data.userId; };
const ASHA = await mk("Asha", "STAFF", "9000000011");
const ROHAN = await mk("Rohan", "STAFF", "9000000012");
const FIELD = await mk("Farhan", "STAFF", "9000000013");
const HR = await mk("Hema", "STAFF", "9000000014");
ok((await call(boss, "saveUserAccess", { userId: HR, role: "STAFF", overrides: { attendance: { a: ["view", "configure", "manage"], s: "all" } } })).ok, "Hema may manage attendance settings");

// ------------------------------------------------------------------------------------------------ rules off = nothing changes
section("with both rules off, check-in works as before");
const plain = await call(ASHA, "checkIn", {}, [day(7), "09:10"]);
ok(plain.ok && plain.data.inDevice === "", "no laptop token, no photo: allowed, nothing recorded");
ok((await call(ASHA, "checkOut", {}, [day(7), "17:30"])).ok, "…and check-out too");
ok(JSON.stringify((await call(ASHA, "getFlowData", {})).data.attRules) === JSON.stringify({ cameraRequired: false, deviceCheck: false }), "the screen is told no rule applies");

// ------------------------------------------------------------------------------------------------ compulsory camera
section("compulsory camera");
ok(denied(await call(ASHA, "saveSettings", { settings: { ATT_PHOTO: "R" } })) && !(await call(boss, "saveSettings", { settings: { ATT_PHOTO: "maybe" } })).ok, "only the Super Admin changes the rule, and a wrong value is refused");
ok((await call(boss, "saveSettings", { settings: { ATT_PHOTO: "R" } })).ok, "camera made compulsory");
ok((await call(ASHA, "getFlowData", {})).data.attRules.cameraRequired === true, "the screen is told the camera is compulsory");
const noPic = await call(ASHA, "checkIn", {}, [day(8), "09:10"]);
ok(!noPic.ok && noPic.code === "CAMERA" && (await call(ASHA, "getFlowData", {}, day(8))).data.attendance.filter((a) => a.date === day(8)).length === 0, "check-in without a photo is refused and nothing is saved");
ok(!(await call(ASHA, "checkIn", { photo: "data:image/png;base64,AAAA" }, [day(8), "09:10"])).ok && !(await call(ASHA, "checkIn", { photo: "not an image" }, [day(8), "09:10"])).ok, "a PNG, a tiny or a made-up photo is not accepted");
const withPic = await call(ASHA, "checkIn", { photo: PHOTO }, [day(8), "09:10"]);
ok(withPic.ok && withPic.data.inPhoto.startsWith("PHO"), "with a camera photo the check-in is saved and the photo is kept");
ok(!(await call(ASHA, "checkOut", {}, [day(8), "17:30"])).ok && (await call(ASHA, "checkOut", { photo: PHOTO }, [day(8), "17:30"])).ok, "check-out needs the photo as well");
// excused
ok(denied(await call(ASHA, "saveAttExempt", { userId: ASHA, camera: true, reason: "x" })) && denied(await call(FIELD, "saveAttExempt", { userId: FIELD, camera: true, reason: "x" })), "nobody can excuse themselves or anyone else without the right");
ok(!(await call(HR, "saveAttExempt", { userId: FIELD, camera: true, reason: "" })).ok, "an excuse needs a reason");
ok((await call(HR, "saveAttExempt", { userId: FIELD, camera: true, reason: "Field staff, phone camera broken" })).ok, "Hema excuses Farhan from the camera");
ok((await call(FIELD, "getFlowData", {})).data.attRules.cameraRequired === false && (await call(FIELD, "checkIn", {}, [day(8), "09:20"])).ok, "Farhan checks in without a photo; everyone else still needs one");
ok(!(await call(ROHAN, "checkIn", {}, [day(8), "09:20"])).ok, "Rohan (not excused) is still refused");
ok((await call(HR, "saveAttExempt", { userId: FIELD, camera: false, device: false })).ok && !(await call(FIELD, "checkOut", {}, [day(8), "18:00"])).ok, "taking the excuse back puts the rule back");
await call(HR, "saveAttExempt", { userId: FIELD, camera: true, reason: "Field staff" });

// ------------------------------------------------------------------------------------------------ registered laptops
section("registered laptops");
await call(boss, "saveSettings", { settings: { ATT_PHOTO: "N", ATT_DEVICE_CHECK: "Y" } });
ok((await call(ROHAN, "getFlowData", {})).data.attRules.deviceCheck === true, "the screen is told laptops must be registered");
const noTok = await call(ROHAN, "checkIn", {}, [day(9), "09:00"]);
ok(!noTok.ok && noTok.code === "DEVICE", "a browser that cannot be recognised cannot check in");
const r1 = await call(ROHAN, "checkIn", { deviceToken: LAPTOP_A, deviceName: "Rohan office laptop" }, [day(9), "09:00"]);
ok(r1.ok && r1.data.inDevice.startsWith("DEV"), "Rohan's first laptop registers itself and the check-in is saved with its id");
const my = await call(ROHAN, "myDevices", { deviceToken: LAPTOP_A });
ok(my.data.devices.length === 1 && my.data.devices[0].status === "Approved" && my.data.devices[0].current === true && /Rohan office laptop/.test(my.data.devices[0].label) && !("tokenHash" in my.data.devices[0]), "he sees his laptop as approved (and not the token hash)");
const co = await call(ROHAN, "checkOut", { deviceToken: LAPTOP_A }, [day(9), "17:00"]);
ok(co.ok && co.data.outDevice === r1.data.inDevice, "check-out from the same laptop records the same device");
// second device
const b1 = await call(ROHAN, "checkIn", { deviceToken: LAPTOP_B, deviceName: "Home PC" }, [day(10), "09:00"]);
ok(!b1.ok && b1.code === "DEVICE" && /not registered yet/.test(b1.error), "a second laptop is refused until approved");
const listed = await call(HR, "listDevices", {});
const pend = listed.data.devices.find((d) => d.status === "Pending");
ok(listed.ok && pend && pend.name === "Rohan" && /Home PC/.test(pend.label) && pend.userId === ROHAN, "…the request was kept even though the punch was refused");
ok((await call(HR, "getFlowData", {})).data.notifications.some((n) => /new laptop/.test(n.title)), "the admin got a notification");
ok(!(await call(ROHAN, "checkIn", { deviceToken: LAPTOP_B }, [day(10), "09:01"])).ok && (await call(HR, "listDevices", {})).data.devices.filter((d) => d.userId === ROHAN).length === 2, "asking again does not create a second request");
ok(denied(await call(ROHAN, "decideDevice", { deviceId: pend.deviceId, decision: "approve" })) && denied(await call(ASHA, "listDevices", {})), "an employee cannot approve a laptop (not even their own) or see the list");
ok(!(await call(HR, "decideDevice", { deviceId: pend.deviceId, decision: "maybe" })).ok, "only approve or block");
ok((await call(HR, "decideDevice", { deviceId: pend.deviceId, decision: "approve" })).ok, "Hema approves the Home PC");
ok((await call(ROHAN, "getFlowData", {}, day(10))).data.notifications.some((n) => /approved/.test(n.title)), "Rohan is told");
const b2 = await call(ROHAN, "checkIn", { deviceToken: LAPTOP_B }, [day(10), "09:05"]);
ok(b2.ok && b2.data.inDevice === pend.deviceId, "now the check-in works and records the Home PC");
await call(ROHAN, "checkOut", { deviceToken: LAPTOP_B }, [day(10), "17:00"]);
ok((await call(HR, "decideDevice", { deviceId: pend.deviceId, decision: "block" })).ok && (await call(ROHAN, "checkIn", { deviceToken: LAPTOP_B }, [day(11), "09:05"])).code === "DEVICE", "a blocked laptop is refused");
// somebody else's device token is not mine
const asha1 = await call(ASHA, "checkIn", { deviceToken: LAPTOP_A }, [day(11), "09:00"]);
ok(!asha1.ok || asha1.data.inDevice !== r1.data.inDevice, "Rohan's laptop token does not make Asha's check-in count as Rohan's laptop");
const ashaDevs = (await call(HR, "listDevices", {})).data.devices.filter((d) => d.userId === ASHA);
ok(ashaDevs.length === 1 && ashaDevs[0].status === "Approved", "Asha's own first device is registered under Asha");
// excused from the laptop rule
ok((await call(HR, "saveAttExempt", { userId: FIELD, device: true, camera: true, reason: "Field staff, uses any phone" })).ok, "Farhan is excused from the laptop rule too");
const f1 = await call(FIELD, "checkIn", { deviceToken: PHONE }, [day(11), "09:10"]);
ok(f1.ok && f1.data.inDevice === "" && (await call(HR, "listDevices", {})).data.devices.every((d) => d.userId !== FIELD), "he checks in from any phone; nothing is registered for him");
ok((await call(FIELD, "checkOut", {}, [day(11), "18:10"])).ok, "…and even without a token");
const ex = (await call(HR, "listDevices", {})).data.exempt;
ok(ex.length === 1 && ex[0].name === "Farhan" && ex[0].device && ex[0].camera && /Field staff/.test(ex[0].reason), "the excused list shows who, what and why");

// ------------------------------------------------------------------------------------------------ privacy and records
section("what is stored and shown");
const sheetDump = JSON.stringify(await db.load(["Devices"], { fresh: true }));
ok(!sheetDump.includes(LAPTOP_A) && !sheetDump.includes(LAPTOP_B) && !sheetDump.includes(PHONE), "the raw device token is never stored — only its hash");
ok(!JSON.stringify(await call(HR, "listDevices", {})).includes("tokenHash") && !JSON.stringify((await call(ROHAN, "getFlowData", {})).data).includes("tokenHash"), "no hash in any list or page data");
const att = (await call(HR, "getFlowData", {})).data.attendance.find((a) => a.userId === ROHAN && a.date === day(9));
ok(att && att.inDevice === r1.data.inDevice && att.outDevice === r1.data.inDevice, "the attendance row says which laptop was used");
const audit = (await db.load(["Audit_Log"], { fresh: true })).Audit_Log.map((a) => a.action);
ok(["Device registered (first use)", "Device waiting for approval", "Device approved", "Device blocked", "Laptop / camera excuse changed"].every((x) => audit.includes(x)), "every registration, decision and excuse is in the activity log");
// kiosk (run by an admin at reception) is not blocked by these rules
const ru = await call(HR, "kioskPunch", { empCode: "ROH1" }, [day(12), "09:00"]);
ok(ru.ok && ru.data.attendance.source === "kiosk", "the reception kiosk keeps working");

// ------------------------------------------------------------------------------------------------ Google-only sign-in
section("with Google sign-in on, PIN sign-in is for the Super Admin only");
const saved = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, url: process.env.APP_URL };
const refusedPin = async (who, pin, opts) => { try { await login(db, who, pin, {}, opts); return "allowed"; } catch (e) { return e.message; } };
ok(await refusedPin("asha@co.in", "4444", { googleOnly: false }) === "allowed", "without Google sign-in, PIN login works for everybody (nothing changes)");
ok(/sign in with Google/i.test(await refusedPin("asha@co.in", "4444", { googleOnly: true })), "with Google sign-in on, an employee's correct PIN is refused");
ok(/sign in with Google/i.test(await refusedPin("9000000011", "4444", { googleOnly: true })), "…whether they type the e-mail or the mobile number");
ok(await refusedPin("9999999999", "1234", { googleOnly: true }) === "allowed", "the Super Admin can still use the PIN (the way back in)");
ok((await db.load(["Audit_Log"], { fresh: true })).Audit_Log.some((a) => /PIN login refused/.test(a.action)), "the refusal is in the activity log");
process.env.GOOGLE_OAUTH_CLIENT_ID = "cid"; process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret"; process.env.APP_URL = "https://fms.example.com";
const noPinUser = await call(boss, "saveUser", { name: "Nina", role: "STAFF", mobile: "9000000020", department: "Sales", email: "nina@co.in" });
ok(noPinUser.ok, "with Google on, a new person is added without a PIN");
ok(!(await call(boss, "saveUser", { name: "Noemail", role: "STAFF", mobile: "9000000021", department: "Sales" })).ok, "…but needs the Google e-mail address they will sign in with");
ok(/sign in with Google/i.test(await refusedPin("nina@co.in", "0000", { googleOnly: true })), "the unused PIN of such a person cannot be guessed into a login");
for (const [k, v] of Object.entries({ GOOGLE_OAUTH_CLIENT_ID: saved.id, GOOGLE_OAUTH_CLIENT_SECRET: saved.secret, APP_URL: saved.url })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
ok(!(await call(boss, "saveUser", { name: "Nopin", role: "STAFF", mobile: "9000000022", department: "Sales", email: "nopin@co.in" })).ok, "without Google sign-in a PIN is still required for a new person");

console.log(`\n${pass} passed, ${failed} failed`);
fake.close();
process.exitCode = failed ? 1 : 0;
