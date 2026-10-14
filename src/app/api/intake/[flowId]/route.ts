import { NextResponse } from "next/server";
import { MidapError } from "@/server/sheets/db";
import { intakeEntry } from "@/server/domain/system";
import { getDb } from "@/server/runtime";

export const maxDuration = 30;

/**
 * Create an entry from outside the app (Google Form via Apps Script, Zapier, another system).
 *   POST /api/intake/FLW-…   header  x-intake-token: <token shown on the FMS edit page>   body { "Field label": "value", … }
 */
export async function POST(req: Request, ctx: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await ctx.params;
  const token = req.headers.get("x-intake-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Send a JSON body" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await intakeEntry(getDb(), flowId, token, body)) });
  } catch (e) {
    if (e instanceof MidapError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.code === "UNAUTHORIZED" ? 401 : e.code === "DUPLICATE_ITEM" ? 409 : 422 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
