// Copies the real work you did on this PC (people and their PINs, FMS, entries, checklist, attendance, holidays, leaves, settings)
// from the local test sheet (.data/fake-sheets.json) into your REAL Google Sheet. Test leftovers are left behind.
//
//   node --no-warnings --env-file=.env.live tools/migrate-to-live.mjs            → shows what would be copied (nothing is written)
//   node --no-warnings --env-file=.env.live tools/migrate-to-live.mjs --yes      → copies it
// Options: --from <file>  --with-notifications  --with-audit  --force (target already has people)  --allow-fake (rehearsal against a fake server)
import { readFileSync, existsSync } from "node:fs";
import { colLetter, configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { TABLES, TABLE_ORDER } from "../src/server/sheets/schema.ts";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const file = opt("--from", ".data/fake-sheets.json");
if (!existsSync(file)) { console.error(`Cannot find ${file}`); process.exit(1); }

const cfg = configFromEnv();
if (cfg.baseUrl && !flag("--allow-fake")) { console.error("SHEETS_API_BASE is set, so this would write into the LOCAL FAKE, not Google. Use the live env file (no SHEETS_API_BASE)."); process.exit(1); }
const state = JSON.parse(readFileSync(file, "utf8"));
const book = Object.values(state)[0];
if (!book) { console.error("The local sheet is empty."); process.exit(1); }

const idx = (table, key) => TABLES[table].cols.findIndex((c) => c[0] === key);
const src = (table) => (book.tabs[table]?.rows ?? []).slice(1).filter((r) => r.some((c) => c !== "" && c != null));

// ---- what stays behind: test leftovers
const SKIP = new Set(["Attendance_Photos", "Profile_Photos", "Employee_Details", "Roles", "Quick_Links", "Saved_Filters", "Vault_Items", "Vault_Access"]);
if (!flag("--with-notifications")) SKIP.add("Notifications");
if (!flag("--with-audit")) SKIP.add("Audit_Log");

const testUsers = new Set(src("Users").filter((r) => /\(test\)/i.test(String(r[idx("Users", "name")]))).map((r) => String(r[0])));
const keep = {
  Users: (r) => !testUsers.has(String(r[0])),
  Attendance: (r) => !testUsers.has(String(r[idx("Attendance", "userId")])) && (r[idx("Attendance", "source")] === "import"), // punches made while testing are not real
  Leaves: (r) => !testUsers.has(String(r[idx("Leaves", "userId")])),
};
const fix = {
  // pictures, roles and personal overrides stay behind, so these must not point at them
  Users: (r) => { const c = [...r]; for (const k of ["photoVer", "roleId", "permsJson"]) { const i = idx("Users", k); if (i >= 0) c[i] = ""; } return c; },
};

const plan = TABLE_ORDER.filter((t) => !SKIP.has(t)).map((t) => {
  const rows = src(t).filter(keep[t] ?? (() => true)).map(fix[t] ?? ((r) => r));
  return { table: t, rows };
});

console.log("\nFrom", file, "→ Google Sheet", cfg.spreadsheetId, "\n");
for (const p of plan) console.log(p.table.padEnd(18), String(p.rows.length).padStart(6), "rows");
console.log("\nLeft behind:", [...SKIP].join(", "), testUsers.size ? `· test users: ${testUsers.size}` : "");
if (!flag("--yes")) { console.log("\nNothing was written. Add --yes to copy."); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = createSheetsClient(cfg);
const db = new Db(client);
const tabs = await client.listTabs();
if (tabs.some((t) => t.title === "Users")) {
  const [existing] = await client.batchGet([`${quoteTab("Users")}!A2:A3`]);
  if (existing.length && !flag("--force")) { console.error("\nThe Google Sheet already has people in it. Not touching it. (Use a new blank sheet, or --force if you are sure.)"); await sleep(300); process.exit(1); }
}
console.log("\nCreating tabs and headers…");
await db.ensureSchema();

for (const p of plan) {
  if (!p.rows.length) continue;
  const range = `${quoteTab(p.table)}!A:${colLetter(TABLES[p.table].cols.length)}`;
  // default settings were written by ensureSchema: replace them by what you had
  if (p.table === "Settings") {
    const [have] = await client.batchGet([`${quoteTab("Settings")}!A2:A`]);
    const known = new Set(have.map((x) => String(x[0])));
    const fresh = p.rows.filter((r) => !known.has(String(r[0])));
    const changed = p.rows.filter((r) => known.has(String(r[0])));
    const data = changed.map((r) => ({ range: `${quoteTab("Settings")}!A${have.findIndex((x) => String(x[0]) === String(r[0])) + 2}:D${have.findIndex((x) => String(x[0]) === String(r[0])) + 2}`, values: [r.slice(0, 4)] }));
    if (data.length) await client.batchUpdate(data);
    if (fresh.length) await client.append(range, fresh);
    console.log("✓", p.table, `(${p.rows.length})`);
    continue;
  }
  for (let i = 0; i < p.rows.length; i += 500) {
    await client.append(range, p.rows.slice(i, i + 500));
    await sleep(350);
  }
  console.log("✓", p.table, `(${p.rows.length})`);
}

// ---- check: count what is in Google now
let bad = 0;
for (const p of plan) {
  if (p.table === "Settings") continue;
  const [got] = await client.batchGet([`${quoteTab(p.table)}!A2:A`]);
  const n = got.filter((r) => r[0] !== "" && r[0] != null).length;
  if (n !== p.rows.length) { bad++; console.error(`✗ ${p.table}: expected ${p.rows.length}, found ${n}`); }
}
const tx = db.begin("system");
tx.stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
tx.audit("Moved from the test setup to live", "Settings", "migration", null, { tables: plan.map((p) => `${p.table}:${p.rows.length}`).join(" ") });
await tx.commit();
console.log(bad ? `\n${bad} table(s) do not match — do not go live yet.` : "\nDone. Every table has the same number of rows as before.");
process.exitCode = bad ? 1 : 0;
