// Imports the entries (every PO / shipment / candidate / order) of your Drive FMS workbooks into the matching FMS of the app,
// together with the actual dates already filled in the sheet, so finished work shows as finished and only open work stays open.
//   node --no-warnings --env-file=.env.live tools/import-drive-fms.mjs --dry              → read the workbooks, show what would be added (writes nothing)
//   node --no-warnings --env-file=.env.live tools/import-drive-fms.mjs                    → add everything (rows that already exist are skipped, nothing is deleted)
// Options: --only purchase,hiring,...   --dir <folder with the downloaded .xlsx files> (default .data/drive)
// The workbooks are Google Sheets downloaded as .xlsx (File → Download → Microsoft Excel).
import { createRequire } from "node:module";
import path from "node:path";
import { runAction } from "../src/server/api.ts";
import { dbFromEnv, ensureFlow, loadTemplate, readWorkbook as readInstamart, wall } from "./flow-xlsx.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DIR = opt("--dir", ".data/drive");
const only = opt("--only", "") ? opt("--only", "").split(",") : null;

// ---------- cell helpers ----------
const raw = (v) => (v && typeof v === "object" && !(v instanceof Date) ? (v.result !== undefined ? v.result : v.text ?? v.richText?.map((t) => t.text).join("") ?? "") : v);
const T = (v) => { v = raw(v); return v === null || v === undefined || v instanceof Date ? "" : String(v).trim(); };
const N = (v) => { v = raw(v); const n = Number(v); return v === null || v === undefined || v === "" || v instanceof Date || isNaN(n) ? "" : n; };
/** Date cell → "YYYY-MM-DD HH:MM" wall clock, or "" for blanks / time-only cells (they come back as 1899-12-30 …) / errors. */
const W = (v) => { const s = wall(raw(v) instanceof Date ? raw(v) : v); return s && Number(s.slice(0, 4)) >= 2000 ? s : ""; };
const D = (v) => W(v).slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const yes = (v) => /^(yes|y|true|1|done)/i.test(T(v));

async function open(file) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DIR, file + ".xlsx"));
  return wb;
}

/** Rows of a sheet from `first` on, until `key` is empty for a stretch. */
function eachDataRow(ws, first, key, fn) {
  let blank = 0;
  for (let i = first; i <= ws.rowCount && blank < 25; i++) {
    const row = ws.getRow(i);
    if (!T(row.getCell(key).value)) { blank++; continue; }
    blank = 0;
    fn(row, i);
  }
}

// ---------- the "FMS tab" family: row 6 headers, entries from row 7, Planned / Actual / Status columns per step ----------
const FMS_TAB = {
  purchase: {
    label: "Purchase FMS", file: "purchase", tpl: "purchase-fms", sheet: "FMS", first: 7, key: "B",
    row: (g) => {
      const created = W(g("A")), lead = N(g("F"));
      return { createdAt: created, data: { po: T(g("B")), vendor: T(g("C")), item: T(g("D")), qty: N(g("E")), leadTime: lead, deliveryDate: created ? addDays(created.slice(0, 10), Number(lead) || 0) : "" } };
    },
    actuals: { s2: "H", s3: "L", s4: "P" },
  },
  hiring: {
    label: "Hiring FMS", file: "hiring", tpl: "hiring-fms", sheet: "FMS", first: 7, key: "B",
    row: (g) => ({ createdAt: W(g("A")), data: { candidate: T(g("B")), contact: T(g("C")), post: T(g("D")), applied: D(g("E")) || D(g("A")) } }),
    actuals: { s1: "H", s2: "M", s3: "R", s4: "W" },
  },
  inventory: {
    label: "Inventory Order FMS", file: "inventory", tpl: "inventory-order-fms", sheet: "FMS", first: 7, key: "A",
    row: (g) => ({ createdAt: W(g("B")), data: { inward: T(g("A")), vendor: T(g("C")), phone: T(g("D")), item: T(g("E")), qty: N(g("F")), uom: T(g("G")), urgency: T(g("H")), location: T(g("I")), expected: D(g("K")) || D(g("L")) || D(g("J")) } }),
    actuals: { s2: "P", s3: "U", s4: "Z", s5: "AF" },
  },
  fba: {
    label: "Amazon FBA FMS", file: "fba", tpl: "amazon-fba-fms", sheet: "FMS", first: 7, key: "B",
    row: (g) => ({ createdAt: W(g("A")), data: { shipment: T(g("B")), location: T(g("C")), boxes: N(g("D")), vehicle: T(g("E")), qty: N(g("F")), appointment: W(g("G")), pickup: W(g("H")), mode: T(g("I")) } }),
    actuals: { s1: "K", s2: "O", s3: "S", s4: "W", s5: "AB", s6: "AG" },
  },
  flipkart: {
    label: "Flipkart & Amazon PO FMS", file: "flipkart", tpl: "flipkart-amazon-po-fms", sheet: "FMS", first: 7, key: "B",
    row: (g) => ({ createdAt: W(g("A")), data: { shipment: T(g("B")), boxes: N(g("C")), qty: N(g("D")), pickup: W(g("E")) } }),
    actuals: { s1: "G", s2: "K", s3: "P" },
  },
  "reconcile-process": {
    label: "Reconcile – Process FMS", file: "reconcile", tpl: "reconcile-process-fms", sheet: "Process FMS", first: 7, key: "B",
    row: (g) => {
      const appt = W(g("C")), postponed = yes(g("G")), next = W(g("I"));
      const done1 = !!T(g("K")), done3 = !!(T(g("AB")) || T(g("Y")));
      const a2 = W(g("U"));
      return {
        createdAt: W(g("D")) || appt,
        data: { mode: T(g("A")), po: T(g("B")), appointment: appt, pickup: W(g("D")), warehouse: T(g("E")), lr: T(g("F")) },
        anchorDate: postponed && next ? next : appt, originalAnchor: appt, postponeCount: postponed ? 1 : 0, postponeReason: T(g("J")),
        // this tab has no "Actual" column for steps 1 and 3 — a filled status counts as done, dated by what is known
        extra: { s1: done1 ? (W(g("D")) || appt) : "", s3: done3 ? (a2 || appt) : "" },
      };
    },
    actuals: { s2: "U" },
  },
  "reconcile-return": {
    label: "Reconcile – Return FMS", file: "reconcile", tpl: "reconcile-return-fms", sheet: "Return FMS", first: 7, key: "B",
    row: (g) => ({
      createdAt: W(g("C")) || W(g("D")),
      data: { mode: T(g("A")), po: T(g("B")), raised: W(g("C")) || W(g("D")), appointment: W(g("C")), shippedOn: D(g("E")), returnType: T(g("F")), qtyPcs: N(g("G")), qtyBox: N(g("H")), dn: T(g("J")) },
    }),
    actuals: { s1: "L", s2: "Q", s3: "U" },
  },
};

