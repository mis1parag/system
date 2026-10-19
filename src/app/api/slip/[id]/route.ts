import { NextResponse } from "next/server";
import { runAction } from "@/server/api";
import { getDb } from "@/server/runtime";
import { getSession } from "@/lib/server/session";
import { slipHtml, type SlipDoc } from "@/lib/slip-html";

export const dynamic = "force-dynamic";

/**
 * The private link in the salary-slip e-mail. It only opens for someone who is signed in AND is allowed that slip
 * (its owner once published, or payroll for that person) — getSlip decides, exactly as inside the app. Anyone else gets the same "not found".
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await ctx.params;
  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `/api/slip/${id}`);
    return NextResponse.redirect(login);
  }
  const res = await runAction(getDb(), session.userId, "getSlip", { slipId: id });
  if (!res.ok || !res.data) return new NextResponse("This salary slip is not available to you.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(slipHtml(res.data as unknown as SlipDoc), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } });
}
