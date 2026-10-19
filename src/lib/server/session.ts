import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "@/lib/types";

const COOKIE = "midap_session";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days — field staff stay signed in

export interface Session { userId: string; role: Role; name: string; exp: number }

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set to a random string of 16+ characters");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encode(s: Omit<Session, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decode(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decode(store.get(COOKIE)?.value);
}

export async function setSession(s: Omit<Session, "exp">) {
  const store = await cookies();
  store.set(COOKIE, encode(s), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

// ---- Google sign-in: the one-time values (state, PKCE verifier, nonce) live in a signed, short-lived cookie between the two redirects ----
const OAUTH_COOKIE = "midap_oauth";
const OAUTH_AGE = 10 * 60;
export interface OauthState { state: string; verifier: string; nonce: string; next: string }

export async function setOauthState(o: OauthState) {
  const body = Buffer.from(JSON.stringify({ ...o, exp: Date.now() + OAUTH_AGE * 1000 })).toString("base64url");
  const store = await cookies();
  store.set(OAUTH_COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: OAUTH_AGE });
}

/** Reads and removes the cookie (it can be used once). Null when missing, tampered with or older than 10 minutes. */
export async function takeOauthState(): Promise<OauthState | null> {
  const store = await cookies();
  const token = store.get(OAUTH_COOKIE)?.value;
  store.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString()) as OauthState & { exp: number };
    return o.exp > Date.now() ? { state: o.state, verifier: o.verifier, nonce: o.nonce, next: o.next } : null;
  } catch { return null; }
}
