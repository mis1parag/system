"use client";

import { useMemo, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BarList, DataTable, Field, PageHeader, Section, StatCard } from "@/components/common";
import { flowStats, scorecards } from "@/lib/flow";
import { addDays, fmtDuration } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/filters";
import { useFlows, useRequireCap } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

const tone = (score: number) => (score >= 90 ? "text-emerald-700" : score >= 70 ? "text-amber-700" : "text-red-700");

export default function InsightsPage() {
  const ok = useRequireCap("viewInsights");
  const { data, flows, now, today, userName, inReach, allow, call } = useFlows();
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [flowId, setFlowId] = useState("");
  const n = now();
  const scope = useMemo(() => flows.filter((f) => !flowId || f.flowId === flowId), [flows, flowId]);
  const ids = useMemo(() => new Set(scope.map((f) => f.flowId)), [scope]);
  const items = useMemo(() => (data?.items ?? []).filter((i) => ids.has(i.flowId)), [data, ids]);
  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => ids.has(t.flowId)), [data, ids]);
  const cards = useMemo(() => scorecards(scope, items, tasks, from, to, n).filter((c) => inReach(c.userId, "work")), [scope, items, tasks, from, to, n, inReach]);
  const perFlow = useMemo(() => scope.map((f) => ({ f, s: flowStats(f, items.filter((i) => i.flowId === f.flowId), tasks.filter((t) => t.flowId === f.flowId), n) })), [scope, items, tasks, n]);
  if (!ok) return null;

  const total = cards.reduce((a, c) => ({ due: a.due + c.due, onTime: a.onTime + c.doneOnTime, late: a.late + c.doneLate, overdue: a.overdue + c.overdue }), { due: 0, onTime: 0, late: 0, overdue: 0 });
  const overall = total.due ? Math.round((total.onTime / total.due) * 100) : 0;

  async function exportCsv() {
    const rows = [["Person", "Steps due", "Done on time", "Done late", "Pending", "Overdue", "On-time %", "Avg delay (min)", "Score"], ...cards.map((c) => [userName(c.userId), c.due, c.doneOnTime, c.doneLate, c.pending, c.overdue, c.onTimePct.toFixed(1), Math.round(c.avgDelayMin), c.score])];
    downloadCsv(`insights-${from}-to-${to}.csv`, toCsv(rows[0] as string[], rows.slice(1) as (string | number)[][]));
    await call("logExport", { module: "reports", rows: rows.length - 1, what: "Insights" });
  }

  return (
    <>
      <PageHeader title="Insights" subtitle="Who delivers on time, which FMS runs late. Score = steps finished on time ÷ steps that were due." actions={allow("reports", "export") && <Button variant="outline" onClick={exportCsv}><DownloadIcon /> Export CSV</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Steps planned from"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="to"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="FMS" className="col-span-2 md:col-span-1"><NativeSelect value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">All FMS</option>{flows.map((f) => <option key={f.flowId} value={f.flowId}>{f.name}</option>)}</NativeSelect></Field>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="Team score" value={total.due ? `${overall}%` : "—"} tone={!total.due ? undefined : overall >= 90 ? "good" : overall >= 70 ? "warn" : "bad"} sub={`${total.due} steps were due`} />
        <StatCard label="Done on time" value={total.onTime} tone="good" />
        <StatCard label="Done late" value={total.late} tone={total.late ? "warn" : undefined} />
        <StatCard label="Still overdue" value={total.overdue} tone={total.overdue ? "bad" : "good"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Scorecard by person" hint="A step finished by a backup counts for the backup">
          <DataTable head={["Person", "Due", "On time", "Late", "Overdue", "Avg delay", "Score"]}>
            {cards.map((c) => (
              <tr key={c.userId}>
                <td className="font-medium">{userName(c.userId)}</td><td className="tabular-nums">{c.due}</td><td className="tabular-nums">{c.doneOnTime}</td><td className="tabular-nums">{c.doneLate}</td>
                <td className={cn("tabular-nums", c.overdue && "font-medium text-red-700")}>{c.overdue}</td><td className="tabular-nums">{c.avgDelayMin ? fmtDuration(c.avgDelayMin) : "—"}</td>
                <td className={cn("font-semibold tabular-nums", tone(c.score))}>{c.score}%</td>
              </tr>
            ))}
          </DataTable>
          {cards.length === 0 && <p className="text-xs text-muted-foreground">No steps were planned in this period.</p>}
        </Section>
        <Section title="Leaderboard">
          <BarList rows={cards.map((c) => ({ label: userName(c.userId), value: c.score, sub: `${c.doneOnTime}/${c.due}` }))} format={(v) => `${v}%`} />
        </Section>
      </div>

      <Section title="By FMS" className="mt-4" hint="Current picture (all loaded entries)">
        <DataTable head={["FMS", "Open", "Completed", "Overdue steps", "On-time rate", "Avg cycle"]}>
          {perFlow.map(({ f, s }) => (
            <tr key={f.flowId}>
              <td className="font-medium">{f.name}</td><td className="tabular-nums">{s.open}</td><td className="tabular-nums">{s.completed}</td>
              <td className={cn("tabular-nums", s.overdue && "font-medium text-red-700")}>{s.overdue}</td><td className="tabular-nums">{s.tasksDone ? `${Math.round(s.onTimePct)}%` : "—"}</td>
              <td className="tabular-nums">{s.avgCycleDays ? `${s.avgCycleDays.toFixed(1)} d` : "—"}</td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </>
  );
}
