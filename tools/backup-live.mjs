// Saves a copy of EVERY tab of the live Google Sheet into one JSON file (.data/backups/, never in git). Read-only.
//   node --no-warnings --env-file=.env.live tools/backup-live.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { colLetter, configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { TABLES, TABLE_ORDER } from "../src/server/sheets/schema.ts";

const cfg = configFromEnv();
if (cfg.baseUrl) { console.error("This points at the local test sheet, not Google. Use the live env file."); process.exit(1); }
const client = createSheetsClient(cfg);
const tabs = new Set((await client.listTabs()).map((t) => t.title));
const out = { savedAt: new Date().toISOString(), sheet: cfg.spreadsheetId, tables: {} };
for (const t of TABLE_ORDER) {
  if (!tabs.has(t)) continue;
  const [rows] = await client.batchGet([`${quoteTab(t)}!A1:${colLetter(TABLES[t].cols.length)}`]);
  out.tables[t] = rows;
  console.log(t.padEnd(18), String(Math.max(0, rows.length - 1)).padStart(7), "rows");
}
mkdirSync(".data/backups", { recursive: true });
const file = `.data/backups/live-${out.savedAt.slice(0, 16).replace(/[:T]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out));
console.log("\nSaved", file);
