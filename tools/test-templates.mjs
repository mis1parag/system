// Every ready-made template must be accepted by the server, create entries, and plan sensible times.
//   node --no-warnings tools/test-templates.mjs
import { readFileSync, readdirSync } from "node:fs";
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup } from "../src/server/domain/system.ts";

const dir = new URL("../src/lib/templates/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "assignee-fallback.json");

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "tpl", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });
const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234" })).userId;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };

// one active user per distinct assignee name used by any template
const names = new Set();
const defs = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
defs.forEach((d) => d.steps.forEach((s) => names.add(s.assigneeName)));
let n = 0;
for (const name of names) {
  const r = await runAction(db, boss, "saveUser", { name, role: "STAFF", mobile: `90000${String(10000 + n++)}`, pin: "1111" });
  ok(r.ok, `user ${name}: ${r.error}`);
}
const { Users } = await db.load(["Users"], { fresh: true });
const idOf = (name) => String(Users.find((u) => u.name === name).userId);

const day = (off) => new Date(Date.now() + 5.5 * 3600e3 + off * 864e5).toISOString().slice(0, 10);
for (const d of defs) {
  console.log(d.name);
  const payload = { ...d, steps: d.steps.map((s) => ({ ...s, assigneeId: idOf(s.assigneeName) })) };
  const c = await runAction(db, boss, "createFlow", payload);
  ok(c.ok, `${d.name}: createFlow → ${c.error}`);
  if (!c.ok) continue;
  const flowId = c.data.flowId;
  const values = {};
  for (const f of d.fields) {
    if (f.type === "datetime") values[f.key] = `${day(1)} 10:00`;
    else if (f.type === "date") values[f.key] = day(f.key === "dueDate" ? 30 : 7);
    else if (f.type === "number") values[f.key] = "5";
    else if (f.type === "select") values[f.key] = f.options[0];
    else if (f.type === "checkbox") values[f.key] = "";
    else if (f.type === "url") values[f.key] = "https://example.com";
    else if (f.type === "phone") values[f.key] = "9876543210";
    else values[f.key] = `${f.label} 1`;
  }
  const e = await runAction(db, boss, "createEntry", { flowId, data: values });
  ok(e.ok, `${d.name}: createEntry → ${e.error}`);
  if (!e.ok) continue;
  const { Flow_Tasks } = await db.load(["Flow_Tasks"], { fresh: true });
  const mine = Flow_Tasks.filter((t) => t.flowId === flowId);
  ok(mine.length === d.steps.length, `${d.name}: ${mine.length} tasks for ${d.steps.length} steps`);
  for (const s of d.steps) {
    const t = mine.find((x) => x.stepId === s.stepId);
    const cond = !!s.condition;
    const none = s.rule.base === "none";
    if (!t) { ok(false, `${d.name}: no task for ${s.stepId}`); continue; }
    if (cond) ok(t.status === "Skipped", `${d.name}/${s.name}: skipped without the condition (was ${t.status})`);
    else if (none) ok(t.status === "Done", `${d.name}/${s.name}: auto-done`);
    else if (s.rule.base !== "prev_actual") ok(!!t.planned, `${d.name}/${s.name}: planned time exists`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
fake.close();
process.exit(fail ? 1 : 0);
