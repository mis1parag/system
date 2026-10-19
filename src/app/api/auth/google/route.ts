import { NextResponse } from "next/server";
import { authUrl, googleConfigFromEnv, newPkce, safeNext } from "@/lib/google-oauth";
import { setOauthState } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Step 1 of "Sign in with Google": remember a one-time state / PKCE verifier / nonce, then send the browser to Google. */
export async function GET(req: Request) {
  const cfg = googleConfigFromEnv();
  if (!cfg) return NextResponse.redirect(new URL("/login?google=not_set_up", req.url));
  const p = newPkce();
  await setOauthState({ state: p.state, verifier: p.verifier, nonce: p.nonce, next: safeNext(new URL(req.url).searchParams.get("next")) });
  return NextResponse.redirect(authUrl(cfg, p));
}
