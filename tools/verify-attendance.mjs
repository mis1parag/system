// Compares the Drive "Attendance" tab with the live sheet, person by person: punch counts, first and last day, and what could not be mapped. Read-only.
//   node --no-warnings --env-file=.env.live tools/verify-attendance.mjs <Attendance System.xlsx>
import { createRequire } from "node:module";
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { wall } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) { console.error("Give the Attendance System .xlsx file."); process.exit(1); }
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet("Attendance");
const val = (c) => { let x = c.value; if (x && typeof x === "object" && !(x instanceof Date)) x = x.result ?? x.text ?? ""; return x; };
const drive = new Map();
ws.eachRow((row, i) => {
  if (i < 2) return;
  const id = String(val(row.getCell(1)) ?? "").trim(), cin = val(row.getCell(4));
  if (!id || !(cin instanceof Date) || isNaN(cin)) return;
  const e = drive.get(id) ?? { name: String(val(row.getCell(2)) ?? ""), n: 0, first: "9", last: "0", open: 0 };
  const t = cin.toISOString().slice(0, 16).replace("T", " "); e.n++; if (t < e.first) e.first = t; if (t > e.last) e.last = t;
  if (!(val(row.getCell(5)) instanceof Date)) e.open++;
  drive.set(id, e);
});
const db = new Db(createSheetsClient(configFromEnv()));
const { Users, Attendance } = await db.load(["Users", "Attendance"], { fresh: true });
const user = new Map(Users.filter((u) => u.empCode).map((u) => [String(u.empCode).toLowerCase(), u]));
const live = new Map();
for (const a of Attendance) { if (a.deleted === "Y") continue; const e = live.get(String(a.userId)) ?? { n: 0, first: "9", last: "0", src: {} }; e.n++; if (String(a.checkIn) < e.first) e.first = String(a.checkIn); if (String(a.checkIn) > e.last) e.last = String(a.checkIn); e.src[a.source] = (e.src[a.source] ?? 0) + 1; live.set(String(a.userId), e); }
let bad = 0, driveTotal = 0, liveTotal = 0;
console.log("Employee ID  Name           Drive  Live   First punch (Drive → Live)         Last punch (Drive → Live)");
for (const [id, d] of [...drive].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const u = user.get(id.toLowerCase());
  driveTotal += d.n;
  if (!u) { console.log(id.padEnd(12), d.name.padEnd(14), String(d.n).padStart(5), "   —   NOT IN THE APP (person left / no account) — not imported"); bad += d.n; continue; }
  const l = live.get(String(u.userId)) ?? { n: 0, first: "-", last: "-", src: {} };
  liveTotal += l.n;
  const ok = l.n === d.n && l.first === d.first && l.last === d.last;
  if (!ok) bad += Math.abs(d.n - l.n);
  console.log(id.padEnd(12), d.name.padEnd(14), String(d.n).padStart(5), String(l.n).padStart(5), ` ${d.first} → ${l.first}   ${d.last} → ${l.last}`, ok ? "✓" : "✗ differs", Object.keys(l.src).length > 1 || !l.src.import ? JSON.stringify(l.src) : "");
}
const bySource = {};
for (const a of Attendance) if (a.deleted !== "Y") bySource[a.source] = (bySource[a.source] ?? 0) + 1;
console.log(`\nDrive punches: ${driveTotal} · live punches: ${Attendance.filter((a) => a.deleted !== "Y").length} (mapped people: ${liveTotal}) · by source:`, bySource);
console.log(bad ? `${bad} punch(es) differ or could not be mapped (listed above).` : "Everything matches.");
await new Promise((r) => setTimeout(r, 300));
