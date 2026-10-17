// Read-only: counts the rows in each tab of the live Google Sheet, and the entries / open work per FMS.
import { configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
import { TABLES } from "../src/server/sheets/schema.ts";
const client = createSheetsClient(configFromEnv());
const get = async (t) => { const [rows] = await client.batchGet([`${quoteTab(t)}!A1:${String.fromCharCode(64 + Math.min(26, TABLES[t].cols.length))}`]); return rows.slice(1).filter((r) => r[0] !== "" && r[0] != null); };
const col = (t, k) => TABLES[t].cols.findIndex((c) => c[0] === k);
for (const t of ["Users","Flows","Flow_Items","Flow_Tasks","Holidays","Checklist_Tasks","Checklist_Log","Attendance","Leaves","Settings"]) console.log(t.padEnd(18), (await get(t)).length);
const flows = await get("Flows"), items = await get("Flow_Items"), tasks = await get("Flow_Tasks");
console.log("\nFMS".padEnd(44), "status    entries  open  cancelled  pending-tasks");
for (const f of flows) {
  const mine = items.filter((i) => i[col("Flow_Items", "flowId")] === f[0]);
  const st = (s) => mine.filter((i) => i[col("Flow_Items", "status")] === s).length;
  const pend = tasks.filter((t) => t[col("Flow_Tasks", "flowId")] === f[0] && t[col("Flow_Tasks", "status")] === "Pending").length;
  console.log(" ", String(f[col("Flows", "name")]).padEnd(42), String(f[col("Flows", "status")] ?? "").padEnd(9), String(mine.length).padStart(6), String(st("Open")).padStart(6), String(st("Cancelled")).padStart(8), String(pend).padStart(10));
}
