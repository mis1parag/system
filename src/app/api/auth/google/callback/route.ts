import { NextResponse } from "next/server";
import { checkClaims, decodeJwtPayload, GOOGLE_TOKEN_URL, googleConfigFromEnv, safeNext } from "@/lib/google-oauth";
import { loginWithGoogle } from "@/server/domain/auth";
import { MidapError } from "@/server/sheets/db";
import { getDb } from "@/server/runtime";
import { setSession, takeOauthState } from "@/lib/server/session";
import { requestMeta } from "@/lib/server/meta";
import type { Role } from "@/lib/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Step 2: Google sends the person back with a one-time code. We check it against the state we stored, trade it for an id_token, verify the claims, and open the matching employee. */
export async function GET(req: Request) {
  const back = (code: string) => NextResponse.redirect(new URL(`/login?google=${code}`, req.url));
  const cfg = googleConfigFromEnv();
  if (!cfg) return back("not_set_up");
  const q = new URL(req.url).searchParams;
  const saved = await takeOauthState();
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = q.get("code") ?? "";
  if (!saved || !code || q.get("state") !== saved.state) return back("expired");
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code", code_verifier: saved.verifier }),
    });
    if (!res.ok) return back("failed");
    const tok = (await res.json()) as { id_token?: string };
    const claims = checkClaims(decodeJwtPayload(tok.id_token ?? ""), { clientId: cfg.clientId, nonce: saved.nonce });
    if (!claims.ok) return back(claims.reason.includes("verified") ? "unverified" : "failed");
    const u = await loginWithGoogle(getDb(), claims.email, requestMeta(req));
    await setSession({ userId: u.userId, role: u.role as Role, name: u.name });
    return NextResponse.redirect(new URL(safeNext(saved.next), req.url));
  } catch (e) {
    if (e instanceof MidapError) return back(e.message === "no_match" ? "no_match" : "failed");
    return back("failed");
  }
}
