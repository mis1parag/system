import { NextResponse } from "next/server";
import { login } from "@/server/domain/auth";
import { MidapError } from "@/server/sheets/db";
import { getDb } from "@/server/runtime";
import { setSession } from "@/lib/server/session";
import { requestMeta } from "@/lib/server/meta";
import type { Role } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const u = await login(getDb(), String(body.identifier ?? ""), String(body.pin ?? ""), requestMeta(req));
    await setSession({ userId: u.userId, role: u.role as Role, name: u.name });
    return NextResponse.json({ ok: true, user: u });
  } catch (e) {
    if (e instanceof MidapError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.code === "AUTH" || e.code === "LOCKED" ? 401 : 400 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error", code: "SERVER" }, { status: 500 });
  }
}
