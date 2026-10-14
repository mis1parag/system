"use client";
/* eslint-disable @next/next/no-img-element -- small same-origin pictures with a version in the address; nothing for next/image to optimise */

import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const TONES = ["bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];
const tone = (id: string) => TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

/** A person's picture, or their initials on a soft colour when there is none. */
export function Avatar({ userId, size = 32, className }: { userId: string; size?: number; className?: string }) {
  const { userById } = useFlows();
  const u = userById(userId);
  const name = u?.name ?? userId;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (u?.photoVer) return <img src={`/api/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(u.photoVer)}`} alt={name} style={style} className={cn("shrink-0 rounded-full object-cover", className)} />;
  return <span aria-hidden style={style} className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", tone(userId), className)}>{initials(name)}</span>;
}
