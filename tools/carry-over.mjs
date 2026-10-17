// Copies the "keep" tabs (people, FMS definitions, settings, holidays, roles, vault, shortcuts, profile data, activity log) from a backup of the OLD live sheet
// into the NEW live sheet. Business data (entries, steps, checklist, attendance, leave, notifications) is NOT copied — it is imported fresh from Drive.
//   node --no-warnings --env-file=.env.live tools/carry-over.mjs .data/backups/live-….json [--yes]
import { readFileSync } from "node:fs";
import { colLetter, configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { TABLES } from "../src/server/sheets/schema.ts";

const file = process.argv[2];
const yes = process.argv.includes("--yes");
if (!file) { console.error("Give the backup file."); process.exit(1); }
const cfg = configFromEnv();
if (cfg.baseUrl) { console.error("Points at the local test sheet — use the live env file."); process.exit(1); }
const backup = JSON.parse(readFileSync(file, "utf8"));
if (backup.sheet === cfg.spreadsheetId) { console.error("The backup is OF the sheet in .env.live — nothing to carry. Point .env.live at the NEW sheet first."); process.exit(1); }
const client = createSheetsClient(cfg);
const KEEP = ["Users", "Flows", "Holidays", "Roles", "Vault_Items", "Vault_Access", "Quick_Links", "Employee_Details", "Profile_Photos", "Saved_Filters", "Audit_Log"];
const activate = new Set(["CRM Advance Order", "CRM Credit Order & Payment"]); // these two have live data now: they must be visible
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`From ${backup.sheet} (${backup.savedAt}) → ${cfg.spreadsheetId}\n`);
for (const t of KEEP) {
  const def = TABLES[t], width = def.cols.length;
  const rows = (backup.tables[t] ?? []).slice(1).filter((r) => r.some((c) => c !== "" && c != null)).map((r) => { const x = r.slice(0, width); while (x.length < width) x.push(""); return x; });
  if (t === "Flows") { const iName = def.cols.findIndex((c) => c[0] === "name"), iSt = def.cols.findIndex((c) => c[0] === "status"); rows.forEach((r) => { if (activate.has(String(r[iName]))) r[iSt] = "Active"; }); }
  console.log(t.padEnd(18), String(rows.length).padStart(6), "rows");
  if (!yes || !rows.length) continue;
  const [have] = await client.batchGet([`${quoteTab(t)}!A2:A3`]);
  if (have.length) { console.log("   (already has rows — skipped)"); continue; }
  for (let i = 0; i < rows.length; i += 400) { await client.append(`${quoteTab(t)}!A:${colLetter(width)}`, rows.slice(i, i + 400)); await sleep(300); }
}
// settings: the new sheet already holds the defaults — put the live values over them
{
  const def = TABLES.Settings;
  const old = (backup.tables.Settings ?? []).slice(1).filter((r) => r[0]);
  console.log("Settings".padEnd(18), String(old.length).padStart(6), "rows");
  if (yes) {
    const [have] = await client.batchGet([`${quoteTab("Settings")}!A2:A`]);
    const idx = new Map(have.map((r, i) => [String(r[0]), i + 2]));
    const upd = [], add = [];
    for (const r of old) { const row = r.slice(0, def.cols.length); while (row.length < def.cols.length) row.push(""); if (idx.has(String(r[0]))) upd.push({ range: `${quoteTab("Settings")}!A${idx.get(String(r[0]))}:D${idx.get(String(r[0]))}`, values: [row.slice(0, 4)] }); else add.push(row); }
    if (upd.length) await client.batchUpdate(upd);
    if (add.length) await client.append(`${quoteTab("Settings")}!A:D`, add);
  }
}
console.log(yes ? "\nDone." : "\nNothing was written. Add --yes.");
