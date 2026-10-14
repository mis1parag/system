import { NextResponse } from "next/server";
import { runTick } from "@/server/domain/system";
import { getDb } from "@/server/runtime";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduler: reminders, overdue alerts, escalations, recurring entries, morning digest.
 * Vercel Cron calls this with  Authorization: Bearer $CRON_SECRET ; an outside pinger can use ?key=$CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key");
  if (!secret || given !== secret) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runTick(getDb())) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Tick failed" }, { status: 500 });
  }
}
