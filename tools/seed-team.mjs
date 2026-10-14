// Adds your whole team (from tools/team-from-drive.json — taken from the Drive Doer List / Scorecard / Employee Exist sheets).
//   node --no-warnings --env-file=.env.local tools/seed-team.mjs [--dry]
// New people get a random PIN. The sign-in details are written to .data/team-sign-in.csv (kept out of git) — hand them out, then delete the file.
// Safe to run again: people who already exist are updated (department / status), never duplicated.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "../src/server/api.ts";
import { dbFromEnv } from "./flow-xlsx.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEAM = JSON.parse(readFileSync(path.join(here, "team-from-drive.json"), "utf8"));

async function main() {
  const active = TEAM.people.filter((p) => p.status !== "Inactive").length;
  console.log(`${TEAM.people.length} people (${active} active, ${TEAM.people.length - active} left the company).`);
  if (process.argv.includes("--dry")) { TEAM.people.forEach((p) => console.log(`  ${p.name.padEnd(10)} ${String(p.department).padEnd(10)} ${(p.role ?? "STAFF").padEnd(12)} ${p.status ?? "Active"}`)); return; }
  const db = dbFromEnv();
  const { Users } = await db.load(["Users"], { fresh: true });
  const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) throw new Error("No Super Admin yet. Open the app once and complete the first-time setup.");
  const res = await runAction(db, String(boss.userId), "bulkSaveUsers", { rows: TEAM.people });
  if (!res.ok) { console.error("Failed:", res.error); process.exit(1); }
  const { created, updated, skipped, credentials } = res.data;
  console.log(`Added ${created}, updated ${updated}, skipped ${skipped.length}.`);
  skipped.forEach((s) => console.log(`  ${s.name || "row " + s.row}: ${s.reason}`));
  if (credentials.length) {
    mkdirSync(path.join(here, "..", ".data"), { recursive: true });
    const file = path.join(here, "..", ".data", "team-sign-in.csv");
    writeFileSync(file, ["Name,Department,Role,Sign in with,PIN", ...credentials.map((c) => [c.name, c.department, c.role, c.login, c.pin].map((v) => `"${v}"`).join(","))].join("\n"));
    console.log(`Sign-in details for ${credentials.length} new people saved to ${file}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
