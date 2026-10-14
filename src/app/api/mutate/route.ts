import { NextResponse } from "next/server";
import { buildActions, runAction } from "@/server/api";
import { getDb, isLive } from "@/server/runtime";
import { getSession } from "@/lib/server/session";
import { requestMeta } from "@/lib/server/meta";

export const maxDuration = 30;

const KNOWN = new Set(Object.keys(buildActions(true)));

/**
 * Every action (reads like getItemDetail and writes alike). The actor comes from the signed session cookie, never from the body;
 * the server re-checks the actor's role and every record rule.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });
  // a browser sending this from another website is refused (cookies are SameSite=Lax as well)
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ ok: false, error: "Blocked", code: "FORBIDDEN" }, { status: 403 }); } catch { return NextResponse.json({ ok: false, error: "Blocked", code: "FORBIDDEN" }, { status: 403 }); } }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string" || !KNOWN.has(body.action) || body.action === "getFlowData") {
    return NextResponse.json({ ok: false, error: "Unknown action", code: "BAD_ACTION" }, { status: 400 });
  }
  const res = await runAction(getDb(), session.userId, body.action, body.data ?? {}, { live: isLive(), meta: requestMeta(req) });
  const status = res.ok ? 200 : res.code === "UNAUTHORIZED" ? 401 : res.code === "FORBIDDEN" ? 403 : res.code === "SERVER" ? 500 : res.code === "CONFLICT" ? 409 : 422;
  return NextResponse.json(res, { status });
}
