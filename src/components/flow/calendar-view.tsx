"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/common";
import { taskState } from "@/lib/flow";
import type { Flow, FlowItem, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { addDays, addMonths, fmtDate, fmtMonth, monthEnd, monthOf, monthStart } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Month calendar of planned steps: how heavy each day is, what is late, and what to do on a given day. */
export function CalendarView({ flow, items, tasksByItem, onOpen }: { flow: Flow; items: FlowItem[]; tasksByItem: Map<string, FlowTask[]>; onOpen: (id: string) => void }) {
  const { today, now, userName, data } = useFlows();
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState(today);
  const n = now();
  const holidays = useMemo(() => new Set((data?.holidays ?? []).filter((h) => !h.flowId || h.flowId === flow.flowId).map((h) => h.date)), [data, flow.flowId]);

  const byDay = useMemo(() => {
    const m = new Map<string, { item: FlowItem; task: FlowTask }[]>();
    for (const item of items) {
      if (item.status !== "Open") continue;
      for (const task of tasksByItem.get(item.itemId) ?? []) {
        if (task.status !== "Pending" || !task.planned) continue;
        const d = task.planned.slice(0, 10);
        (m.get(d) ?? m.set(d, []).get(d)!).push({ item, task });
      }
    }
    return m;
  }, [items, tasksByItem]);

  const first = monthStart(month);
  const lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday first
  const days = Array.from({ length: lead + Number(monthEnd(month).slice(8)) }, (_, i) => (i < lead ? null : addDays(first, i - lead)));
  const list = (byDay.get(day) ?? []).sort((a, b) => a.task.planned.localeCompare(b.task.planned));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">{fmtMonth(month)}</div>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeftIcon /></Button>
            <Button size="sm" variant="outline" onClick={() => { setMonth(monthOf(today)); setDay(today); }}>Today</Button>
            <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRightIcon /></Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const rows = byDay.get(d) ?? [];
            const overdue = rows.filter((r) => taskState(r.task, n) === "overdue").length;
            const off = flow.weeklyOff.includes(new Date(d + "T00:00:00Z").getUTCDay()) || holidays.has(d);
            return (
              <button key={d} onClick={() => setDay(d)} className={cn("flex min-h-14 flex-col items-center rounded-lg border p-1 text-xs transition-colors", d === day ? "border-primary bg-primary/10" : "hover:bg-muted", off && "bg-muted/60 text-muted-foreground", d === today && "ring-1 ring-primary")}>
                <span className="font-medium">{Number(d.slice(8))}</span>
                {rows.length > 0 && <span className={cn("mt-0.5 rounded-full px-1.5 text-[10px] font-semibold", overdue ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800")}>{rows.length}</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span><span className="mr-1 inline-block size-2 rounded-full bg-blue-300" />steps planned</span><span><span className="mr-1 inline-block size-2 rounded-full bg-red-300" />day has overdue steps</span><span><span className="mr-1 inline-block size-2 rounded bg-muted" />off day / holiday</span></div>
      </div>
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 text-sm font-semibold">{fmtDate(day, true)} <span className="font-normal text-muted-foreground">· {list.length} step{list.length === 1 ? "" : "s"}</span></div>
        {list.length === 0 && <div className="text-xs text-muted-foreground">Nothing planned on this day.</div>}
        <div className="grid max-h-[55dvh] gap-1.5 overflow-y-auto">
          {list.map(({ item, task }) => (
            <button key={task.taskId} onClick={() => onOpen(item.itemId)} className="rounded-lg border p-2 text-left text-xs hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{flow.steps.find((s) => s.stepId === task.stepId)?.name}</span><Pill tone={taskState(task, n) === "overdue" ? "red" : "blue"}>{task.planned.slice(11)}</Pill></div>
              <div className="text-muted-foreground">{item.title} · {userName(task.assigneeId)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
