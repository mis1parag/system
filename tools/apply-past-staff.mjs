// Gives the people who LEFT (the "Past Staff Information" tab of the Attendance System) their Employee ID, so their old attendance and leave can be mapped to them.
// A person who is not in the app at all is added as an INACTIVE person (cannot sign in; no mobile / e-mail is invented). Nothing is deleted.
//   node --no-warnings --env-file=.env.live tools/apply-past-staff.mjs <Attendance System.xlsx> [--yes]
import { createRequire } from "node:module";
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { Db, newId } from "../src/server/sheets/db.ts";

const require = createRequire(import.meta.url);
const file = process.argv[2], yes = process.argv.includes("--yes");
if (!file) { console.error("Give the Attendance System .xlsx file."); process.exit(1); }
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet("Past Staff Information");
const cell = (r, c) => { let x = r.getCell(c).value; if (x && typeof x === "object") x = x.text ?? x.result ?? ""; return String(x ?? "").trim(); };
const people = [];
ws.eachRow((r, i) => { if (i > 1 && cell(r, 1)) people.push({ code: cell(r, 1), name: cell(r, 2), dept: cell(r, 3), email: cell(r, 4).toLowerCase() }); });

const db = new Db(createSheetsClient(configFromEnv()));
await db.load(["Users"], { fresh: true });
const tx = db.begin("system");
const users = await tx.rows("Users");
tx.stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
for (const p of people) {
  const taken = users.find((u) => String(u.empCode).toLowerCase() === p.code.toLowerCase());
  const u = taken ?? users.find((x) => x.deleted !== "Y" && x.status !== "Active" && (String(x.email).toLowerCase() === p.email || String(x.name).trim().toLowerCase() === p.name.toLowerCase()));
  if (u && taken) { console.log(`${p.name.padEnd(10)} ${p.code.padEnd(9)} already has this Employee ID`); continue; }
  if (u) { console.log(`${p.name.padEnd(10)} ${p.code.padEnd(9)} → existing inactive person ${u.userId}: Employee ID set`); if (yes) { u.empCode = p.code; if (!u.department) u.department = p.dept; tx.audit("Employee ID set for a past employee", "Users", String(u.userId), null, { empCode: p.code }); } continue; }
  console.log(`${p.name.padEnd(10)} ${p.code.padEnd(9)} → not in the app: added as an inactive person (no sign-in)`);
  if (yes) {
    const rec = tx.insert("Users", { userId: newId("USR"), name: p.name, role: "STAFF", mobile: "", email: "", status: "Inactive", managerId: "", notify: "app", pinHash: "", failCount: 0, lockedUntil: "", createdAt: tx.stamp, department: p.dept, empCode: p.code, leaveAllot: 0, photoVer: "", roleId: "", permsJson: "", exitDate: "", exitType: "Left before the app", exitReason: "From the Drive 'Past Staff Information' list", exitHandover: "", exitBy: "import", exitAt: tx.stamp, exitDone: "Y", deleted: "" });
    tx.audit("Past employee added (inactive) from Drive", "Users", String(rec.userId), null, { name: p.name, empCode: p.code });
  }
}
if (yes) { await tx.commit(); console.log("\nDone."); } else console.log("\nNothing was written. Add --yes.");
await new Promise((r) => setTimeout(r, 300));
