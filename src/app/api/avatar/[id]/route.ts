import { NextResponse } from "next/server";
import { runAction } from "@/server/api";
import { getDb } from "@/server/runtime";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** A profile picture (small JPEG). The page asks for /api/avatar/<userId>?v=<version>, so a new picture gets a new address and the old one can be cached for a long time. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;
  const res = await runAction(getDb(), session.userId, "getAvatar", { userId: id });
  const image = (res.data as { image?: string } | undefined)?.image;
  if (!res.ok || !image) return new NextResponse(null, { status: 404 });
  const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  return new NextResponse(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" } });
}
