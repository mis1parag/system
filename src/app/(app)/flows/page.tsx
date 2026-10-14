"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, EyeOffIcon, LayersIcon, PlusIcon, PowerIcon, SearchIcon, UsersRoundIcon, WorkflowIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddTemplatesDialog } from "@/components/flow/add-templates-dialog";
import { EmptyState, PageHeader, Pill, Spinner } from "@/components/common";
import { flowStats } from "@/lib/flow";
import type { Flow } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

/** The one place to open and use every FMS. The Super Admin switches an FMS on or off here and chooses which departments see it. */
export default function FlowsPage() {
  const { flows, data, isSuper, can, now } = useFlows();
  const [tpl, setTpl] = useState(false);
  const [access, setAccess] = useState<Flow | null>(null);
  const [q, setQ] = useState("");
  const n = now();
  const cards = useMemo(() => flows.map((f) => ({
    f, s: flowStats(f, (data?.items ?? []).filter((i) => i.flowId === f.flowId), (data?.tasks ?? []).filter((t) => t.flowId === f.flowId), n),
  })).filter((c) => !q || `${c.f.name} ${c.f.description}`.toLowerCase().includes(q.toLowerCase())), [flows, data, n, q]);
  const active = cards.filter((c) => !c.f.archived);
  const off = cards.filter((c) => c.f.archived);
  const createFms = can("createFms");

  return (
    <>
      <PageHeader
        help={{ id: "fms-list", title: "Each card is one process (FMS)", text: "Tap a card to open it and see its entries — one PO, order or candidate each. “New entry” starts one. The numbers are: open, finished, overdue steps and steps due today. You only see the FMS your department uses." }}
        title="FMS"
        subtitle="Every process you track step by step: who does what, by when, and what is late"
        actions={createFms && <><Button variant="outline" onClick={() => setTpl(true)}><LayersIcon /> Add ready-made FMS</Button><Link href="/flows/new" className={cn(buttonVariants(), "h-9")}><PlusIcon /> Create FMS</Link></>}
      />
      {flows.length > 4 && <div className="relative mb-3 max-w-sm"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-10 pl-8" placeholder="Find an FMS…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {active.length === 0 && (
        <EmptyState
          title={q ? "No FMS matches" : "No FMS yet"}
          hint={q ? "Try another word." : createFms ? "Create your first FMS — you can start from a ready-made template." : isSuper ? "" : "Nothing is switched on for your department yet. Ask the Super Admin."}
          action={createFms && !q ? <div className="flex gap-2"><Button onClick={() => setTpl(true)}><LayersIcon /> Add ready-made FMS</Button><Link href="/flows/new" className={buttonVariants({ variant: "outline" })}>Create FMS</Link></div> : undefined}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {active.map(({ f, s }) => (
          <div key={f.flowId} className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
            <Link href={`/flows/${f.flowId}`} className="block">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><WorkflowIcon className="size-5" /></span>
                  <div className="min-w-0"><div className="truncate font-semibold">{f.name}</div><div className="text-xs text-muted-foreground">{f.steps.length} steps · {f.fields.length} fields</div></div>
                </div>
                <ArrowRightIcon className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              {f.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>}
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <Stat label={f.openLabel} value={data?.counts?.[f.flowId]?.open ?? s.open} />
                <Stat label={f.doneLabel} value={data?.counts?.[f.flowId]?.completed ?? s.completed} />
                <Stat label="Overdue" value={s.overdue} tone={s.overdue ? "bad" : undefined} />
                <Stat label="Due today" value={s.dueToday} tone={s.dueToday ? "warn" : undefined} />
              </div>
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {can("addEntries") && <Link href={`/flows/${f.flowId}?new=1`} className={cn(buttonVariants({ size: "sm" }), "h-9 flex-1")}><PlusIcon /> New entry</Link>}
              <Link href={`/flows/${f.flowId}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-9 flex-1")}>Open</Link>
            </div>
            {isSuper && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 text-xs">
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground"><UsersRoundIcon className="size-3.5 shrink-0" /><span className="truncate">{f.departments.length ? f.departments.join(", ") : "All departments"}</span></span>
                <button className="ml-auto rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10" onClick={() => setAccess(f)}>Who sees it</button>
                <button className="rounded px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-50" onClick={() => setAccess(f)}><PowerIcon className="mr-0.5 inline size-3" />Switch off</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {tpl && <AddTemplatesDialog onClose={() => setTpl(false)} />}
      {isSuper && off.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><EyeOffIcon className="size-4" /> Switched off — employees cannot see these ({off.length})</h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {off.map(({ f }) => (
              <div key={f.flowId} className="flex items-center gap-2 rounded-xl border border-dashed bg-card/60 p-3">
                <Link href={`/flows/${f.flowId}`} className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground hover:text-foreground">{f.name}</Link>
                <Pill tone="gray">Off</Pill>
                <Button size="sm" variant="outline" onClick={() => setAccess(f)}>Switch on…</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {access && <AccessDialog flow={access} onClose={() => setAccess(null)} />}
    </>
  );
}

function AccessDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const { data, call } = useFlows();
  const [on, setOn] = useState(!flow.archived);
  const [deps, setDeps] = useState<string[]>(flow.departments);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const all = data?.departments ?? [];
  async function save() {
    setBusy(true); setErr("");
    const r = await call("setFlowAccess", { flowId: flow.flowId, status: on ? "Active" : "Archived", departments: deps });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(on ? "Saved" : "Switched off — employees no longer see it");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{flow.name}</DialogTitle><DialogDescription>Only you (Super Admin) can see an FMS that is switched off.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-3 rounded-xl border p-3">
            <input type="checkbox" className="size-5 rounded border-input accent-[var(--primary)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <span><span className="block text-sm font-medium">{on ? "Switched on" : "Switched off"}</span><span className="block text-xs text-muted-foreground">{on ? "Employees can open it and add entries." : "Hidden from every employee and Manager. Running entries are kept."}</span></span>
          </label>
          <fieldset className={cn("grid gap-1.5", !on && "opacity-50")} disabled={!on}>
            <legend className="mb-1 text-sm font-medium">Which departments see it?</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="who" checked={deps.length === 0} onChange={() => setDeps([])} /> Everyone</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="who" checked={deps.length > 0} onChange={() => setDeps(deps.length ? deps : all.slice(0, 1))} /> Only these departments</label>
            {deps.length > 0 && <div className="ml-6 grid grid-cols-2 gap-1">{all.map((d) => <label key={d} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-input" checked={deps.includes(d)} onChange={(e) => setDeps(e.target.checked ? [...deps, d] : deps.filter((x) => x !== d))} /> {d}</label>)}</div>}
          </fieldset>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-lg bg-muted/60 px-1 py-1.5">
      <div className={cn("text-lg font-semibold tabular-nums leading-tight", tone === "bad" && "text-red-700", tone === "warn" && "text-amber-700")}>{value}</div>
      <div className="truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
