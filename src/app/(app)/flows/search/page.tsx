"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Pill, Spinner } from "@/components/common";
import { EntryPanel } from "@/components/flow/entry-panel";
import { PriorityPill, TagChips } from "@/components/flow/fields";
import { itemStatusLabel } from "@/lib/flow";
import type { FlowItem, FlowTask } from "@/lib/flow-types";
import { fmtDT } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

export default function SearchPage() {
  const { flows, call, absorb } = useFlows();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hits, setHits] = useState<FlowItem[] | null>(null);
  const [panel, setPanel] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await call<{ items: FlowItem[]; tasks: FlowTask[] }>("searchEntries", { q });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Search failed"); return; }
    absorb(r.data!.items, r.data!.tasks);
    setHits(r.data!.items);
  }

  return (
    <>
      <PageHeader title="Search" subtitle="Find any entry across every FMS and all history — by PO number, name, location, tag…" />
      <form onSubmit={run} className="mb-4 flex gap-2">
        <Input autoFocus className="h-11 flex-1" placeholder="e.g. PO-1234, Pune, urgent" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" className="h-11" disabled={busy || q.trim().length < 2}>{busy ? <Spinner /> : <><SearchIcon /> Search</>}</Button>
      </form>
      {err && <p className="mb-3 text-sm text-red-700">{err}</p>}
      {hits && hits.length === 0 && <EmptyState title="Nothing found" hint="Try a shorter word." />}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {hits?.map((i) => {
          const flow = flows.find((f) => f.flowId === i.flowId);
          return (
            <button key={i.itemId} onClick={() => setPanel(i.itemId)} className="rounded-xl border bg-card p-3 text-left hover:bg-muted/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i.title}</span>
                {flow && <Pill tone="blue">{flow.name}</Pill>}
                <Pill tone={i.status === "Open" ? "amber" : i.status === "Completed" ? "green" : "gray"}>{flow ? itemStatusLabel(flow, i) : i.status}</Pill>
                {i.priority !== "Normal" && <PriorityPill priority={i.priority} />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Added {fmtDT(i.createdAt)}</div>
              {i.tags && <div className="mt-1"><TagChips tags={i.tags} /></div>}
            </button>
          );
        })}
      </div>
      {panel && <EntryPanel itemId={panel} onClose={() => setPanel("")} />}
    </>
  );
}
