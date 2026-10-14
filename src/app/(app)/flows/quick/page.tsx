"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, BuildingIcon, ExternalLinkIcon, PencilIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, Field, PageHeader, Spinner } from "@/components/common";
import type { QuickLink } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const TONES = ["bg-[#e4e0ff] text-[#4b3fd6]", "bg-[#d6ecff] text-[#0055bc]", "bg-[#cbf4c9] text-[#0e6245]", "bg-[#fcedb9] text-[#983705]", "bg-[#ffd7da] text-[#a41c4e]", "bg-[#c4f0f0] text-[#0b6a6a]"];
const tone = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

/** One click opens the tool in a new tab. Personal shortcuts are private; company ones are set by whoever manages Quick Access. */
export default function QuickAccessPage() {
  const { data, meId, allow, call } = useFlows();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editPick, setEdit] = useState<QuickLink | { company: boolean } | null | undefined>(undefined);
  const wantAdd = useSearchParams().get("add") === "1" && allow("quick_access", "create");
  const edit = editPick === undefined ? (wantAdd ? { company: false } : null) : editPick;
  const [sorting, setSorting] = useState(false);
  const links = useMemo(() => [...(data?.quickLinks ?? [])].sort((a, b) => (a.favorite === "Y" ? 0 : 1) - (b.favorite === "Y" ? 0 : 1) || Number(a.sortOrder) - Number(b.sortOrder)), [data?.quickLinks]);
  const cats = [...new Set(links.map((l) => l.category).filter(Boolean))].sort();
  const shown = links.filter((l) => (!cat || l.category === cat) && (!q || `${l.title} ${l.category} ${host(l.url)}`.toLowerCase().includes(q.toLowerCase())));
  const mine = shown.filter((l) => l.ownerId === meId), company = shown.filter((l) => !l.ownerId);
  const manage = allow("quick_access", "manage");

  async function star(l: QuickLink) {
    const r = await call("saveLink", { linkId: l.linkId, title: l.title, url: l.url, category: l.category, favorite: l.favorite !== "Y" });
    if (!r.ok) toast.error(r.error || "Could not save");
  }
  async function adopt(l: QuickLink) {
    const r = await call("adoptLink", { linkId: l.linkId });
    if (!r.ok) toast.error(r.error || "Could not add"); else toast.success("Added to your shortcuts");
  }
  async function remove(l: QuickLink) {
    if (!window.confirm(`Remove “${l.title}”?`)) return;
    const r = await call("deleteLink", { linkId: l.linkId });
    if (!r.ok) toast.error(r.error || "Could not remove");
  }
  async function move(list: QuickLink[], i: number, by: -1 | 1) {
    const ids = list.map((x) => x.linkId);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const r = await call("reorderLinks", { ids });
    if (!r.ok) toast.error(r.error || "Could not reorder");
  }

  const tile = (l: QuickLink, list: QuickLink[]) => {
    const own = l.ownerId === meId;
    const canChange = own || (!l.ownerId && manage);
    return (
      <div key={l.linkId} className="group relative flex items-center gap-3 rounded-lg border bg-card p-3 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)] transition-shadow hover:shadow-[0_2px_8px_rgba(60,66,87,0.14)]">
        <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold", tone(l.title))}>{l.title.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0"><span className="flex items-center gap-1.5 truncate text-sm font-semibold">{l.title}<ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></span><span className="block truncate text-xs text-muted-foreground">{host(l.url)}{!l.ownerId ? " · company" : ""}</span></span>
        </a>
        <div className="flex shrink-0 items-center">
          {sorting && canChange ? (<><button aria-label="Move earlier" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => move(list.filter((x) => x.ownerId === l.ownerId), list.filter((x) => x.ownerId === l.ownerId).indexOf(l), -1)}><ArrowUpIcon className="size-4" /></button><button aria-label="Move later" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => move(list.filter((x) => x.ownerId === l.ownerId), list.filter((x) => x.ownerId === l.ownerId).indexOf(l), 1)}><ArrowDownIcon className="size-4" /></button></>) : (
            <>
              {own ? <button aria-label={l.favorite === "Y" ? "Remove from favorites" : "Add to favorites"} className="rounded p-1.5 hover:bg-muted" onClick={() => star(l)}><StarIcon className={cn("size-4", l.favorite === "Y" ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} /></button>
                : <button aria-label="Add to my shortcuts" title="Add to my shortcuts" className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={() => adopt(l)}><PlusIcon className="size-4" /></button>}
              {canChange && <button aria-label={`Edit ${l.title}`} className="rounded p-1.5 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100" onClick={() => setEdit(l)}><PencilIcon className="size-3.5" /></button>}
              {canChange && allow("quick_access", "delete") && <button aria-label={`Remove ${l.title}`} className="rounded p-1.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-red-700 group-hover:opacity-100 focus:opacity-100" onClick={() => remove(l)}><Trash2Icon className="size-3.5" /></button>}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Quick access"
        subtitle="One click opens the tool in a new tab."
        actions={<>
          {links.length > 1 && <Button variant="outline" onClick={() => setSorting((s) => !s)}>{sorting ? "Done" : "Reorder"}</Button>}
          {manage && <Button variant="outline" onClick={() => setEdit({ company: true })}><BuildingIcon /> Company shortcut</Button>}
          {allow("quick_access", "create") && <Button onClick={() => setEdit({ company: false })}><PlusIcon /> Add shortcut</Button>}
        </>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 max-w-sm flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cats.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
            {["", ...cats].map((c) => <button key={c || "all"} onClick={() => setCat(c)} aria-pressed={cat === c} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", cat === c ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>{c || "All"}</button>)}
          </div>
        )}
      </div>
      {links.length === 0 && <EmptyState title="No shortcuts yet" hint="Add the tools you open every day — Shopify, Google Sheets, your CRM — and they are one click away." action={allow("quick_access", "create") ? <Button onClick={() => setEdit({ company: false })}><PlusIcon /> Add shortcut</Button> : undefined} />}
      {links.length > 0 && shown.length === 0 && <EmptyState title="Nothing matches" hint="Try another word or category." />}
      {mine.length > 0 && <section className="mb-5"><h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mine</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{mine.map((l) => tile(l, mine))}</div></section>}
      {company.length > 0 && <section className="mb-5"><h2 className="mb-2 text-sm font-semibold text-muted-foreground">Company</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{company.map((l) => tile(l, company))}</div></section>}
      {edit && <LinkDialog target={edit} cats={cats} onClose={() => setEdit(null)} />}
    </>
  );
}

function LinkDialog({ target, cats, onClose }: { target: QuickLink | { company: boolean }; cats: string[]; onClose: () => void }) {
  const { call } = useFlows();
  const existing = "linkId" in target ? target : undefined;
  const company = existing ? !existing.ownerId : (target as { company: boolean }).company;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [url, setUrl] = useState(existing?.url ?? "https://");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const r = await call("saveLink", { linkId: existing?.linkId, title, url, category, company, favorite: existing?.favorite === "Y" });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success("Saved");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Edit shortcut" : company ? "New company shortcut" : "New shortcut"}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (title.trim() && url.trim()) save(); }}>
          <Field label="Name"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shopify" autoFocus /></Field>
          <Field label="Address"><Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" /></Field>
          <Field label="Category (optional)"><Input list="quick-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Sales, Accounts, Marketplaces…" /><datalist id="quick-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
          {company && <p className="text-xs text-muted-foreground">Everyone who has Quick access will see this shortcut.</p>}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !title.trim() || !url.trim()}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