async function fmsTabRows(cfg) {
  const wb = await open(cfg.file);
  const ws = wb.getWorksheet(cfg.sheet);
  if (!ws) throw new Error(`Tab "${cfg.sheet}" not found in ${cfg.file}.xlsx`);
  const rows = [];
  eachDataRow(ws, cfg.first, cfg.key, (row, i) => {
    const g = (c) => row.getCell(c).value;
    const r = cfg.row(g);
    const actuals = {};
    for (const [step, col] of Object.entries(cfg.actuals)) { const a = W(g(col)); if (a) actuals[step] = a; }
    for (const [step, a] of Object.entries(r.extra ?? {})) if (a && !actuals[step]) actuals[step] = a;
    const { extra, ...rest } = r; // eslint-disable-line no-unused-vars
    rows.push({ ...rest, actuals, _row: i });
  });
  return rows;
}

async function instamartRows() {
  const { rows } = await instamartWorkbook();
  return rows.map(({ sheetRow, cached, ...r }) => ({ ...r, _row: sheetRow })); // eslint-disable-line no-unused-vars
}
const instamartWorkbook = () => readInstamart(path.join(DIR, "instamart.xlsx"));

// ---------- the CRM panels: a Feeder tab (one row per order) + one tab per step with the Actual date in column I ----------
const CRM = {
  "crm-advance": {
    label: "CRM Advance Order", file: "crm-advance", tpl: "crm-advance-order",
    steps: { s1: "Ask customer Details and Send E", s2: "Order Punch", s3: "Part Payment before packing", s4: "Send order for packing", s5: "Confirm final payment before di", s6: "Order Dispatch and Inform to Cl", s7: "Feedback" },
    row: (f) => ({ data: { client: f.client, orderId: f.orderId, orderDate: f.orderDate, orderValue: "" } }),
  },
  "crm-credit": {
    label: "CRM Credit Order & Payment", file: "crm-credit", tpl: "crm-credit-order",
    steps: {
      s1: "Take Order Confirmation", s2: "Confirm Dispatch from Vijay", s3: "Order Dispatched", s4: "Send Invoice", s5: "Send Dockit", s6: "Delivery Confirmation", s7: "Feedback",
      s8: "Payment Confirmation (-3 Days)", s9: "Payment Confirmation (I)", s10: "Payment Confirmation (II)", s11: "Payment Confirmation (III)",
      s12: "Part Invoice and Dockit", s13: "Part Order Delivery Confirmatio", s14: "Part Feedback", s15: "Part Payment Confirmation (I)",
    },
    row: (f, plan) => {
      const dueMinus3 = plan.s8 ? plan.s8.slice(0, 10) : "";
      return { data: { client: f.client, orderId: f.orderId, orderDate: f.orderDate, dueDate: dueMinus3 ? addDays(dueMinus3, 3) : "", partDelivery: f.part ? "Yes" : "" } };
    },
  },
};

