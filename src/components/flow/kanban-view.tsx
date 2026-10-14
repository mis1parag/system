"use client";

import { Pill } from "@/components/common";
import { PriorityPill } from "@/components/flow/fields";
import { delayMinutes, effectiveAssignee, itemData, taskState } from "@/lib/flow";
import type { Flow, FlowItem, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { fmtDT, fmtDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Board: one column per step showing the entries that are waiting on it, plus a Done column. */
export function KanbanView({ flow, items, tasksByItem, onOpen }: { flow: Flow; items: FlowItem[]; tasksByItem: Map<string, FlowTask[]>; onOpen: (id: string) => void }) {
  const { data, userName, now, today } = useFlows();
  const n = now();
  const open = items.filter((i) => i.status === "Open");
  const finished = items.filter((i) => i.status === "Completed").sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const cols = flow.steps.map((step) => ({
    step,
    cards: open.map((item) => ({ item, task: (tasksByItem.get(item.itemId) ?? []).find((t) => t.status === "Pending") }))
      .filter((c) => c.task?.stepId === step.stepId)
      .sort((a, b) => (a.task!.planned || "9").localeCompare(b.task!.planned || "9")),
  }));

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0">
      <div className="flex gap-3" style={{ minWidth: (flow.steps.length + 1) * 272 }}>
        {cols.map(({ step, cards }) => {
          const overdue = cards.filter((c) => taskState(c.task!, n) === "overdue").length;
          return (
            <section key={step.stepId} className="w-64 shrink-0 rounded-xl bg-muted/60 p-2">
              <header className="mb-2 px-1">
                <div className="line-clamp-2 text-xs font-semibold">{step.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">{cards.length} waiting{overdue > 0 && <Pill tone="red">{overdue} overdue</Pill>}</div>
              </header>
              <div className="grid max-h-[60dvh] gap-2 overflow-y-auto">
                {cards.slice(0, 40).map(({ item, task }) => {
                  const st = taskState(task!, n);
                  const eff = effectiveAssignee(task!, data?.absences ?? [], today);
                  const late = delayMinutes(task!, n);
                  const group = flow.groupField ? String(itemData(item)[flow.groupField] ?? "") : "";
                  return (
                    <button key={item.itemId} onClick={() => onOpen(item.itemId)} className={cn("rounded-lg border-l-4 bg-card p-2.5 text-left shadow-sm", st === "overdue" ? "border-l-red-500" : st === "today" ? "border-l-amber-400" : "border-l-blue-300")}>
                      <div className="flex items-start justify-between gap-1"><span className="text-xs font-semibold">{item.title}</span><PriorityPill priority={item.priority} /></div>
                      {group && <div className="text-[11px] text-muted-foreground">{group}</div>}
                      <div className="mt-1 text-[11px] text-muted-foreground">{userName(eff.userId)}{eff.covering ? " (covering)" : ""}</div>
                      <div className="text-[11px]">{task!.planned ? fmtDT(task!.planned) : "No time yet"}{late > 0 && <span className="ml-1 font-medium text-red-700">· {fmtDuration(late)} late</span>}</div>
                    </button>
                  );
                })}
                {cards.length > 40 && <div className="p-1 text-center text-[11px] text-muted-foreground">+{cards.length - 40} more — use the filters</div>}
                {cards.length === 0 && <div className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">Nothing waiting</div>}
              </div>
            </section>
          );
        })}
        <section className="w-64 shrink-0 rounded-xl bg-emerald-50 p-2">
          <header className="mb-2 px-1"><div className="text-xs font-semibold text-emerald-900">{flow.doneLabel}</div><div className="text-[11px] text-emerald-800/70">{finished.length} entries</div></header>
          <div className="grid max-h-[60dvh] gap-2 overflow-y-auto">
            {finished.slice(0, 25).map((item) => (
              <button key={item.itemId} onClick={() => onOpen(item.itemId)} className="rounded-lg border-l-4 border-l-emerald-500 bg-card p-2.5 text-left shadow-sm">
                <div className="text-xs font-semibold">{item.title}</div>
                <div className="text-[11px] text-muted-foreground">Done {fmtDT(item.completedAt)}</div>
              </button>
            ))}
            {finished.length > 25 && <div className="p-1 text-center text-[11px] text-muted-foreground">Latest 25 shown</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
