// Google sign-in (OpenID Connect, authorization-code flow with PKCE). Pure helpers — no network, no cookies — so they can be tested on their own.
// The id_token is received straight from Google's token endpoint over TLS in exchange for our one-time code and client secret; its claims are checked here
// (issuer, audience, expiry, nonce, verified e-mail). Signing in with Google only ever opens an EXISTING, Active employee whose e-mail matches — it never creates anyone.
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string }

/** Settings from the environment. Returns null when Google sign-in is not set up (the button then stays hidden and the routes answer "not set up"). */
export function googleConfigFromEnv(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim(), clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const base = (env.APP_URL?.trim() || "").replace(/\/$/, "");
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/auth/google/callback` };
}

const b64u = (b: Buffer) => b.toString("base64url");
export interface Pkce { state: string; nonce: string; verifier: string; challenge: string }
export function newPkce(): Pkce {
  const verifier = b64u(randomBytes(48));
  return { state: b64u(randomBytes(24)), nonce: b64u(randomBytes(24)), verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) };
}

export function authUrl(cfg: GoogleConfig, p: Pkce): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: "openid email profile", state: p.state, nonce: p.nonce,
    code_challenge: p.challenge, code_challenge_method: "S256", prompt: "select_account", access_type: "online",
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

export interface IdClaims { iss?: string; aud?: string | string[]; exp?: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; sub?: string; name?: string; hd?: string }

/** Reads the payload of a JWT (no signature check — see the note at the top). */
export function decodeJwtPayload(token: string): IdClaims | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as IdClaims; } catch { return null; }
}

/** Why a token is not acceptable, or the verified e-mail address. */
export function checkClaims(c: IdClaims | null, o: { clientId: string; nonce: string; nowMs?: number }): { ok: true; email: string; sub: string } | { ok: false; reason: string } {
  if (!c) return { ok: false, reason: "unreadable" };
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") return { ok: false, reason: "wrong issuer" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(o.clientId)) return { ok: false, reason: "wrong audience" };
  if (typeof c.exp !== "number" || c.exp * 1000 < (o.nowMs ?? Date.now()) - 60_000) return { ok: false, reason: "expired" };
  if (!c.nonce || c.nonce !== o.nonce) return { ok: false, reason: "nonce mismatch" };
  if (!(c.email_verified === true || c.email_verified === "true")) return { ok: false, reason: "e-mail not verified by Google" };
  const email = String(c.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, reason: "no e-mail" };
  return { ok: true, email, sub: String(c.sub ?? "") };
}

export { GOOGLE_ERRORS, safeNext } from "./login-messages.ts";
