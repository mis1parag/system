import { NextResponse } from "next/server";
import { MidapError } from "@/server/sheets/db";
import { runSetup, setupStatus } from "@/server/domain/system";
import { getDb } from "@/server/runtime";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** First-time setup: reports whether the sheet is reachable and empty, then creates the tabs and the first Super Admin. */
export async function GET() {
  try {
    const st = await setupStatus(getDb());
    return NextResponse.json({ ok: true, ...st, needsKey: !!process.env.SETUP_KEY, demo: !!process.env.SHEETS_API_BASE });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not reach Google Sheets" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (process.env.SETUP_KEY && body.key !== process.env.SETUP_KEY) return NextResponse.json({ ok: false, error: "Wrong setup key", code: "FORBIDDEN" }, { status: 403 });
  try {
    const r = await runSetup(getDb(), { name: body.name, mobile: body.mobile, email: body.email, pin: body.pin, demo: body.demo === true && !!process.env.SHEETS_API_BASE });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof MidapError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Setup failed" }, { status: 500 });
  }
}
