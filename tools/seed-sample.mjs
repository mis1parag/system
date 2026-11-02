// Fills an EMPTY (just set-up) panel with believable SAMPLE data so every page has something to show: a small team, 4 FMS with entries at different stages,
// checklist tasks (daily / weekly / monthly / one-time) with two weeks of history, two weeks of attendance, leaves, holidays and a welcome notice.
// Everything uses @example.com addresses. The sign-in details of the sample people are written to .data/sample-sign-in.csv (kept out of git).
//   node --no-warnings --env-file=<your env file> tools/seed-sample.mjs --brand "Saral MIS" [--dry]
// It needs the Super Admin to exist (first-time setup done) and refuses to run twice. Remove the sample data later from Team & profiles, each FMS page ("Remove entries")
// and the checklist page ("Remove checklist tasks"), or just start a fresh Google Sheet.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { colLetter, configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { Db, newId } from "../src/server/sheets/db.ts";
import { TABLES } from "../src/server/sheets/schema.ts";
import { runAction } from "../src/server/api.ts";
import { plannedDates } from "../src/lib/checklist-schedule.ts";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const brand = opt("--brand", process.env.NEXT_PUBLIC_BRAND || "");
const dry = args.includes("--dry");
const resume = args.includes("--resume"); // carry on after an interrupted run: whatever is already there is kept
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ist = new Date(Date.now() + 5.5 * 3600e3);
const today = ist.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); // fixed seed: the same sample every time

const cfg = configFromEnv();
if (cfg.baseUrl && !args.includes("--allow-fake")) { console.error("This points at the local test sheet. Use your real env file (or --allow-fake)."); process.exit(1); }
const client = createSheetsClient(cfg);
const db = new Db(client);
const { Users, Flows, Checklist_Tasks, Checklist_Log, Attendance } = await db.load(["Users", "Flows", "Checklist_Tasks", "Checklist_Log", "Attendance"], { fresh: true });
const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
if (!boss) { console.error("No Super Admin yet. Open the app and complete /setup first."); process.exit(1); }
if (!resume && (Users.some((u) => String(u.email) === "aarav@example.com") || Flows.length)) { console.error("This panel already has people or FMS — sample data is only for an empty panel."); process.exit(1); }
const BOSS = String(boss.userId);
const act = async (actor, action, data = {}, now) => { const r = await runAction(db, actor, action, data, now ? { now } : {}); if (!r.ok) throw new Error(`${action}: ${r.error}`); await sleep(350); return r.data; };

// ---------------------------------------------------------------- the team
const TEAM = [
  { key: "aarav", name: "Aarav Mehta", role: "MANAGER", dept: "Sales", mgr: null },
  { key: "meera", name: "Meera Joshi", role: "MANAGER", dept: "Accounts", mgr: null },
  { key: "kavya", name: "Kavya Nair", role: "ADMIN", dept: "HR", mgr: null },
  { key: "rohit", name: "Rohit Verma", role: "STAFF", dept: "Warehouse", mgr: "aarav" },
  { key: "sneha", name: "Sneha Kapoor", role: "STAFF", dept: "Support", mgr: "aarav" },
  { key: "pooja", name: "Pooja Singh", role: "STAFF", dept: "Sales", mgr: "aarav" },
  { key: "nikhil", name: "Nikhil Rao", role: "STAFF", dept: "Accounts", mgr: "meera" },
  { key: "imran", name: "Imran Khan", role: "STAFF", dept: "IT", mgr: "kavya" },
  { key: "divya", name: "Divya Shah", role: "STAFF", dept: "HR", mgr: "kavya" },
];
if (dry) { console.log(`Would add ${TEAM.length} people, 4 FMS, ~13 checklist tasks, attendance, leaves, holidays, 1 notice (today = ${today}).`); process.exit(0); }

const id = {};
const csv = ["Name,Role,Department,Email,Mobile,PIN"];
console.log("People…");
for (const [i, p] of TEAM.entries()) {
  const have = resume ? Users.find((u) => String(u.email) === `${p.key}@example.com`) : null;
  if (have) { id[p.key] = String(have.userId); continue; }
  const pin = String(randomInt(1000, 9999));
  const email = `${p.key}@example.com`, mobile = `90000010${String(10 + i).padStart(2, "0")}`;
  const u = await act(BOSS, "saveUser", { name: p.name, role: p.role, mobile, email, department: p.dept, pin, empCode: `SMP${String(i + 1).padStart(3, "0")}`, managerId: p.mgr ? id[p.mgr] : BOSS, leaveAllot: 12 });
  id[p.key] = String(u.userId);
  csv.push(`${p.name},${p.role},${p.dept},${email},${mobile},${pin}`);
}
mkdirSync(path.join(here, "..", ".data"), { recursive: true });
if (csv.length > 1) writeFileSync(path.join(here, "..", ".data", "sample-sign-in.csv"), csv.join("\n") + "\n");

