// Creates every FMS that exists as a sheet in your Google Drive (the 15 listed below), from src/lib/templates/*.json.
//   node --no-warnings --env-file=.env.local tools/seed-flows.mjs [--dry] [--all]     (--all also adds the 4 generic example FMS)
// Doers are matched to users by name (Riya, Kunal, Sapna …). Role names in the Drive sheets ("Purchase Assistant", "Pawan") go to the person in
// src/lib/templates/assignee-fallback.json. FMS that already exist (same name) are skipped, so it is safe to run again.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "../src/server/api.ts";
import { dbFromEnv } from "./flow-xlsx.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "src", "lib", "templates");
const DRIVE = ["instamart-blinkit", "crm-advance-order", "crm-credit-order", "purchase-fms", "purchase-indent", "purchase-po-to-payment", "hiring-fms", "inventory-order-fms",
  "amazon-fba-fms", "flipkart-amazon-po-fms", "reconcile-process-fms", "reconcile-return-fms", "amazon-product-launch", "employee-exit", "leave-request"];
const fallback = JSON.parse(readFileSync(path.join(dir, "assignee-fallback.json"), "utf8"));

async function main() {
  const ids = process.argv.includes("--all") ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "assignee-fallback.json").map((f) => f.replace(".json", "")) : DRIVE;
  const defs = ids.map((id) => ({ id, def: JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")) }));
  if (process.argv.includes("--dry")) { defs.forEach(({ id, def }) => console.log(`${def.name.padEnd(30)} ${String(def.steps.length).padStart(2)} steps  (${id})`)); return; }
  const db = dbFromEnv();
  const { Users, Flows } = await db.load(["Users", "Flows"], { fresh: true });
  const boss = Users.find((u) => u.role === "SUPER_ADMIN" && u.status === "Active");
  if (!boss) throw new Error("No Super Admin yet. Open the app once and complete the first-time setup.");
  const people = Users.filter((u) => u.status === "Active");
  const find = (n) => people.find((u) => String(u.name).toLowerCase() === String(n ?? "").toLowerCase());
  const have = new Set(Flows.map((f) => String(f.name).toLowerCase()));
  let made = 0;
  for (const { def } of defs) {
    if (have.has(def.name.toLowerCase())) { console.log(`= ${def.name}: already there`); continue; }
    const notes = new Set();
    const steps = def.steps.map((s) => {
      const u = find(s.assigneeName) ?? find(fallback[s.assigneeName]);
      if (!u) { notes.add(s.assigneeName); }
      else if (!find(s.assigneeName)) notes.add(`${s.assigneeName}→${u.name}`);
      return { ...s, assigneeId: String((u ?? boss).userId) };
    });
    const res = await runAction(db, String(boss.userId), "createFlow", { ...def, steps });
    if (!res.ok) { console.log(`✗ ${def.name}: ${res.error}`); continue; }
    made++;
    console.log(`+ ${def.name} (${steps.length} steps)${notes.size ? `   stand-ins: ${[...notes].join(", ")}` : ""}`);
  }
  console.log(`Created ${made} FMS.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
