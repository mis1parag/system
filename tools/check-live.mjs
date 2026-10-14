// Checks that everything needed to go live is in place — before you deploy.
//   node --no-warnings --env-file=.env.live tools/check-live.mjs            → checks the settings and that Google can be read
//   node --no-warnings --env-file=.env.live tools/check-live.mjs --setup    → also creates the tabs, headers and default settings in the sheet
// It never prints a key or a password.
import { configFromEnv, createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { vaultKey } from "../src/server/vault-crypto.ts";

let bad = 0, warn = 0;
const ok = (m) => console.log("  ✓", m);
const no = (m) => { bad++; console.log("  ✗", m); };
const maybe = (m) => { warn++; console.log("  !", m); };
const env = process.env;

console.log("\nSettings");
env.SHEETS_API_BASE ? no("SHEETS_API_BASE is set — that points the app at the local FAKE sheet. Remove it for live.") : ok("not pointing at the local fake");
(env.AUTH_SECRET ?? "").length >= 32 ? ok("AUTH_SECRET is long enough") : no("AUTH_SECRET missing or shorter than 32 characters");
vaultKey(env) ? ok("VAULT_KEY is valid (the Credential Vault will work)") : no("VAULT_KEY missing or not 64 hex characters — the Credential Vault would stay closed");
env.CRON_SECRET ? ok("CRON_SECRET set (the reminder scheduler can be called safely)") : maybe("CRON_SECRET not set — reminders will only run while someone has the app open");
/^https:\/\//.test(env.APP_URL ?? "") ? ok(`APP_URL is ${env.APP_URL}`) : maybe("APP_URL is not an https address — links in emails / WhatsApp would be wrong (set it after the first deploy)");
env.SETUP_KEY ? ok("SETUP_KEY set (nobody else can claim a fresh install)") : maybe("SETUP_KEY not set — fine if you move your people with migrate-to-live (setup is then closed anyway)");
env.SMTP_URL ? ok("email (SMTP) is set") : maybe("email is not set — alerts stay inside the app (bell) only");

console.log("\nGoogle");
let cfg;
try { cfg = configFromEnv(env); } catch (e) { no(e.message); }
if (cfg) {
  if (cfg.clientEmail) console.log("  · service account:", cfg.clientEmail, "(the sheet must be shared with this email, as Editor)");
  const client = createSheetsClient(cfg);
  try {
    const tabs = await client.listTabs();
    ok(`can open the Google Sheet (${tabs.length} tab${tabs.length === 1 ? "" : "s"}: ${tabs.map((t) => t.title).slice(0, 6).join(", ")})`);
    if (process.argv.includes("--setup")) {
      const r = await new Db(client).ensureSchema();
      ok(`tabs and headers are in place${r.created.length ? ` (created ${r.created.length})` : " (already there)"}`);
    } else if (!tabs.some((t) => t.title === "Users")) maybe("the sheet has no MIDAP tabs yet — they are created by --setup, by migrate-to-live, or on first sign-in setup");
  } catch (e) { no(e.message); }
}
console.log(bad ? `\n${bad} problem(s) to fix before going live.${warn ? ` ${warn} note(s).` : ""}` : `\nReady.${warn ? ` ${warn} note(s) above are optional.` : ""}`);
process.exitCode = bad ? 1 : 0;
