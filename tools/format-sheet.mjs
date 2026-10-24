// Makes the LIVE Google Sheet clear and easy to manage: light colour per group of tabs, a readable header that stays in view, a filter on every tab,
// zebra rows, sensible column widths, photo / PIN-hash / secret columns folded away, and a "Guide" tab (first tab) that explains every tab with live row counts.
// It changes only how the sheet LOOKS (and adds the Guide tab) — no data row is touched. Safe to run again.
//   node --no-warnings --env-file=.env.live tools/format-sheet.mjs --dry      (lists what it would do)
//   node --no-warnings --env-file=.env.live tools/format-sheet.mjs            (does it)
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { TABLE_ORDER } from "../src/server/sheets/schema.ts";
import { bandingRequests, guideRequests, guideRows, tabRequests } from "../src/server/sheets/format.ts";

const dry = process.argv.includes("--dry");
const cfg = configFromEnv();
if (cfg.baseUrl && !process.argv.includes("--allow-fake")) { console.error("This points at the local test sheet. Use the live env file."); process.exit(1); }
const client = createSheetsClient(cfg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tabs = await client.listTabs();
const missing = TABLE_ORDER.filter((t) => !tabs.some((x) => x.title === t));
if (missing.length) console.log("Tabs the app has not created yet (skipped):", missing.join(", "));
console.log(`${tabs.length} tabs found. Will format ${TABLE_ORDER.length - missing.length} of them + the Guide tab.`);
if (dry) { console.log("Dry run — nothing changed."); process.exit(0); }

if (!tabs.some((t) => t.title === "Guide")) { await client.addTabs(["Guide"]); tabs = await client.listTabs(); }
const ids = new Map(tabs.map((t) => [t.title, t.sheetId]));
const bands = await client.bandedRanges();

for (const t of TABLE_ORDER) {
  const id = ids.get(t);
  if (id === undefined) continue;
  await client.formatBatch([...tabRequests(id, t), ...bandingRequests(id, t, bands.filter((b) => b.sheetId === id).map((b) => b.bandedRangeId))]);
  process.stdout.write(`\r  formatted ${t}                    `);
  await sleep(1300); // stay under Google's write limit
}
console.log();

const gid = ids.get("Guide");
const rows = guideRows(ids);
await client.batchUpdate([{ range: `'Guide'!A1:E${rows.length}`, values: rows }], { formulas: true });
await sleep(1000);
await client.formatBatch(guideRequests(gid));
console.log("Guide tab written. Done.");
