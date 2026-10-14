import { NextResponse, after } from "next/server";
import { runAction } from "@/server/api";
import { runTick } from "@/server/domain/system";
import { getDb, isLive } from "@/server/runtime";
import { getSession } from "@/lib/server/session";
import { requestMeta } from "@/lib/server/meta";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

let lastTick = 0;

/** Everything this user may see, in one call. ?flowId=FLW-…&all=1 loads a flow's full history. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const params: Record<string, string> = {};
  for (const k of ["flowId", "all", "days"]) if (sp.get(k)) params[k] = sp.get(k)!;
  const res = await runAction(getDb(), session.userId, "getFlowData", params, { live: isLive(), meta: requestMeta(req) });
  if (res.ok) {
    // keep reminders flowing even without a cron job: run the (idempotent) scheduler at most every 10 minutes, after the response is sent
    if (Date.now() - lastTick > 10 * 60_000) {
      lastTick = Date.now();
      after(async () => { try { await runTick(getDb()); } catch { /* the next page load tries again */ } });
    }
    return NextResponse.json({ ok: true, data: res.data });
  }
  return NextResponse.json({ ok: false, error: res.error, code: res.code }, { status: res.code === "UNAUTHORIZED" ? 401 : res.code === "FORBIDDEN" ? 403 : 500 });
}
