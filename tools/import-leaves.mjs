// Imports every row of the "Leave Requests" tab of the Attendance System (people who left included). A person is found by Employee ID, then e-mail, then name.
// Requests already in the app are skipped. Nothing is changed or deleted.
//   node --no-warnings --env-file=.env.live tools/import-leaves.mjs <Attendance System.xlsx> [--dry]
import { createRequire } from "node:module";
import { runAction } from "../src/server/api.ts";
import { dbFromEnv } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) { console.error("Give the Attendance System .xlsx file."); process.exit(1); }
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet("Leave Requests");
const t = (c) => { let x = c.value; if (x && typeof x === "object" && !(x instanceof Date)) x = x.result ?? x.text ?? ""; return x instanceof Date ? (isNaN(x) ? "" : x.toISOString().slice(0, 10)) : String(x ?? "").trim(); };
const db = dbFromEnv();
const { Users } = await db.load(["Users"], { fresh: true });
const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
const byCode = new Map(), byEmail = new Map(), byName = new Map();
for (const u of Users) { if (u.deleted === "Y") continue; if (u.empCode) byCode.set(String(u.empCode).toLowerCase(), u); if (u.email) byEmail.set(String(u.email).toLowerCase(), u); byName.set(String(u.name).trim().toLowerCase(), u); }
const rows = [], unmapped = [];
ws.eachRow((r, i) => {
  if (i < 2 || !t(r.getCell(1))) return;
  const id = t(r.getCell(1)), email = t(r.getCell(2)).toLowerCase();
  const u = byCode.get(id.toLowerCase()) ?? byEmail.get(email) ?? byName.get(id.toLowerCase());
  const start = t(r.getCell(3)), end = t(r.getCell(4)) || start;
  if (!u || !start) { unmapped.push(`${id} ${start}`); return; }
  rows.push({ userId: String(u.userId), type: t(r.getCell(6)) || "Full Day", startDate: start, endDate: end, reason: t(r.getCell(5)) || "(from Drive)", status: t(r.getCell(8)) });
});
console.log(`${rows.length} leave requests can be mapped to a person; not mapped: ${unmapped.length}${unmapped.length ? " → " + unmapped.slice(0, 8).join(", ") : ""}`);
if (!process.argv.includes("--dry")) {
  const res = await runAction(db, String(boss.userId), "importLeaves", { rows });
  console.log(res.ok ? `Added ${res.data.added}, skipped ${res.data.skipped} (already there or not understood).` : res.error);
}
await new Promise((r) => setTimeout(r, 300));
