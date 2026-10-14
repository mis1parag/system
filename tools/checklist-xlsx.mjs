// Imports the "Task List" sheet of your Drive checklist workbooks (Daily Checklist / Non daily Checklist) into the app's Checklist.
//   Download the Google Sheet as .xlsx first (File → Download → Microsoft Excel), then:
//   node --no-warnings --env-file=.env.local tools/checklist-xlsx.mjs "<file.xlsx>" [--dry] [--start 2026-10-07]
// Columns read from the "Task List" sheet: Task · Doer Name · Department · Frequency · Day/Date
// People are matched by NAME, so add them in the app's Team page first (same spelling as in the sheet).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "../src/server/api.ts";
import { readFileSync } from "node:fs";
import { dbFromEnv } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);

const text = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text ?? v.richText?.map((t) => t.text).join("") ?? "";
  return v === null || v === undefined ? "" : v instanceof Date ? "" : String(v).trim();
};
const isoDate = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date) && v.result instanceof Date) v = v.result;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10); // Excel serials come back as UTC wall-clock
  return text(v);
};

export async function readTaskList(file) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Task List");
  if (!ws) throw new Error('This workbook has no "Task List" sheet.');
  const head = {};
  ws.getRow(1).eachCell((c, i) => { head[text(c.value).toLowerCase()] = i; });
  const col = (...names) => names.map((n) => head[n]).find(Boolean);
  const cTask = col("task"), cDoer = col("doer name", "doer"), cDept = col("department"), cFreq = col("frequency", "freq"), cDay = col("day/date", "date", "day");
  if (!cTask || !cDoer || !cFreq) throw new Error("Could not find the Task / Doer Name / Frequency columns in row 1 of “Task List”.");
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const title = text(row.getCell(cTask).value);
    if (!title) return;
    rows.push({ title, doer: text(row.getCell(cDoer).value), department: cDept ? text(row.getCell(cDept).value) : "", freq: text(row.getCell(cFreq).value), startDate: cDay ? isoDate(row.getCell(cDay).value) : "" });
  });
  return rows;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.log('Usage: node --no-warnings --env-file=.env.local tools/checklist-xlsx.mjs "<file.xlsx>" [--dry] [--start yyyy-mm-dd]'); process.exit(1); }
  const rows = await readTaskList(file);
  // tasks of people who have left go to whoever took over (Drive "Employee Exist" sheet) — see tools/team-from-drive.json; --no-remap turns this off
  const handover = process.argv.includes("--no-remap") ? {} : JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "team-from-drive.json"), "utf8")).handover ?? {};
  let moved = 0;
  rows.forEach((r) => { if (handover[r.doer]) { r.doer = handover[r.doer]; moved++; } });
  if (moved) console.log(`${moved} tasks of people who left were handed to their replacement.`);
  const byFreq = {};
  rows.forEach((r) => { byFreq[r.freq || "?"] = (byFreq[r.freq || "?"] ?? 0) + 1; });
  console.log(`Read ${rows.length} tasks.`, byFreq, "doers:", [...new Set(rows.map((r) => r.doer))].join(", "));
  if (process.argv.includes("--dry")) return;
  const db = dbFromEnv();
  const { Users } = await db.load(["Users"], { fresh: true });
  const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) throw new Error("No Super Admin yet. Open the app once and complete the first-time setup.");
  const si = process.argv.indexOf("--start");
  const res = await runAction(db, String(boss.userId), "bulkAddChecklistTasks", { rows, defaultStart: si > 0 ? process.argv[si + 1] : undefined });
  if (!res.ok) { console.error("Import failed:", res.error); process.exit(1); }
  console.log(`Added ${res.data.added} tasks (${res.data.created} dated entries created), skipped ${res.data.skipped.length}.`);
  if (res.data.unknownDoers.length) console.log("People not found — add them in Team (same spelling) and run again:", res.data.unknownDoers.join(", "));
  res.data.skipped.slice(0, 15).forEach((s) => console.log(`  row ${s.row}: ${s.reason}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
