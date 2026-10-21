// Switches FMS flows on or off on the LIVE sheet, as the Super Admin (so each change is in the activity log: "FMS switched off").
// A switched-off FMS shows no entries or steps to anybody, sends no reminders, and does not count in the leaderboard.
//   node --no-warnings --env-file=.env.live tools/switch-fms.mjs --off            (shows what would change)
//   node --no-warnings --env-file=.env.live tools/switch-fms.mjs --off --apply    (does it)
//   node --no-warnings --env-file=.env.live tools/switch-fms.mjs --on --apply     (switches all back on)
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";

const args = process.argv.slice(2);
const to = args.includes("--on") ? "Active" : args.includes("--off") ? "Archived" : "";
if (!to) { console.error("Say --off or --on."); process.exit(1); }
const cfg = configFromEnv();
if (cfg.baseUrl) { console.error("This points at the local test sheet. Use the live env file."); process.exit(1); }
const db = new Db(createSheetsClient(cfg));
const { Users, Flows } = await db.load(["Users", "Flows"], { fresh: true });
const sa = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active" && u.deleted !== "Y");
if (!sa) { console.error("No active Super Admin found."); process.exit(1); }
const todo = Flows.filter((f) => f.status !== to);
for (const f of Flows) console.log(`${String(f.name).padEnd(34)} ${f.status === to ? `already ${to === "Active" ? "on" : "off"}` : `-> ${to === "Active" ? "on" : "off"}`}`);
if (!args.includes("--apply")) { console.log(`\n${todo.length} would change. Add --apply to do it.`); process.exit(0); }
let done = 0;
for (const f of todo) {
  const r = await runAction(db, String(sa.userId), "setFlowAccess", { flowId: String(f.flowId), status: to });
  if (!r.ok) { console.error(`${f.name}: ${r.error}`); continue; }
  done++;
}
console.log(`\nDone: ${done} of ${todo.length} changed.`);
process.exit(done === todo.length ? 0 : 1);
