// Imports your Drive "Attendance System" workbook: employee IDs + leave allowance (Staff Information), every check-in / check-out (Attendance),
// leave requests (Leave Requests) and festival holidays (Holidays; Sundays are skipped — they are already weekly off).
//   Download the Google Sheet as .xlsx first (File → Download → Microsoft Excel), then:
//   node --no-warnings --env-file=.env.local tools/attendance-xlsx.mjs "<Attendance System.xlsx>" [--dry] [--since 2026-01-01]
// People are matched by employee ID, then email, then name. Staff who are not users in the app are listed and skipped.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "../src/server/api.ts";
import { dbFromEnv } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);
const text = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text ?? v.richText?.map((t) => t.text).join("") ?? "";
  return v === null || v === undefined ? "" : v instanceof Date ? "" : String(v).trim();
};
const raw = (v) => (v && typeof v === "object" && !(v instanceof Date) && v.result !== undefined ? v.result : v);
// Excel dates arrive as UTC Dates whose wall-clock parts are the time shown in the sheet
const dt = (v) => { v = raw(v); return v instanceof Date && !isNaN(v) ? v.toISOString().slice(0, 16).replace("T", " ") : ""; };
const day = (v) => dt(v).slice(0, 10);
const num = (v) => { const n = Number(raw(v)); return isNaN(n) || raw(v) === "" || raw(v) == null ? undefined : n; };

export async function readAttendanceWorkbook(file) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = (n) => { const ws = wb.getWorksheet(n); if (!ws) throw new Error(`This workbook has no "${n}" sheet.`); return ws; };
  const rows = (ws, from = 2) => { const out = []; ws.eachRow((r, i) => { if (i >= from) out.push(r); }); return out; };
  const staff = rows(sheet("Staff Information")).map((r) => ({ code: text(r.getCell(1).value), name: text(r.getCell(2).value), department: text(r.getCell(3).value), email: text(r.getCell(4).value).toLowerCase(), leaveAllot: num(r.getCell(5).value) })).filter((s) => s.code);
  const punches = rows(sheet("Attendance")).map((r) => ({ code: text(r.getCell(1).value), name: text(r.getCell(2).value), checkIn: dt(r.getCell(4).value), checkOut: dt(r.getCell(5).value), lat: num(r.getCell(6).value), lng: num(r.getCell(7).value) })).filter((p) => p.checkIn);
  const leaves = rows(sheet("Leave Requests")).map((r) => ({ code: text(r.getCell(1).value), email: text(r.getCell(2).value).toLowerCase(), startDate: day(r.getCell(3).value), endDate: day(r.getCell(4).value), reason: text(r.getCell(5).value), type: text(r.getCell(6).value), status: text(r.getCell(8).value) })).filter((l) => l.code && l.startDate);
  const holidays = rows(sheet("Holidays"), 1).map((r) => day(r.getCell(1).value)).filter((d) => d && new Date(d + "T00:00:00Z").getUTCDay() !== 0);
  return { staff, punches, leaves, holidays: [...new Set(holidays)] };
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.log('Usage: node --no-warnings --env-file=.env.local tools/attendance-xlsx.mjs "<Attendance System.xlsx>" [--dry] [--since yyyy-mm-dd]'); process.exit(1); }
  const si = process.argv.indexOf("--since");
  const since = si > 0 ? process.argv[si + 1] : "";
  const data = await readAttendanceWorkbook(file);
  const punches = data.punches.filter((p) => !since || p.checkIn.slice(0, 10) >= since);
  console.log(`Read ${data.staff.length} staff, ${punches.length} punches${since ? ` since ${since}` : ""}, ${data.leaves.length} leave requests, ${data.holidays.length} festival holidays.`);
  if (process.argv.includes("--dry")) return;
  const db = dbFromEnv();
  const { Users } = await db.load(["Users"], { fresh: true });
  const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) throw new Error("No Super Admin yet. Open the app once and complete the first-time setup.");
  const bossId = String(boss.userId);
  const byName = (n) => Users.find((u) => String(u.name).toLowerCase() === n.toLowerCase());
  const byEmail = (e) => Users.find((u) => e && String(u.email).toLowerCase() === e);

  // 1 · employee IDs and leave allowance
  const codeToUser = new Map();
  const missing = new Set();
  let setup = 0;
  for (const s of data.staff) {
    const u = byEmail(s.email) ?? byName(s.name);
    if (!u) { missing.add(s.name); continue; }
    codeToUser.set(s.code.toLowerCase(), String(u.userId));
    const r = await runAction(db, bossId, "bulkSaveUsers", { rows: [{ name: u.name, email: u.email, department: u.department || s.department, empCode: s.code, leaveAllot: s.leaveAllot }] });
    if (r.ok && r.data.updated) setup++;
    else if (!r.ok || r.data.skipped.length) console.log(`  ${s.name}: ${r.ok ? r.data.skipped[0].reason : r.error}`);
  }
  console.log(`Employee ID + leave allowance set for ${setup} people.${missing.size ? ` Not in the app (skipped): ${[...missing].join(", ")}` : ""}`);
  const who = (code, name) => codeToUser.get(String(code).toLowerCase()) ?? (byName(name) ? String(byName(name).userId) : "");

  // 2 · punches
  const rows = [], unknown = new Set();
  for (const p of punches) { const userId = who(p.code, p.name); if (!userId) { unknown.add(p.name || p.code); continue; } rows.push({ userId, checkIn: p.checkIn, checkOut: p.checkOut, lat: p.lat, lng: p.lng }); }
  let added = 0, dup = 0;
  for (let i = 0; i < rows.length; i += 1500) {
    const res = await runAction(db, bossId, "importAttendance", { rows: rows.slice(i, i + 1500) });
    if (!res.ok) { console.error("Attendance import failed:", res.error); process.exit(1); }
    added += res.data.added; dup += res.data.skipped;
    process.stdout.write(`\r  punches ${Math.min(i + 1500, rows.length)}/${rows.length}`);
  }
  console.log(`\nPunches: ${added} added, ${dup} skipped (already there / not understood).${unknown.size ? ` People not in the app: ${[...unknown].join(", ")}` : ""}`);

  // 3 · leave requests
  const lrows = data.leaves.map((l) => ({ userId: who(l.code, ""), type: l.type, startDate: l.startDate, endDate: l.endDate, reason: l.reason, status: l.status })).filter((l) => l.userId);
  if (lrows.length) { const r = await runAction(db, bossId, "importLeaves", { rows: lrows }); console.log(r.ok ? `Leave requests: ${r.data.added} added, ${r.data.skipped} skipped.` : `Leave import failed: ${r.error}`); }

  // 4 · festival holidays (Sundays are already weekly off)
  if (data.holidays.length) { const r = await runAction(db, bossId, "addHolidays", { dates: data.holidays, label: "Imported from Attendance System" }); console.log(r.ok ? `Holidays: ${r.data.added} added, ${r.data.skipped} already there.` : `Holiday import failed: ${r.error}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