async function crmRows(cfg) {
  const wb = await open(cfg.file);
  const feeder = wb.getWorksheet("Feeder");
  const actual = {}, planned = {};
  for (const [step, tab] of Object.entries(cfg.steps)) {
    const ws = wb.getWorksheet(tab);
    if (!ws) { console.log(`  (tab "${tab}" not found — step ${step} stays open)`); continue; }
    actual[step] = {}; planned[step] = {};
    eachDataRow(ws, 2, "A", (row) => {
      const id = T(row.getCell("A").value);
      const a = W(row.getCell("I").value), p = W(row.getCell("H").value);
      if (a) actual[step][id] = a;
      if (p) planned[step][id] = p;
    });
  }
  const tracker = wb.getWorksheet("Order Tracker");
  const part = new Set();
  if (tracker) eachDataRow(tracker, 2, "A", (row) => { if (T(row.getCell("F").value) || T(row.getCell("G").value)) part.add(T(row.getCell("A").value)); });
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  eachDataRow(feeder, 2, "A", (row, i) => {
    const id = T(row.getCell("A").value);
    const f = { client: T(row.getCell("B").value), orderId: T(row.getCell("C").value) || id, orderDate: W(row.getCell("D").value), part: part.has(id) };
    const acts = {}, plan = {};
    for (const step of Object.keys(cfg.steps)) { if (actual[step]?.[id]) acts[step] = actual[step][id]; if (planned[step]?.[id]) plan[step] = planned[step][id]; }
    // the sheet sometimes holds day/month the wrong way round (2026-12-02 for 12 Feb): swap when the date is in the future or after the first actual
    const first = Object.values(acts).sort()[0];
    const swap = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(s); return m && Number(m[3]) <= 12 ? `${m[1]}-${m[3]}-${m[2]}${m[4]}` : s; };
    if (f.orderDate && (f.orderDate.slice(0, 10) > today || (first && f.orderDate.slice(0, 10) > first.slice(0, 10)))) { const s = swap(f.orderDate); if (s.slice(0, 10) <= (first ? first.slice(0, 10) : today)) f.orderDate = s; }
    if (!f.client || !f.orderDate) return;
    const r = cfg.row(f, plan);
    rows.push({ createdAt: f.orderDate, ...r, actuals: acts, _row: i });
  });
  return rows;
}

// ---------- run ----------
const JOBS = [
  { id: "instamart", label: "Instamart & Blinkit", tpl: "instamart-blinkit", load: instamartRows },
  ...Object.entries(FMS_TAB).map(([id, c]) => ({ id, label: c.label, tpl: c.tpl, load: () => fmsTabRows(c) })),
  ...Object.entries(CRM).map(([id, c]) => ({ id, label: c.label, tpl: c.tpl, load: () => crmRows(c) })),
];

const db = flag("--dry") ? null : dbFromEnv();
let boss = null, tplData = {};
if (db) {
  const { Users } = await db.load(["Users"], { fresh: true });
  boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) { console.error("No Super Admin yet."); process.exit(1); }
}

for (const job of JOBS) {
  if (only && !only.includes(job.id)) continue;
  console.log(`\n▶ ${job.label}`);
  let rows;
  try { rows = await job.load(); } catch (e) { console.log(`  ✗ could not read: ${e.message}`); continue; }
  const tpl = loadTemplate(job.tpl);
  tplData[job.id] = tpl;
  const stepIds = tpl.steps.map((s) => s.stepId);
  const withAny = rows.filter((r) => Object.keys(r.actuals ?? {}).length).length;
  const stepCounts = stepIds.map((s) => `${s}:${rows.filter((r) => r.actuals?.[s]).length}`).join(" ");
  console.log(`  ${rows.length} entries read · ${withAny} have at least one step done · done per step → ${stepCounts}`);
  const sample = rows[0];
  if (sample) console.log("  first:", JSON.stringify(sample.data).slice(0, 170));
  if (flag("--dry")) continue;
  const flow = await ensureFlow(db, String(boss.userId), tpl);
  let added = 0; const skipped = {};
  for (let i = 0; i < rows.length; i += 120) {
    const batch = rows.slice(i, i + 120).map(({ _row, ...r }) => ({ ...r, source: "import", _row })); // eslint-disable-line no-unused-vars
    const res = await runAction(db, String(boss.userId), "importEntries", { flowId: flow.flowId, rows: batch });
    if (!res.ok) { console.log("  ✗ import failed:", res.error); break; }
    added += res.data.added;
    for (const s of res.data.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
    process.stdout.write(`\r  imported ${Math.min(i + 120, rows.length)}/${rows.length}`);
  }
  console.log(`\n  ✓ ${added} added${Object.keys(skipped).length ? " · skipped: " + Object.entries(skipped).map(([k, n]) => `${n}× ${k}`).join("; ") : ""}`);
}
console.log(flag("--dry") ? "\nDry run — nothing was written." : "\nDone.");
