// Google allows ~60 reads a minute for the whole app. These checks make sure the app asks less, and stays up when Google says "quota exceeded".
//   node --no-warnings tools/test-quota.mjs
import { Db } from "../src/server/sheets/db.ts";

let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };

function stub() {
  const s = { calls: 0, quota: false, delay: 20, client: null };
  s.client = { spreadsheetId: "x", async batchGet(ranges) {
    s.calls++;
    await new Promise((r) => setTimeout(r, s.delay));
    if (s.quota) throw new Error("Google Sheets API 429: Quota exceeded for quota metric 'Read requests'.");
    return ranges.map(() => [["USR-1", "Asha"]]);
  } };
  return s;
}

console.log("\nreads that arrive together share one request");
{
  const s = stub(); const db = new Db(s.client, { ttlMs: 50 });
  await Promise.all(Array.from({ length: 12 }, () => db.load(["Users", "Flows"])));
  ok(s.calls === 1, `12 simultaneous page loads made ${s.calls} Google read(s), not 12`);
  await db.load(["Users"]);
  ok(s.calls === 1, "a load inside the cache time makes no request");
  await new Promise((r) => setTimeout(r, 70));
  await db.load(["Users"]);
  ok(s.calls === 2, "after the cache time one new request is made");
}

console.log("\nwhen Google says quota exceeded");
{
  const s = stub(); const db = new Db(s.client, { ttlMs: 30 });
  await db.load(["Users"]);
  await new Promise((r) => setTimeout(r, 50));
  s.quota = true;
  let served = null, err = null;
  try { served = await db.load(["Users"]); } catch (e) { err = e; }
  ok(!err && served?.Users?.length === 1, "a table read a few seconds ago is served as it is, instead of an error page");
  let freshErr = null;
  try { await db.load(["Users"], { fresh: true }); } catch (e) { freshErr = e; }
  ok(!!freshErr && /429/.test(freshErr.message), "a read that must be fresh (before a write) is NOT served from the cache — it fails honestly");
  let coldErr = null;
  try { await db.load(["Flows"]); } catch (e) { coldErr = e; }
  ok(!!coldErr, "a table never read before cannot be served: the error is shown");
  s.quota = false;
  ok((await db.load(["Flows"])).Flows.length === 1, "when the quota is back it works again, without a restart");
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
