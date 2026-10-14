"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Pill } from "@/components/common";
import { DoneDialog } from "@/components/flow/entry-panel";
import { PriorityPill } from "@/components/flow/fields";
import { delayMinutes, effectiveAssignee, itemData, itemStatusLabel, taskData, taskState } from "@/lib/flow";
import type { Flow, FlowItem, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { fmtDT, fmtDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Spreadsheet-style grid, like the original FMS sheet: entry fields, then Planned / Actual / Status / Delay for every step. */
export function SheetView({ flow, items, tasksByItem, onOpen, selected, onToggle, onToggleAll }: {
  flow: Flow; items: FlowItem[]; tasksByItem: Map<string, FlowTask[]>; onOpen: (id: string) => void; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[], on: boolean) => void;
}) {
  const { data, userName, now, today, meId, allow, inReach } = useFlows();
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [compact, setCompact] = useState(false);
  const [done, setDone] = useState<{ task: FlowTask; item: FlowItem } | null>(null);
  const n = now();
  const pages = Math.max(1, Math.ceil(items.length / size));
  const cur = Math.min(page, pages - 1);
  const rows = items.slice(cur * size, cur * size + size);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.itemId));

  function exportCsv() {
    const stepCols = flow.steps.flatMap((s) => [`${s.name} — Planned`, `${s.name} — Actual`, `${s.name} — Done by`, `${s.name} — Delay`, ...(s.completionFields ?? []).map((f) => `${s.name} — ${f.label}`)]);
    const head = ["Entry ID", "Status", "Priority", "Tags", ...flow.fields.map((f) => f.label), ...stepCols];
    const lines = items.map((it) => {
      const d = itemData(it);
      const ts = tasksByItem.get(it.itemId) ?? [];
      return [it.itemId, itemStatusLabel(flow, it), it.priority, it.tags, ...flow.fields.map((f) => String(d[f.key] ?? "")),
        ...flow.steps.flatMap((s) => {
          const t = ts.find((x) => x.stepId === s.stepId);
          const sd = t ? taskData(t) : {};
          return [t?.status === "Skipped" ? "n/a" : t?.planned ?? "", t?.actual ?? "", t?.doneBy ? userName(t.doneBy) : "", t && t.status !== "Skipped" ? (delayMinutes(t, n) ? fmtDuration(delayMinutes(t, n)) : "") : "", ...(s.completionFields ?? []).map((f) => String(sd[f.key] ?? ""))];
        })];
    });
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${flow.name.replace(/[^a-z0-9]+/gi, "-")}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const fixed = "sticky left-0 z-10 bg-card";
  const th = "whitespace-nowrap border-b border-r px-2.5 py-1.5 text-left text-xs font-medium";
  const rs = compact ? 2 : 5;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Hide Who / How / When rows</label>
        <div className="flex items-center gap-2">
          <NativeSelect className="w-28" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">{[25, 50, 100, 200].map((s) => <option key={s} value={s}>{s} rows</option>)}</NativeSelect>
          <Button variant="outline" size="sm" onClick={exportCsv}><DownloadIcon /> Export CSV</Button>
        </div>
      </div>
      <div className="max-h-[70dvh] overflow-auto rounded-xl border bg-card">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-muted">
            <tr>
              <th className={cn(th, fixed, "z-30 bg-muted")} rowSpan={rs}>
                <div className="flex items-center gap-2"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={(e) => onToggleAll(rows.map((r) => r.itemId), e.target.checked)} /> Entry</div>
              </th>
              <th className={th} rowSpan={rs}>Status</th>
              <th className={th} rowSpan={rs}>Priority</th>
              {flow.fields.map((f) => <th key={f.key} className={th} rowSpan={rs}>{f.label}{f.key === flow.anchorField ? " ★" : ""}</th>)}
              {flow.steps.map((s) => <th key={s.stepId} colSpan={4 + ((s.completionFields?.length ?? 0) > 0 ? 1 : 0)} className={cn(th, "bg-primary/10 text-center text-primary")}>{s.name}</th>)}
            </tr>
            {!compact && (
              <>
                <tr>{flow.steps.map((s) => <th key={s.stepId} colSpan={4 + ((s.completionFields?.length ?? 0) > 0 ? 1 : 0)} className={cn(th, "font-normal")}><span className="text-muted-foreground">Who: </span>{userName(s.assigneeId)}{s.assign?.type === "field" ? " (by " + (flow.fields.find((f) => f.key === s.assign?.field)?.label ?? "field") + ")" : s.assign?.type === "pool" ? " (pool)" : ""}</th>)}</tr>
                <tr>{flow.steps.map((s) => <th key={s.stepId} colSpan={4 + ((s.completionFields?.length ?? 0) > 0 ? 1 : 0)} className={cn(th, "font-normal")}><span className="text-muted-foreground">How: </span>{s.how || "—"}</th>)}</tr>
                <tr>{flow.steps.map((s) => <th key={s.stepId} colSpan={4 + ((s.completionFields?.length ?? 0) > 0 ? 1 : 0)} className={cn(th, "font-normal")}><span className="text-muted-foreground">When: </span>{s.whenText || "—"}</th>)}</tr>
              </>
            )}
            <tr>{flow.steps.flatMap((s) => ["Planned", "Actual", "Status", "Delay", ...((s.completionFields?.length ?? 0) > 0 ? ["Details"] : [])].map((h) => <th key={s.stepId + h} className={cn(th, "bg-muted/70 font-semibold")}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const d = itemData(it);
              const ts = tasksByItem.get(it.itemId) ?? [];
              return (
                <tr key={it.itemId} className={cn("border-b hover:bg-muted/30", it.status === "Cancelled" && "opacity-50", selected.has(it.itemId) && "bg-primary/5")}>
                  <td className={cn("border-r px-2.5 py-1.5", fixed, selected.has(it.itemId) && "bg-primary/5")}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" aria-label={`Select ${it.title}`} className="mt-0.5" checked={selected.has(it.itemId)} onChange={() => onToggle(it.itemId)} />
                      <div>
                        <button onClick={() => onOpen(it.itemId)} className="max-w-56 truncate text-left font-medium text-primary hover:underline" title={it.title}>{it.title}</button>
                        <div className="text-[10px] text-muted-foreground">{it.itemId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-r px-2.5 py-1.5"><Pill tone={it.status === "Completed" ? "green" : it.status === "Cancelled" ? "red" : "amber"}>{itemStatusLabel(flow, it)}</Pill></td>
                  <td className="whitespace-nowrap border-r px-2.5 py-1.5">{it.priority === "Normal" ? "" : <PriorityPill priority={it.priority} />}</td>
                  {flow.fields.map((f) => (
                    <td key={f.key} className="whitespace-nowrap border-r px-2.5 py-1.5">{f.type === "datetime" || f.type === "date" ? fmtDT(String(d[f.key] ?? "")) : String(d[f.key] ?? "")}</td>
                  ))}
                  {flow.steps.flatMap((s) => {
                    const t = ts.find((x) => x.stepId === s.stepId);
                    const cols = 4 + ((s.completionFields?.length ?? 0) > 0 ? 1 : 0);
                    if (!t) return Array.from({ length: cols }, (_, k) => <td key={s.stepId + k} className="border-r" />);
                    if (t.status === "Skipped") return [<td key={s.stepId + "x"} colSpan={cols} className="border-r bg-muted/40 px-2.5 py-1.5 text-center italic text-muted-foreground">not applicable</td>];
                    const st = taskState(t, n);
                    const late = delayMinutes(t, n);
                    const eff = effectiveAssignee(t, data?.absences ?? [], today);
                    const canAct = t.status === "Pending" && it.status === "Open" && allow("fms", "edit") && (t.assigneeId === meId || eff.userId === meId || inReach(t.assigneeId, "fms"));
                    const sd = taskData(t);
                    const cells = [
                      <td key={s.stepId + "p"} className="whitespace-nowrap border-r px-2.5 py-1.5">{t.planned ? fmtDT(t.planned) : "—"}{t.extCount > 0 && <span title={`Extended ${t.extCount}×`} className="ml-1 text-violet-700">↻</span>}</td>,
                      <td key={s.stepId + "a"} className="whitespace-nowrap border-r px-2.5 py-1.5">{t.actual ? fmtDT(t.actual) : "—"}</td>,
                      <td key={s.stepId + "s"} className="whitespace-nowrap border-r px-2.5 py-1.5">
                        {t.status === "Done" ? <Pill tone="green">Done</Pill> : canAct && st !== "unplanned" ? (
                          <button onClick={() => setDone({ task: t, item: it })} className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", st === "overdue" ? "bg-red-50 text-red-700 ring-red-200" : "bg-background ring-border hover:bg-muted")}>Mark done</button>
                        ) : <span className="text-muted-foreground">{st === "unplanned" ? "Waiting" : "Pending"}</span>}
                      </td>,
                      <td key={s.stepId + "d"} className={cn("whitespace-nowrap border-r px-2.5 py-1.5", t.status === "Done" && late > 0 && "bg-red-100 text-red-800", t.status === "Pending" && st === "overdue" && "bg-amber-100 text-amber-900")}>{late ? fmtDuration(late) : ""}</td>,
                    ];
                    if ((s.completionFields?.length ?? 0) > 0) {
                      cells.push(<td key={s.stepId + "x"} className="max-w-48 truncate border-r px-2.5 py-1.5 text-muted-foreground" title={Object.entries(sd).map(([k, v]) => `${s.completionFields?.find((f) => f.key === k)?.label ?? k}: ${v}`).join(" · ")}>{Object.values(sd).filter((v) => v !== "").join(" · ")}</td>);
                    }
                    return cells;
                  })}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={3 + flow.fields.length + flow.steps.length * 4} className="px-3 py-10 text-center text-muted-foreground">No entries match the filters</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{items.length ? `${cur * size + 1}–${Math.min(items.length, cur * size + size)} of ${items.length}` : "0 entries"} · red = finished late, amber = overdue now · ↻ = time extended</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeftIcon /></Button>
          <span className="px-1">Page {cur + 1} / {pages}</span>
          <Button variant="outline" size="icon-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRightIcon /></Button>
        </div>
      </div>
      {done && <DoneDialog task={done.task} step={flow.steps.find((s) => s.stepId === done.task.stepId)} itemTitle={done.item.title} onClose={() => setDone(null)} />}
    </>
  );
}
