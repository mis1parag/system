import { NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/server/session";
import { recordEvent } from "@/server/domain/auth";
import { getDb } from "@/server/runtime";
import { requestMeta } from "@/lib/server/meta";

export async function POST(req: Request) {
  const session = await getSession();
  if (session) { try { await recordEvent(getDb(), session.userId, "Logout", requestMeta(req)); } catch { /* signing out must always work */ } }
  await clearSession();
  return NextResponse.json({ ok: true });
}
