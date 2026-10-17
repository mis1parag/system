// Starts everything needed to look at the app on your own PC: the local test sheet (port 8788) and the app (port 3000). Stop with Ctrl+C.
//   npm run local     → then open http://localhost:3000
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync } from "node:fs";

// --live: look at the REAL Google Sheet data (from .env.live) on your own PC instead of the test sheet. What you change there is real.
const live = process.argv.includes("--live");

const kids = [];
const run = (name, args) => {
  const p = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], env: process.env });
  p.on("exit", (code) => { console.log(`\n[${name}] stopped (${code ?? "signal"})`); stop(); });
  kids.push(p);
  return p;
};
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const k of kids) { try { k.kill(); } catch { /* already gone */ } } setTimeout(() => process.exit(0), 300); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);

const busy = (port) => new Promise((res) => { const s = createConnection({ port, host: "127.0.0.1" }); s.on("connect", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
if (await busy(3000)) { console.error("Port 3000 is already in use — another copy of the app is running. Close it first (or just open http://localhost:3000)."); process.exit(1); }
if (live) {
  if (!existsSync(".env.live")) { console.error("There is no .env.live file."); process.exit(1); }
  for (const raw of readFileSync(".env.live", "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(raw.replace(/\r$/, "")); if (m && m[2].trim() !== "") process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ""); }
  process.env.SHEETS_API_BASE = ""; // never the local test sheet
  console.log("LIVE mode: this shows and changes the real Google Sheet data.");
} else if (!(await busy(8788))) { console.log("Starting the local test sheet on port 8788 …"); run("test sheet", ["tools/fake-sheets/server.mjs"]); await new Promise((r) => setTimeout(r, 1500)); }
else if (!live) console.log("The local test sheet is already running (port 8788).");
console.log("Starting the app … open http://localhost:3000 when it says Ready.\n");
run("app", ["node_modules/next/dist/bin/next", "dev"]);
