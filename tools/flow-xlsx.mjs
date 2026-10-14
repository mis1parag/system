// Reads an "INSTAMART & BLINKIT FMS.xlsx"-style workbook (sheets "FMS" + "Holidays") and imports it into an FMS.
//   node tools/flow-xlsx.mjs "<path to xlsx>" [--dry]
// Talks to Google through the Sheets API using the same env as the app: GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON
// (or SHEETS_API_BASE=http://localhost:8788 for the local fake). Needs: npm i exceljs (dev dependency, already in package.json).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSheetsClient, configFromEnv } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/** Excel serials come back as UTC Dates whose wall-clock parts are the time shown in the sheet — keep them as wall-clock strings. */
export function wall(v) {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : null;
  if (!(v instanceof Date) || isNaN(v)) return "";
  return new Date(Math.round(v.getTime() / 60000) * 60000).toISOString().slice(0, 16).replace("T", " ");
}
const text = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text ?? v.richText?.map((t) => t.text).join("") ?? "";
  return v === null || v === undefined ? "" : String(v).trim();
};
const num = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result;
  const n = Number(v);
  return v === null || v === undefined || v === "" || isNaN(n) ? "" : n;
};

/** Parse the workbook → { rows, holidays }. `cached` holds the sheet's own planned values (used by the tests to verify our engine). */
export async function readWorkbook(file) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("FMS");
  if (!ws) throw new Error('Sheet "FMS" not found in the workbook');
  const rows = [];
  ws.eachRow((row, i) => {
    if (i < 7) return;
    const po = text(row.getCell("C").value);
    if (!po) return;
    const get = (c) => row.getCell(c).value;
    const postponed = text(get("I")) === "Yes - Post";
    const appointment = wall(get("F"));
    const next = wall(get("K"));
    rows.push({
      sheetRow: i,
      createdAt: wall(get("A")),
      data: { location: text(get("B")), po, boxes: num(get("D")), dispatchDate: wall(get("E")), appointmentDate: appointment, pickupDate: wall(get("G")), mode: text(get("H")) },
      anchorDate: postponed && next ? next : appointment,
      originalAnchor: appointment,
      postponeCount: postponed ? 1 : 0,
      postponeReason: text(get("L")),
      actuals: { s2: wall(get("N")), s3: wall(get("S")), s4: wall(get("W")), s5: wall(get("AA")), s6: wall(get("AE")) },
      cached: { s2: wall(get("M")), s3: wall(get("R")), s4: wall(get("V")), s5: wall(get("Z")), s6: wall(get("AD")) },
    });
  });
  const holidays = [];
  wb.getWorksheet("Holidays")?.eachRow((row) => {
    const d = row.getCell(1).value;
    if (d instanceof Date && !isNaN(d) && d.getUTCDay() !== 0) holidays.push(d.toISOString().slice(0, 10)); // Sundays are the weekly off
  });
  return { rows, holidays: [...new Set(holidays)] };
}

export const loadTemplate = (name = "instamart-blinkit") => JSON.parse(readFileSync(path.join(here, "..", "src", "lib", "templates", `${name}.json`), "utf8"));

/** Find the FMS with the template's name, or create it (resolving assignee names to users). */
export async function ensureFlow(db, actorId, tpl) {
  const got = await runAction(db, actorId, "getFlowData", {});
  if (!got.ok) throw new Error(got.error);
  const existing = got.data.flows.find((f) => f.name === tpl.name);
  if (existing) return existing;
  const byName = (n) => got.data.users.find((u) => u.name.toLowerCase() === String(n).toLowerCase() && u.status === "Active");
  const steps = tpl.steps.map((s) => {
    const u = byName(s.assigneeName);
    if (!u) throw new Error(`No active user named "${s.assigneeName}". Add them under Team first.`);
    const { assigneeName, ...rest } = s; // eslint-disable-line no-unused-vars
    return { ...rest, assigneeId: u.userId };
  });
  const res = await runAction(db, actorId, "createFlow", { ...tpl, steps });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function dbFromEnv() {
  return new Db(createSheetsClient(configFromEnv()));
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.log('Usage: node tools/flow-xlsx.mjs "<path to xlsx>" [--dry]'); process.exit(1); }
  const { rows, holidays } = await readWorkbook(file);
  console.log(`Read ${rows.length} POs and ${holidays.length} holiday dates from the workbook.`);
  if (process.argv.includes("--dry")) return;
  const db = dbFromEnv();
  const { Users } = await db.load(["Users"], { fresh: true });
  const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) throw new Error("No Super Admin yet. Open the app once and complete the first-time setup.");
  const flow = await ensureFlow(db, String(boss.userId), loadTemplate());
  console.log(`FMS: ${flow.name} (${flow.flowId})`);
  const h = await runAction(db, String(boss.userId), "addHolidays", { dates: holidays, label: "Imported from workbook" });
  console.log("Holidays:", h.ok ? `${h.data.added} added, ${h.data.skipped} already there` : h.error);
  let added = 0; const skipped = [];
  for (let i = 0; i < rows.length; i += 150) {
    const batch = rows.slice(i, i + 150).map(({ sheetRow, cached, ...r }) => ({ ...r, _row: sheetRow })); // eslint-disable-line no-unused-vars
    const res = await runAction(db, String(boss.userId), "importEntries", { flowId: flow.flowId, rows: batch });
    if (!res.ok) { console.error("Import failed:", res.error); process.exit(1); }
    added += res.data.added;
    res.data.skipped.forEach((s) => skipped.push({ sheetRow: batch[s.row - 1]._row, reason: s.reason }));
    process.stdout.write(`\r  imported ${Math.min(i + 150, rows.length)}/${rows.length}`);
  }
  console.log(`\nDone: ${added} entries added, ${skipped.length} skipped.`);
  skipped.slice(0, 15).forEach((s) => console.log(`  sheet row ${s.sheetRow}: ${s.reason}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
