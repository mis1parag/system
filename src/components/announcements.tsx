"use client";

import { useEffect, useState } from "react";
import { MegaphoneIcon, XIcon } from "lucide-react";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Ann { annId: string; title: string; body: string; tone: string }
const KEY = "midap-ann-hidden";
const hiddenIds = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]; } catch { return []; } };

/** Notices from the Super Admin, on the Home page. A person can close one on their own device; it never comes back for them. */
export function AnnouncementBar() {
  const { call } = useFlows();
  const [list, setList] = useState<Ann[]>([]);
  const [hidden, setHidden] = useState<string[]>(hiddenIds);
  useEffect(() => { let live = true; call<{ announcements: Ann[] }>("listAnnouncements", {}).then((r) => { if (live && r.ok) setList(r.data!.announcements); }); return () => { live = false; }; }, [call]);
  const shown = list.filter((a) => !hidden.includes(a.annId)).slice(0, 3);
  if (!shown.length) return null;
  const close = (id: string) => { const next = [...hidden, id].slice(-200); setHidden(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: it simply comes back */ } };
  return (
    <div className="mb-4 grid gap-2" aria-label="Announcements">
      {shown.map((a) => (
        <div key={a.annId} className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm", a.tone === "important" ? "border-red-200 bg-red-50 text-red-950" : "border-[#d6ecff] bg-[#f3f9ff] text-[#0b3b73]")}>
          <MegaphoneIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1"><div className="font-semibold">{a.title}</div>{a.body && <p className="whitespace-pre-wrap">{a.body}</p>}</div>
          <button onClick={() => close(a.annId)} aria-label="Hide this notice" className="rounded p-1 opacity-60 hover:opacity-100"><XIcon className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
