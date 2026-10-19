// Switches the attendance rules on the LIVE sheet (as the Super Admin, so the change is in the activity log):
//   direct check-in / check-out from the person's own laptop, compulsory camera photo, registered laptops only.
//   node --no-warnings --env-file=.env.live tools/set-attendance-rules.mjs            (shows what would change)
//   node --no-warnings --env-file=.env.live tools/set-attendance-rules.mjs --apply    (does it)
//   add  --photo Y|N  or  --device N  to choose differently
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const want = { ATT_SELF_PUNCH: "Y", ATT_PHOTO: opt("--photo", "R"), ATT_DEVICE_CHECK: opt("--device", "Y") };

const cfg = configFromEnv();
if (cfg.baseUrl) { console.error("This points at the local test sheet. Use the live env file."); process.exit(1); }
const db = new Db(createSheetsClient(cfg));
const { Users, Settings } = await db.load(["Users", "Settings"], { fresh: true });
const sa = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active" && u.deleted !== "Y");
if (!sa) { console.error("No active Super Admin found."); process.exit(1); }
const now = (k) => String(Settings.find((s) => s.key === k)?.value ?? "(default)");
for (const [k, v] of Object.entries(want)) console.log(`${k}: ${now(k)} -> ${v}`);
if (!args.includes("--apply")) { console.log("\nNothing changed. Add --apply to do it."); process.exit(0); }
const r = await runAction(db, String(sa.userId), "saveSettings", { settings: want });
console.log(r.ok ? "\nDone." : `\nFailed: ${r.error}`);
process.exit(r.ok ? 0 : 1);