console.log("Settings, holidays, notice…");
if (brand && !resume) await act(BOSS, "saveSettings", { settings: { COMPANY_NAME: brand } });
const HOL = [[addDays(today, 7), "Diwali (sample)"], [addDays(today, 22), "Gurpurab (sample)"], ["2026-12-25", "Christmas (sample)"]];
if (!resume) for (const [d, label] of HOL) await act(BOSS, "addHolidays", { dates: [d], label });
if (!resume) await act(BOSS, "saveAnnouncement", { title: `Welcome to ${brand || "the panel"}`, body: "This panel is filled with SAMPLE data so you can look around: people, FMS, checklists, attendance. The Super Admin can remove it any time.", audience: "all", tone: "info" });
const holidays = new Set(HOL.map((h) => h[0]));

// ---------------------------------------------------------------- 4 FMS with entries at different stages
console.log("FMS…");
const who = { Sales: id.aarav, Warehouse: id.rohit, Accounts: id.nikhil, Director: BOSS, Support: id.sneha, HR: id.divya, IT: id.imran };
const tpl = (n) => JSON.parse(readFileSync(path.join(here, "..", "src", "lib", "templates", `${n}.json`), "utf8"));
const CUST = ["Shree Traders", "Kapoor & Sons", "Metro Retail", "Green Valley Stores", "Sunrise Agencies", "Patel Brothers", "Urban Mart", "Lotus Enterprises"];
const CITY = ["Delhi", "Jaipur", "Pune", "Lucknow", "Indore", "Surat", "Kochi", "Nagpur"];
const at = (d, h, m = 0) => `${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const DATA = {
  "order-to-delivery": (i, d) => ({ orderNo: `ORD-${1001 + i}`, customer: CUST[i % 8], city: CITY[i % 8], value: 18000 + i * 7300, promise: at(addDays(d, 4), 18) }),
  "vendor-payment": (i, d) => ({ invoice: `INV-${2201 + i}`, vendor: ["Om Packaging", "Kisan Paper Mills", "Vishal Logistics", "Bright Print House"][i % 4], amount: 12500 + i * 4100, dueDate: addDays(d, 6), invoiceLink: `https://example.com/invoices/${2201 + i}` }),
  "customer-complaint": (i, d) => ({ ticket: `TCK-${301 + i}`, customer: CUST[(i + 2) % 8], phone: `98${String(10000000 + i * 137).slice(0, 8)}`, issue: ["Parcel arrived damaged", "Wrong colour delivered", "Invoice amount mismatch", "Delivery is late", "Item missing in the box"][i % 5], severity: ["High", "Medium", "Low"][i % 3], reported: at(d, 11) }),
  "employee-onboarding": (i, d) => ({ employee: ["Anita Desai", "Karan Malhotra", "Ritu Sharma", "Vivek Pandey", "Neha Iyer"][i % 5], role: ["Sales Executive", "Packing Assistant", "Accounts Trainee", "Support Executive", "IT Intern"][i % 5], department: ["Sales", "Operations", "Accounts", "HR", "IT"][i % 5], joiningDate: addDays(d, 5), laptop: i % 2 === 0, phone: `97${String(20000000 + i * 311).slice(0, 8)}` }),
};
for (const t of resume && Flows.length >= 4 ? [] : ["order-to-delivery", "vendor-payment", "customer-complaint", "employee-onboarding"]) {
  const def = tpl(t);
  const steps = def.steps.map((s) => ({ ...s, assigneeId: who[s.assigneeName] ?? BOSS }));
  const flow = await act(BOSS, "createFlow", { ...def, steps });
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const created = addDays(today, -(15 - i * 2));
    const depth = i < 3 ? def.steps.length : 1 + (i % def.steps.length); // the oldest are finished, the others are part-way
    const actuals = {};
    def.steps.slice(0, depth).forEach((s, k) => { const d = addDays(created, k); if (d <= today) actuals[s.stepId] = at(d, 12 + (k % 5), 15 + k * 7); });
    rows.push({ data: DATA[t](i, created), createdAt: at(created, 10), actuals, source: "import" });
  }
  const r = await act(BOSS, "importEntries", { flowId: flow.flowId, rows });
  console.log(`  ${def.name}: ${r.added} entries`);
}

