// Imports the checklist HISTORY from the Drive "Admin Control" workbook (tabs Daily, Non-Daily, One time: one row per dated task with Planned, Actual and Status)
// into the app's Checklist_Log: completed ones stay completed (with their real completion time), pending ones stay pending, nothing is marked done that was not.
// Entries planned more than --future-days (default 45) ahead are left out on purpose: the app creates them by itself from the schedule when they come near.
// A task that is not in the current Task List (it was removed, or its doer left) is kept as an Archived task so its history is not lost.
//   node --no-warnings --env-file=.env.live tools/import-checklist-history.mjs <Admin Control.xlsx> [--dry] [--future-days 45]
import { createRequire } from "node:module";
import { colLetter, configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { Db, newId } from "../src/server/sheets/db.ts";
import { TABLES } from "../src/server/sheets/schema.ts";
import { wall } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^[0-9]+$/.test(a));
const dry = args.includes("--dry");
const fd = args.indexOf("--future-days");
const futureDays = fd >= 0 ? Number(args[fd + 1]) : 45;
if (!file) { console.error("Give the Admin Control .xlsx file."); process.exit(1); }

const raw = (c) => { let x = c.value; if (x && typeof x === "object" && !(x instanceof Date)) x = x.result ?? x.text ?? ""; return x; };
const text = (c) => { const x = raw(c); return x == null || x instanceof Date ? "" : String(x).replace(/\s+/g, " ").trim(); };
const dateOf = (c) => { const x = raw(c); return x instanceof Date && !isNaN(x) ? x.toISOString().slice(0, 10) : ""; };
const dtOf = (c) => { const x = raw(c); return x instanceof Date && !isNaN(x) ? wall(x) : ""; };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const rows = [];
for (const [tab, fixedFreq] of [["Daily", "D"], ["Non-Daily", ""], ["One time", "O"]]) {
  const ws = wb.getWorksheet(tab);
  if (!ws) { console.error(`Tab "${tab}" is missing.`); process.exit(1); }
  ws.eachRow((row, i) => {
    if (i < 2) return;
    const planned = dateOf(row.getCell(7));
    if (!planned) return;
    const freq = fixedFreq || text(row.getCell(5)).toUpperCase().slice(0, 1) || "W";
    rows.push({ tab, name: text(row.getCell(1)), email: text(row.getCell(2)).toLowerCase(), dept: text(row.getCell(3)), title: text(row.getCell(6)), freq, planned, actual: dtOf(row.getCell(8)), status: text(row.getCell(9)) });
  });
}
const todayStr = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const horizon = addDays(todayStr, futureDays);
console.log(`Read ${rows.length} dated rows (${["Daily", "Non-Daily", "One time"].map((t) => `${t}: ${rows.filter((r) => r.tab === t).length}`).join(", ")}). Showing up to ${horizon}.`);

const cfg = configFromEnv();
if (cfg.baseUrl && !args.includes("--allow-fake")) { console.error("This points at the local test sheet. Use the live env file (or --allow-fake)."); process.exit(1); }
const client = createSheetsClient(cfg);
const db = new Db(client);
const { Users, Checklist_Tasks, Checklist_Log } = await db.load(["Users", "Checklist_Tasks", "Checklist_Log"], { fresh: true });
const byName = new Map(), byEmail = new Map();
for (const u of Users) { if (u.deleted === "Y") continue; byName.set(String(u.name).trim().toLowerCase(), u); if (u.email) byEmail.set(String(u.email).toLowerCase(), u); }
const userOf = (r) => byEmail.get(r.email) ?? byName.get(r.name.toLowerCase());

const key = (doerId, title, freq) => `${doerId}|${title.toLowerCase()}|${freq}`;
const taskBy = new Map(), taskByTitle = new Map();
for (const t of Checklist_Tasks) { taskBy.set(key(String(t.doerId), String(t.title).toLowerCase(), String(t.freq)), t); const k2 = `${String(t.title).toLowerCase()}|${t.freq}`; if (!taskByTitle.has(k2)) taskByTitle.set(k2, t); }
const have = new Set(Checklist_Log.filter((l) => l.status !== "Cancelled").map((l) => `${l.ctId}|${l.plannedDate}`));

const stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
const newTasks = [], logs = [];
const skipped = { unknownPerson: new Set(), future: 0, duplicate: 0, noTitle: 0 };
let done = 0, pending = 0;
for (const r of rows) {
  if (!r.title) { skipped.noTitle++; continue; }
  const u = userOf(r);
  if (!u) { skipped.unknownPerson.add(r.name || r.email); continue; }
  if (r.planned > horizon) { skipped.future++; continue; }
  const doerId = String(u.userId);
  let t = taskBy.get(key(doerId, r.title.toLowerCase(), r.freq)) ?? taskByTitle.get(`${r.title.toLowerCase()}|${r.freq}`);
  if (!t) {
    // not in the current Task List: keep the history under an Archived task
    t = { ctId: newId("CLT"), title: r.title, doerId, backupId: "", department: r.dept || String(u.department ?? ""), freq: r.freq, startDate: r.planned, endDate: "", proof: "N", kra: "history from Drive", status: "Archived", lastGenerated: r.planned, createdAt: stamp, createdBy: "import", updatedAt: stamp };
    taskBy.set(key(doerId, r.title.toLowerCase(), r.freq), t); newTasks.push(t);
  }
  const k = `${t.ctId}|${r.planned}`;
  if (have.has(k)) { skipped.duplicate++; continue; }
  have.add(k);
  const finished = /^completed$/i.test(r.status);
  const actual = finished ? r.actual || `${r.planned} 00:00` : "";
  finished ? done++ : pending++;
  logs.push({ clId: newId("CLG"), ctId: t.ctId, doerId, plannedDate: r.planned, status: finished ? "Done" : "Pending", actual, doneBy: finished ? doerId : "", proof: "", remarks: "", remindedAt: "", createdAt: stamp, updatedAt: stamp, origDate: "", movedBy: "" });
}
console.log(`\nTo add: ${logs.length} checklist entries (${done} done, ${pending} pending), ${newTasks.length} archived tasks to keep old history.`);
console.log(`Left out: ${skipped.future} planned after ${horizon} (the schedule creates them in time) · ${skipped.duplicate} already there · ${skipped.noTitle} without a task name · people not in the app: ${[...skipped.unknownPerson].join(", ") || "none"}`);
if (dry) { console.log("\nDry run — nothing was written."); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toRows = (table, recs) => recs.map((rec) => TABLES[table].cols.map(([k, , type]) => (rec[k] === undefined || rec[k] === null ? (type === "nn" ? "" : "") : rec[k])));
async function push(table, recs) {
  const range = `${quoteTab(table)}!A:${colLetter(TABLES[table].cols.length)}`;
  const data = toRows(table, recs);
  for (let i = 0; i < data.length; i += 500) { await client.append(range, data.slice(i, i + 500)); await sleep(700); process.stdout.write(`\r  ${table}: ${Math.min(i + 500, data.length)}/${data.length}`); }
  if (data.length) console.log();
}
await push("Checklist_Tasks", newTasks);
await push("Checklist_Log", logs);
const tx = db.begin("system");
tx.stamp = stamp;
tx.audit("Checklist history imported from Drive", "Checklist_Log", "import", null, { entries: logs.length, done, pending, archivedTasks: newTasks.length });
await tx.commit();
console.log("Done.");
