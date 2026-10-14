"use client";

import { useMemo } from "react";
import { BarList, DataTable, MiniColumns, Section, StatCard } from "@/components/common";
import { flowStats } from "@/lib/flow";
import type { Flow, FlowItem, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { fmtDuration } from "@/lib/dates";
import { pct1 } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FlowDashboard({ flow, items, tasks }: { flow: Flow; items: FlowItem[]; tasks: FlowTask[] }) {
  const { now, userName } = useFlows();
  const n = now();
  const s = useMemo(() => flowStats(flow, items, tasks, n), [flow, items, tasks, n]);
  const groupLabel = flow.fields.find((f) => f.key === flow.groupField)?.label ?? "Group";

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label={flow.openLabel} value={s.open} sub={`${s.entries} entries in view`} />
        <StatCard label={flow.doneLabel} value={s.completed} tone="good" sub={s.avgCycleDays ? `avg ${s.avgCycleDays.toFixed(1)} days start→finish` : undefined} />
        <StatCard label="Overdue steps" value={s.overdue} tone={s.overdue ? "bad" : "good"} sub={`${s.tasksOpen} open steps`} />
        <StatCard label="Due today" value={s.dueToday} tone={s.dueToday ? "warn" : undefined} />
        <StatCard label="On-time rate" value={s.tasksDone ? pct1(s.onTimePct) : "—"} sub={`${s.onTime} of ${s.tasksDone} finished steps`} />
        <StatCard label="Avg delay (late steps)" value={s.avgDelayMin ? fmtDuration(s.avgDelayMin) : "—"} sub={`${s.postponed} postponed · ${s.extended} extended`} />
      </div>

      <Section title="Last 14 days" hint="Steps finished per day (darker = finished late)">
        <MiniColumns points={s.trend.map((t) => ({ label: t.label, value: t.done }))} format={(v) => `${v} steps`} />
        <div className="text-xs text-muted-foreground">{s.trend.reduce((a, t) => a + t.done, 0)} finished, {s.trend.reduce((a, t) => a + t.late, 0)} of them late.</div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Steps" hint="Where entries are stuck and which step runs late">
          <DataTable head={["Step", "Open", "Overdue", "Done", "Late", "Avg delay"]}>
            {s.byStep.map((r) => (
              <tr key={r.step.stepId}>
                <td className="max-w-56"><span className="line-clamp-2 font-medium">{r.step.name}</span><span className="text-xs text-muted-foreground">{userName(r.step.assigneeId)}{r.step.assign?.type === "pool" ? " + pool" : ""}</span></td>
                <td className="tabular-nums">{r.open}</td>
                <td className={cn("tabular-nums", r.overdue && "font-medium text-red-700")}>{r.overdue}</td>
                <td className="tabular-nums">{r.done}</td>
                <td className="tabular-nums">{r.late}</td>
                <td className="tabular-nums">{r.avgDelayMin ? fmtDuration(r.avgDelayMin) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <Section title="People" hint="Open and overdue steps by person (finished steps counted by who completed them)">
          <DataTable head={["Person", "Open", "Overdue", "Done", "Late"]}>
            {s.byPerson.map((r) => (
              <tr key={r.userId}>
                <td className="font-medium">{userName(r.userId)}</td><td className="tabular-nums">{r.open}</td>
                <td className={cn("tabular-nums", r.overdue && "font-medium text-red-700")}>{r.overdue}</td>
                <td className="tabular-nums">{r.done}</td><td className="tabular-nums">{r.late}</td>
              </tr>
            ))}
          </DataTable>
        </Section>
      </div>

      {flow.groupField && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={`Entries by ${groupLabel.toLowerCase()}`}>
            <BarList rows={s.byGroup.slice(0, 12).map((g) => ({ label: g.label, value: g.entries }))} />
          </Section>
          <Section title={`Late by ${groupLabel.toLowerCase()}`} hint="Steps currently overdue + steps that finished late">
            <BarList rows={s.byGroup.filter((g) => g.overdue + g.late > 0).sort((a, b) => b.overdue + b.late - (a.overdue + a.late)).slice(0, 12).map((g) => ({ label: g.label, value: g.overdue + g.late, sub: g.overdue ? `${g.overdue} overdue` : undefined }))} />
          </Section>
        </div>
      )}
    </div>
  );
}
