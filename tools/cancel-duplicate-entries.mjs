// When the same entry was imported twice (same value in --field), the OLDER copy is cancelled (the app's own "cancel entry": soft, audited, can be restored) and the newest copy stays.
//   node --no-warnings --env-file=.env.live tools/cancel-duplicate-entries.mjs --flow "Instamart & Blinkit PO Dispatch" --field po          → shows what would be cancelled
//   node --no-warnings --env-file=.env.live tools/cancel-duplicate-entries.mjs --flow "..." --field po --yes                                → does it
import { runAction } from "../src/server/api.ts";
import { dbFromEnv } from "./flow-xlsx.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ""; };
const flowName = opt("--flow"), field = opt("--field");
if (!flowName || !field) { console.error('Usage: --flow "<FMS name>" --field <field key> [--yes]'); process.exit(1); }

const db = dbFromEnv();
const { Users, Flows, Flow_Items } = await db.load(["Users", "Flows", "Flow_Items"], { fresh: true });
const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
const flow = Flows.find((f) => f.name === flowName);
if (!boss || !flow) { console.error("Super Admin or FMS not found."); process.exit(1); }

const byKey = new Map();
Flow_Items.forEach((it, order) => {
  if (it.flowId !== flow.flowId || it.status === "Cancelled") return;
  let data = {}; try { data = JSON.parse(String(it.dataJson || "{}")); } catch { /* ignore */ }
  const k = field.split(",").map((f) => String(data[f.trim()] ?? "").trim().toLowerCase()).join("|");
  if (!k.replaceAll("|", "")) return;
  (byKey.get(k) ?? byKey.set(k, []).get(k)).push({ id: String(it.itemId), order });
});
const old = [];
for (const list of byKey.values()) if (list.length > 1) { list.sort((a, b) => a.order - b.order); old.push(...list.slice(0, -1).map((x) => x.id)); }
console.log(`${flowName}: ${byKey.size} different values, ${old.length} older duplicate copies.`);
if (!args.includes("--yes")) { console.log("Nothing was changed. Add --yes to cancel the older copies."); process.exit(0); }

let done = 0;
for (let i = 0; i < old.length; i += 100) {
  const res = await runAction(db, String(boss.userId), "bulkEntries", { op: "cancel", itemIds: old.slice(i, i + 100), reason: "Duplicate of a fresh import from Drive" });
  if (!res.ok) { console.error("Failed:", res.error); break; }
  done += old.slice(i, i + 100).length;
  process.stdout.write(`\r  cancelled ${done}/${old.length}`);
}
console.log("\nDone.");
