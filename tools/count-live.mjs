// Read-only: counts the rows in each tab of the live Google Sheet.
import { configFromEnv, createSheetsClient, quoteTab } from "../src/server/sheets/client.ts";
const client = createSheetsClient(configFromEnv());
for (const t of ["Users","Flows","Flow_Items","Flow_Tasks","Holidays","Checklist_Tasks","Checklist_Log","Attendance","Leaves","Settings"]) {
  const [rows] = await client.batchGet([`${quoteTab(t)}!A2:A`]);
  console.log(t.padEnd(18), rows.filter((r) => r[0] !== "" && r[0] != null).length);
}
