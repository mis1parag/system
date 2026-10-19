// Google sign-in: the claim checks and the "which employee does this e-mail open" rule. No network — Google's answer is simulated.
//   node --no-warnings tools/test-google.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup } from "../src/server/domain/system.ts";
import { loginWithGoogle } from "../src/server/domain/auth.ts";
import { authUrl, checkClaims, decodeJwtPayload, googleConfigFromEnv, newPkce } from "../src/lib/google-oauth.ts";
import { GOOGLE_ERRORS, safeNext } from "../src/lib/login-messages.ts";
import { createHash } from "node:crypto";

const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "g", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });
let pass = 0, failed = 0;
const ok = (c, m) => { if (c) pass++; else { failed++; console.log("  ✗ FAIL:", m); } };
const section = (s) => console.log("\n" + s);

// ------------------------------------------------------------------------------------------------ configuration
section("configuration comes from the environment, secrets never from code");
ok(googleConfigFromEnv({}) === null && googleConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "s" }) === null, "without client id, secret and APP_URL, Google sign-in is off");
const cfg = googleConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "secret", APP_URL: "https://fms.example.com/" });
ok(cfg?.redirectUri === "https://fms.example.com/api/auth/google/callback", "the redirect address is APP_URL + /api/auth/google/callback");
const pk = newPkce(), pk2 = newPkce();
ok(pk.state !== pk2.state && pk.verifier !== pk2.verifier && pk.nonce !== pk2.nonce && pk.challenge === createHash("sha256").update(pk.verifier).digest("base64url"), "state, nonce and PKCE verifier are random per attempt; the challenge is S256 of the verifier");
const url = new URL(authUrl(cfg, pk));
ok(url.origin === "https://accounts.google.com" && url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("state") === pk.state && url.searchParams.get("nonce") === pk.nonce && url.searchParams.get("scope") === "openid email profile" && !url.search.includes("secret"), "the Google address carries state, nonce and challenge — and no secret");

// ------------------------------------------------------------------------------------------------ the id_token claims
section("the id_token is accepted only if every claim is right");
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const good = { iss: "https://accounts.google.com", aud: "cid", exp: Math.floor(Date.now() / 1000) + 3000, nonce: "n1", email: "Asha.Verma@Company.com", email_verified: true, sub: "123" };
const chk = (patch, o = {}) => checkClaims(decodeJwtPayload(jwt({ ...good, ...patch })), { clientId: "cid", nonce: "n1", ...o });
ok(chk({}).ok && chk({}).email === "asha.verma@company.com", "a good token gives the e-mail in lower case");
ok(chk({ iss: "accounts.google.com" }).ok, "both Google issuer spellings are accepted");
ok(!chk({ iss: "https://evil.example" }).ok && !chk({ aud: "someone-else" }).ok && !chk({ nonce: "other" }).ok && !chk({ nonce: undefined }).ok, "wrong issuer, audience or nonce is refused");
ok(!chk({ exp: Math.floor(Date.now() / 1000) - 3600 }).ok && !chk({ exp: undefined }).ok, "an expired token is refused");
ok(!chk({ email_verified: false }).ok && !chk({ email_verified: undefined }).ok && chk({ email_verified: "true" }).ok, "an e-mail Google has not verified is refused");
ok(!chk({ email: "" }).ok && !chk({ email: "not-an-address" }).ok, "a missing or malformed e-mail is refused");
ok(decodeJwtPayload("garbage") === null && !checkClaims(null, { clientId: "cid", nonce: "n1" }).ok, "garbage is refused");

// ------------------------------------------------------------------------------------------------ which employee
section("the e-mail opens the one existing, active employee — nobody else, and nobody new");
const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: false })).userId;
const mk = async (name, role, mobile, extra = {}) => { const r = await runAction(db, boss, "saveUser", { name, role, mobile, department: "Sales", pin: "4444", empCode: name.slice(0, 3).toUpperCase() + "1", ...extra }); if (!r.ok) throw new Error(name + ": " + r.error); return r.data.userId; };
const ASHA = await mk("Asha", "STAFF", "9000000011", { email: "asha.verma@company.com" });
const VIKAS = await mk("Vikas", "MANAGER", "9000000012", { email: "vikas@company.com" });
const GONE = await mk("Gone", "STAFF", "9000000013", { email: "gone@company.com" });
const NOMAIL = await mk("Nomail", "STAFF", "9000000014");
const usersBefore = (await db.load(["Users"], { fresh: true })).Users.length;
const a = await loginWithGoogle(db, "ASHA.Verma@Company.com ", { ip: "1.2.3.4" });
ok(a.userId === ASHA && a.role === "STAFF", "the e-mail matches whatever its case or spaces");
ok((await loginWithGoogle(db, "vikas@company.com")).role === "MANAGER", "the role is the employee's own role — Google gives no extra access");
const refused = async (mail) => { try { await loginWithGoogle(db, mail); return false; } catch (e) { return e.code === "AUTH" && e.message === "no_match"; } };
ok(await refused("stranger@gmail.com"), "an e-mail that no employee has is refused");
ok(await refused("asha@company.com") && await refused("asha.verma@company.co"), "near-matches do not open anyone");
await runAction(db, boss, "setUserStatus", { userId: GONE, status: "Inactive" });
ok(await refused("gone@company.com"), "an inactive (exited) employee cannot sign in with Google");
ok((await db.load(["Users"], { fresh: true })).Users.length === usersBefore, "signing in never creates an employee");
// the same e-mail on two employees is not allowed by the app; if it ever happens in the sheet, nobody is opened
const tx = db.begin("t"); const row = (await tx.rows("Users")).find((u) => u.userId === NOMAIL); row.email = "vikas@company.com"; await tx.commit();
ok(await refused("vikas@company.com"), "an address that two employees share opens neither");
const tx2 = db.begin("t"); (await tx2.rows("Users")).find((u) => u.userId === NOMAIL).email = ""; await tx2.commit();
const audit = (await db.load(["Audit_Log"], { fresh: true })).Audit_Log;
ok(audit.some((x) => x.action === "Login (Google)" && x.recordId === ASHA) && audit.filter((x) => x.action === "Google login refused").length >= 4, "every success and every refusal is in the activity log");
ok(!JSON.stringify(audit).includes("secret") && !JSON.stringify(audit).includes("4444"), "the log holds no secret");
const refusals = audit.filter((x) => x.action === "Google login refused");
ok(refusals.some((x) => /no employee with this e-mail/.test(x.after ?? x.details ?? JSON.stringify(x))) && refusals.some((x) => /not active/.test(JSON.stringify(x))), "the log says why it was refused");

// ------------------------------------------------------------------------------------------------ redirects
section("where you land after signing in");
ok(safeNext("/api/slip/SLP-1") === "/api/slip/SLP-1" && safeNext("/flows/attendance?tab=salary") === "/flows/attendance?tab=salary", "a private link inside the app is kept");
ok(safeNext("https://evil.example/x") === "/flows/panel" && safeNext("//evil.example") === "/flows/panel" && safeNext("/\\evil.example") === "/flows/panel" && safeNext("/login") === "/flows/panel" && safeNext(undefined) === "/flows/panel", "another site, a protocol-less address or the login page itself is never followed");
ok(Object.keys(GOOGLE_ERRORS).every((k) => GOOGLE_ERRORS[k].length > 10) && GOOGLE_ERRORS.no_match.includes("not linked"), "every failure code has a plain message");

console.log(`\n${pass} passed, ${failed} failed`);
fake.close();
process.exitCode = failed ? 1 : 0;