// ---------------------------------------------------------------- checklist: tasks + two weeks of history
console.log("Checklist…");
const START = addDays(today, -14);
const mondayStart = (() => { let d = START; while (dow(d) !== 1) d = addDays(d, 1); return d; })();
const TASKS = [
  ["Check and reply to the order group", "pooja", "D", START, "Sales"], ["Update the stock sheet", "rohit", "D", START, "Warehouse"], ["Daily cash tally", "nikhil", "D", START, "Accounts", "Y"],
  ["Review pending customer tickets", "sneha", "D", START, "Support"], ["Back up shared drive files", "imran", "D", START, "IT"], ["Mark staff attendance in the register", "divya", "D", START, "HR"],
  ["Weekly sales report", "aarav", "W", mondayStart, "Sales"], ["Vendor follow-up calls", "meera", "W", mondayStart, "Accounts"], ["Team attendance review", "kavya", "W", mondayStart, "HR"],
  ["Bank statement reconciliation", "meera", "M", addDays(today, -30), "Accounts", "Y"], ["Send salary data to accounts", "divya", "M", addDays(today, -30), "HR"],
  ["Renew GST certificate", "meera", "O", addDays(today, 18), "Accounts", "Y"], ["Set up laptop for the new joiner", "imran", "O", addDays(today, 4), "IT"], ["Update company profile on the website", "pooja", "O", addDays(today, -6), "Sales"],
];
const made = [];
for (const [title, key, freq, startDate, department, proof] of TASKS) {
  const already = resume ? Checklist_Tasks.find((c) => String(c.title) === title) : null;
  if (already) { made.push({ ctId: String(already.ctId), doerId: id[key], freq, startDate, title, proof: proof === "Y" }); continue; }
  const r = await act(BOSS, "saveChecklistTask", { title, doerId: id[key], freq, startDate, department, proof: proof === "Y" ? "Y" : "N" });
  made.push({ ctId: String(r.task.ctId), doerId: id[key], freq, startDate, title, proof: proof === "Y" });
}
const cal = { off: new Set([0]), holidays };
const stamp = `${today} 09:00:00`;
const hist = [];
for (const t of made) {
  for (const date of plannedDates({ freq: t.freq, startDate: t.startDate }, t.startDate, addDays(today, -1), cal)) {
    const r = rnd(), recent = date >= addDays(today, -2);
    const pending = recent ? r < 0.12 : r < 0.03;
    const late = !pending && r > 0.88;
    const actual = pending ? "" : late ? at(addDays(date, 1), 10 + Math.floor(rnd() * 5), Math.floor(rnd() * 60)) : at(date, 10 + Math.floor(rnd() * 8), Math.floor(rnd() * 60));
    hist.push({ clId: newId("CLG"), ctId: t.ctId, doerId: t.doerId, plannedDate: date, status: pending ? "Pending" : "Done", actual, doneBy: pending ? "" : t.doerId, proof: !pending && t.proof ? "Checked — matches the books" : "", remarks: "", remindedAt: "", createdAt: stamp, updatedAt: stamp, origDate: "", movedBy: "", proofImg: "" });
  }
}
const range = `${quoteTab("Checklist_Log")}!A:${colLetter(TABLES.Checklist_Log.cols.length)}`;
const toRow = (rec) => TABLES.Checklist_Log.cols.map(([k]) => (rec[k] === undefined ? "" : rec[k]));
const haveHistory = resume && Checklist_Log.some((l) => l.status === "Done");
for (let i = 0; i < (haveHistory ? 0 : hist.length); i += 400) { await client.append(range, hist.slice(i, i + 400).map(toRow)); await sleep(800); }
console.log(`  ${made.length} tasks, ${hist.length} past entries`);

// ---------------------------------------------------------------- two weeks of attendance + leaves
console.log("Attendance and leaves…");
const LEAVES = [["pooja", "Full Day", addDays(today, -7), addDays(today, -6), "Approved", "Family function"], ["divya", "Full Day", addDays(today, -3), addDays(today, -3), "Approved", "Doctor appointment"], ["imran", "Full Day", addDays(today, 4), addDays(today, 5), "Pending", "Out of town"], ["rohit", "First Half Day", addDays(today, -10), addDays(today, -10), "Approved", "Bank work"]];
const onLeave = new Set();
for (const [k, , s, e, st] of LEAVES) if (st === "Approved") for (let d = s; d <= e; d = addDays(d, 1)) onLeave.add(`${id[k]}|${d}`);
const haveAtt = resume && Attendance.length > 0;
if (!haveAtt) await act(BOSS, "importLeaves", { rows: LEAVES.map(([k, type, startDate, endDate, status, reason]) => ({ userId: id[k], type, startDate, endDate, status, reason })) });
const att = [];
for (const [i, p] of TEAM.entries()) {
  for (let d = addDays(today, -14); d < today; d = addDays(d, 1)) {
    if (dow(d) === 0 || holidays.has(d) || onLeave.has(`${id[p.key]}|${d}`)) continue;
    const r = rnd();
    if (r < 0.04) continue; // a day with no punch
    const late = r > 0.9;
    const inM = late ? 9 * 60 + 40 + Math.floor(rnd() * 45) : 8 * 60 + 50 + i * 2 + Math.floor(rnd() * 30);
    const outM = 17 * 60 + 30 + Math.floor(rnd() * 75);
    att.push({ userId: id[p.key], checkIn: `${d} ${hm(inM)}`, checkOut: `${d} ${hm(outM)}` });
  }
}
if (!haveAtt) await act(BOSS, "importAttendance", { rows: att });
console.log(`  ${att.length} punches, ${LEAVES.length} leave requests`);
console.log(`\nDone. Sign-in details of the sample people: .data/sample-sign-in.csv (the Super Admin keeps their own PIN).`);
process.exit(0);
