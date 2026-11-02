// The sample-data filler (tools/seed-sample.mjs) on a fresh local panel: it must run once, fill every area, and refuse a second run.
//   node --no-warnings tools/test-sample.mjs
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runSetup } from "../src/server/domain/system.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const base = `http://localhost:${fake.address().port}`;
const db = new Db(createSheetsClient({ spreadsheetId: "sample", baseUrl: base }), { ttlMs: 0 });
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: false });

const run = () => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--no-warnings", path.join(here, "seed-sample.mjs"), "--allow-fake", "--brand", "Test Brand"], { env: { ...process.env, SHEETS_API_BASE: base, GOOGLE_SHEET_ID: "sample" } });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});
const first = await run();
ok(first.code === 0, `the sample filler runs on an empty panel (${first.code}) ${first.code ? first.out.slice(-300) : ""}`);
const t = await db.load(["Users", "Flows", "Flow_Items", "Flow_Tasks", "Checklist_Tasks", "Checklist_Log", "Attendance", "Leaves", "Holidays", "Announcements", "Settings"], { fresh: true });
const done = t.Flow_Items.filter((i) => i.status === "Completed").length;
ok(t.Users.length === 10 && t.Users.filter((u) => String(u.email).endsWith("@example.com")).length === 9, "9 sample people + the owner");
ok(t.Flows.length === 4 && t.Flow_Items.length === 32 && done >= 4 && t.Flow_Items.some((i) => i.status === "Open"), `4 FMS with 32 entries — some finished, some open (${done} finished)`);
ok(t.Flow_Tasks.some((x) => x.status === "Done") && t.Flow_Tasks.some((x) => x.status === "Pending"), "steps are done and pending");
ok(t.Checklist_Tasks.length === 14 && ["D", "W", "M", "O"].every((f) => t.Checklist_Tasks.some((c) => c.freq === f)), "14 checklist tasks of every kind");
ok(t.Checklist_Log.some((l) => l.status === "Done") && t.Checklist_Log.some((l) => l.status === "Pending") && t.Checklist_Log.length > 100, `checklist history and coming entries (${t.Checklist_Log.length})`);
ok(t.Attendance.length > 80 && t.Leaves.length === 4 && t.Holidays.length === 3 && t.Announcements.length === 1, `attendance ${t.Attendance.length}, leaves ${t.Leaves.length}, holidays ${t.Holidays.length}, notices ${t.Announcements.length}`);
ok(t.Settings.find((s) => s.key === "COMPANY_NAME")?.value === "Test Brand", "the company name is set from --brand");
const csv = path.join(here, "..", ".data", "sample-sign-in.csv");
ok(existsSync(csv) && readFileSync(csv, "utf8").split("\n").filter(Boolean).length === 10, "the sign-in list of the sample people is written outside git");
const second = await run();
ok(second.code !== 0 && /already has people/.test(second.out), "a second run is refused (nothing is doubled)");
if (existsSync(csv)) rmSync(csv);
console.log(`\n${pass} passed, ${failed} failed`);
fake.close();
process.exitCode = failed ? 1 : 0;
