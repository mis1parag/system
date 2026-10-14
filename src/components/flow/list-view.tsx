"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/common";
import { DoneDialog, stateTone } from "@/components/flow/entry-panel";
import { PriorityPill, TagChips } from "@/components/flow/fields";
import { delayMinutes, effectiveAssignee, itemData, itemStatusLabel, taskState } from "@/lib/flow";
import type { Flow, FlowItem, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { fmtDT, fmtDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";

const DOT: Record<string, string> = {
  done: "bg-emerald-500 text-white", overdue: "bg-red-500 text-white", today: "bg-amber-400 text-amber-950", upcoming: "bg-blue-100 text-blue-800",
  unplanned: "bg-muted text-muted-foreground", skipped: "bg-transparent text-muted-foreground/50 ring-1 ring-inset ring-muted-foreground/30",
};

/** Card list: one card per entry with a dot per step, the next step to do, and a one-tap Done. */
export function ListView({ flow, items, tasksByItem, onOpen, selected, onToggle }: {
  flow: Flow; items: FlowItem[]; tasksByItem: Map<string, FlowTask[]>; onOpen: (id: string) => void; selected: Set<string>; onToggle: (id: string) => void;
}) {
  const { data, userName, now, today, meId, allow, inReach } = useFlows();
  const [limit, setLimit] = useState(40);
  const [done, setDone] = useState<{ task: FlowTask; item: FlowItem } | null>(null);
  const n = now();

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {items.slice(0, limit).map((item) => {
          const tasks = tasksByItem.get(item.itemId) ?? [];
          const next = tasks.find((t) => t.status === "Pending");
          const nextStep = next ? flow.steps.find((s) => s.stepId === next.stepId) : undefined;
          const st = next ? taskState(next, n) : "done";
          const eff = next ? effectiveAssignee(next, data?.absences ?? [], today) : null;
          const canAct = !!next && item.status === "Open" && allow("fms", "edit") && (next.assigneeId === meId || eff?.userId === meId || inReach(next.assigneeId, "fms"));
          const prev = next ? [...tasks.slice(0, tasks.indexOf(next))].reverse().find((t) => t.status !== "Skipped") : undefined;
          const blocked = !!nextStep?.sequential && !!prev && prev.status !== "Done";
          const group = flow.groupField ? String(itemData(item)[flow.groupField] ?? "") : "";
          const late = next ? delayMinutes(next, n) : 0;
          return (
            <div key={item.itemId} className={cn("rounded-xl border bg-card p-3", item.status === "Cancelled" && "opacity-60", selected.has(item.itemId) && "ring-2 ring-primary")}>
              <div className="flex items-start gap-2.5">
                <input type="checkbox" aria-label={`Select ${item.title}`} className="mt-1 size-4 shrink-0 rounded border-input" checked={selected.has(item.itemId)} onChange={() => onToggle(item.itemId)} />
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(item.itemId)}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{item.title}</span>
                    <Pill tone={item.status === "Completed" ? "green" : item.status === "Cancelled" ? "red" : "amber"}>{itemStatusLabel(flow, item)}</Pill>
                    <PriorityPill priority={item.priority} />
                    {item.postponeCount > 0 && <Pill tone="violet">Postponed</Pill>}
                    <TagChips tags={item.tags} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {group && <>{group} · </>}{flow.anchorField ? <>{flow.fields.find((f) => f.key === flow.anchorField)?.label}: {fmtDT(item.anchorDate)}</> : item.createdAt.slice(0, 10)}
                  </div>
                </button>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1" style={{ maxWidth: 160 }} aria-label="Step progress">
                  {tasks.map((t, i) => {
                    const s = taskState(t, n);
                    return <span key={t.taskId} title={`${flow.steps.find((x) => x.stepId === t.stepId)?.name} — ${s}`} className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-semibold", DOT[s])}>{s === "done" ? <CheckIcon className="size-3" /> : i + 1}</span>;
                  })}
                </div>
              </div>
              {next && item.status === "Open" && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1 text-xs">
                    <span className="text-muted-foreground">Next: </span><span className="font-medium">{nextStep?.name}</span>
                    <div className="truncate text-muted-foreground">
                      {userName(eff?.userId ?? next.assigneeId)}{eff?.covering ? " (covering)" : ""}{next.planned ? ` · ${fmtDT(next.planned)}` : ""}
                      {late > 0 && <span className="ml-1 font-medium text-red-700">· late {fmtDuration(late)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Pill tone={stateTone(st)}>{st === "overdue" ? "Overdue" : st === "today" ? "Today" : st === "upcoming" ? "Upcoming" : "Waiting"}</Pill>
                    {canAct && !blocked && <Button size="sm" className="h-8" onClick={() => setDone({ task: next, item })}><CheckIcon /> Done</Button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {items.length > limit && <div className="mt-3 text-center"><Button variant="outline" onClick={() => setLimit(limit + 60)}>Show more ({items.length - limit} left)</Button></div>}
      {done && <DoneDialog task={done.task} step={flow.steps.find((s) => s.stepId === done.task.stepId)} itemTitle={done.item.title} onClose={() => setDone(null)} />}
    </>
  );
}
