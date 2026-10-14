"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2Icon, ClipboardCheckIcon, CornerDownLeftIcon, FileTextIcon, KeyRoundIcon, PlusIcon, SearchIcon, UserIcon, UsersIcon, WorkflowIcon, ZapIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFlows } from "@/lib/flow-store";
import type { FlowItem, FlowTask } from "@/lib/flow-types";
import { cn } from "@/lib/utils";

export interface PaletteLink { href: string; label: string; hint?: string; icon: ReactNode }
interface Hit { key: string; label: string; hint?: string; icon: ReactNode; go: () => void }

/** Ctrl/⌘+K: jump to any page, FMS or person, or find an entry (PO number, client…) from anywhere. */
export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PaletteLink[] }) {
  const router = useRouter();
  const { flows, peopleFor, call, absorb, allow, has } = useFlows();
  const people = peopleFor("employees");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FlowItem[]>([]);
  const [at, setAt] = useState(0);
  const seq = useRef(0);
  const go = (href: string) => { onClose(); router.push(href); };

  // entries: ask the server (all history) once the person has typed 2+ letters
  useEffect(() => {
    if (!open || q.trim().length < 2 || !has("fms")) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await call<{ items: FlowItem[]; tasks: FlowTask[] }>("searchEntries", { q: q.trim() });
      if (mine !== seq.current || !r.ok) return;
      absorb(r.data!.items, r.data!.tasks);
      setFound(r.data!.items.slice(0, 6));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, call, absorb, has]);

  const hits = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase();
    const has = (s: string) => !t || s.toLowerCase().includes(t);
    const has_fms = allow("fms", "view");
    const out: Hit[] = [];
    // quick actions: only the ones this person may do
    const actions: [boolean, string, string, string, ReactNode][] = [
      [allow("fms", "create") && flows.some((f) => !f.archived), "Create an FMS entry", "/flows", "choose the FMS", <PlusIcon key="a1" className="size-4" />],
      [allow("fms", "configure"), "Create an FMS", "/flows/new", "build a new process", <WorkflowIcon key="a2" className="size-4" />],
      [allow("checklist", "create"), "Create a checklist task", "/flows/checklist?add=1", "daily, weekly, one-time", <ClipboardCheckIcon key="a3" className="size-4" />],
      [allow("attendance", "create"), "Mark attendance", "/flows/attendance", "check in / out, apply for leave", <CalendarCheck2Icon key="a4" className="size-4" />],
      [allow("quick_access", "create"), "Add a quick-access shortcut", "/flows/quick?add=1", "one-click link to a tool", <ZapIcon key="a5" className="size-4" />],
      [allow("employees", "view") && people.length > 1, "Search an employee", "/flows/users", "people and profiles", <UsersIcon key="a6" className="size-4" />],
      [allow("vault", "view"), "Open the credential vault", "/flows/vault", "shared logins", <KeyRoundIcon key="a7" className="size-4" />],
    ];
    actions.filter(([ok, label, , hint]) => ok && has(`${label} ${hint}`)).slice(0, t ? 4 : 7).forEach(([, label, href, hint, icon]) => out.push({ key: `act${href}`, label, hint: `Action · ${hint}`, icon, go: () => go(href) }));
    pages.filter((p) => has(`${p.label} ${p.hint ?? ""}`)).slice(0, t ? 5 : 12).forEach((p) => out.push({ key: p.href, label: p.label, hint: p.hint, icon: p.icon, go: () => go(p.href) }));
    (has_fms ? flows : []).filter((f) => !f.archived && has(f.name)).slice(0, 6).forEach((f) => {
      out.push({ key: `f${f.flowId}`, label: f.name, hint: "Open this FMS", icon: <WorkflowIcon className="size-4" />, go: () => go(`/flows/${f.flowId}`) });
      if (t) out.push({ key: `n${f.flowId}`, label: `New entry in ${f.name}`, icon: <PlusIcon className="size-4" />, go: () => go(`/flows/${f.flowId}?new=1`) });
    });
    if (people.length > 1 && t && has_fms) people.filter((u) => has(u.name)).slice(0, 4).forEach((u) => out.push({ key: `u${u.userId}`, label: `${u.name}'s tasks`, hint: u.department, icon: <UserIcon className="size-4" />, go: () => go(`/flows/tasks?who=${u.userId}`) }));
    if (t.length >= 2 && has_fms) found.forEach((i) => out.push({ key: `i${i.itemId}`, label: i.title, hint: flows.find((f) => f.flowId === i.flowId)?.name, icon: <FileTextIcon className="size-4" />, go: () => go(`/flows/${i.flowId}?item=${i.itemId}`) }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pages, flows, people, found, allow]);

  const cur = Math.min(at, Math.max(0, hits.length - 1));
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(cur + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(cur - 1, 0)); }
    else if (e.key === "Enter" && hits[cur]) { e.preventDefault(); hits[cur].go(); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setQ(""); setFound([]); setAt(0); onClose(); } }}>
      <DialogContent className="top-[18%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Quick search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0); if (e.target.value.trim().length < 2) setFound([]); }} onKeyDown={onKey}
            placeholder="Go to a page, an FMS, a person — or type a PO / client name…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div className="max-h-[50dvh] overflow-y-auto p-1.5">
          {hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{q.trim().length < 2 ? "Keep typing…" : "Nothing found. Try a shorter word."}</p>}
          {hits.map((h, i) => (
            <button key={h.key} onClick={h.go} onMouseMove={() => setAt(i)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm", i === cur ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
              <span className="text-muted-foreground">{h.icon}</span>
              <span className="min-w-0 flex-1 truncate">{h.label}</span>
              {h.hint && <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline">{h.hint}</span>}
              {i === cur && <CornerDownLeftIcon className="size-3.5 opacity-60" />}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground"><span>↑ ↓ to move · Enter to open</span><span>Ctrl / ⌘ + K anywhere</span></div>
      </DialogContent>
    </Dialog>
  );
}
