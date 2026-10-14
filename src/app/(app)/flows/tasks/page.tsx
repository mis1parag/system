"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeftIcon, CheckIcon, LockIcon, TimerResetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Pill } from "@/components/common";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { MoveDialog } from "@/components/move-dialog";
import { PriorityPill } from "@/components/flow/fields";
import { DoneDialog, EntryPanel, ExtensionDialog, stateTone } from "@/components/flow/entry-panel";
import { absentOn, delayMinutes, effectiveAssignee, parseFlow, PRIORITY_RANK, taskState, type TaskState } from "@/lib/flow";
import { applyFilters, downloadCsv, toCsv, type FieldDef } from "@/lib/filters";
import { PRIORITIES, type FlowItem, type FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { fmtDT, fmtDuration } from "@/lib/dates";

const GROUPS: { key: TaskState; title: string; hint?: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Due today" },
  { key: "upcoming", title: "Upcoming" },
  { key: "unplanned", title: "Waiting", hint: "No planned time yet — starts after an earlier step is done" },
  { key: "done", title: "Completed" },
];

interface Row { t: FlowTask; item: FlowItem; who: string; covering: boolean; state: TaskState }

/** The steps of every FMS that are with you (or with the people in your reach). */
export default function MyTasksPage() {
  const { data, flows, meId, userName, now, today, tasksOf, allow, inReach, call } = useFlows();
  const [moving, setMoving] = useState<string[] | null>(null);
  const [done, setDone] = useState<{ task: FlowTask; item: FlowItem } | null>(null);
  const [ext, setExt] = useState<{ task: FlowTask; item: FlowItem } | null>(null);
  const [panel, setPanel] = useState("");
  const [fstate, setFstate] = useFilters("fms:tasks", "mine");
  const n = now();
  const doneSince = new Date(Date.parse(today + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);

  // every step we have, with who owns it now
  const rows = useMemo<Row[]>(() => {
    const items = new Map((data?.items ?? []).map((i) => [i.itemId, i]));
    const out: Row[] = [];
    for (const t of data?.tasks ?? []) {
      const item = items.get(t.itemId);
      if (!item || item.status === "Cancelled" || t.status === "Skipped") continue;
      if (t.status === "Done") { if ((t.actual || "").slice(0, 10) >= doneSince) out.push({ t, item, who: t.doneBy || t.assigneeId, covering: false, state: "done" }); continue; }
      if (item.status !== "Open") continue;
      const eff = effectiveAssignee(t, data?.absences ?? [], today);
      out.push({ t, item, who: eff.userId, covering: eff.covering, state: taskState(t, n) });
    }
    return out;
  }, [data, today, n, doneSince]);

  const flowOf = (id: string) => flows.find((f) => f.flowId === id) ?? parseFlow(data!.flows.find((f) => f.flowId === id)!);
  const stepName = (r: Row) => flowOf(r.t.flowId).steps.find((s) => s.stepId === r.t.stepId)?.name ?? "";

  const fields = useMemo<FieldDef<Row>[]>(() => [
    { key: "flow", label: "FMS", type: "select", options: flows.filter((f) => !f.archived).map((f) => ({ value: f.flowId, label: f.name })), get: (r) => r.t.flowId },
    { key: "step", label: "Step", type: "text", get: (r) => flows.find((f) => f.flowId === r.t.flowId)?.steps.find((s) => s.stepId === r.t.stepId)?.name },
    { key: "entry", label: "Entry", type: "text", get: (r) => r.item.title },
    { key: "status", label: "Status", type: "select", options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" }, { value: "unplanned", label: "Waiting" }, { value: "done", label: "Completed" }], get: (r) => r.state },
    { key: "who", label: "Assigned to", type: "user", options: (data?.users ?? []).filter((u) => u.status === "Active").map((u) => ({ value: u.userId, label: u.name })), get: (r) => r.who },
    { key: "priority", label: "Priority", type: "select", options: PRIORITIES.map((p) => ({ value: p, label: p })), get: (r) => r.item.priority },
    { key: "due", label: "Due date", type: "date", get: (r) => (r.state === "done" ? r.t.actual : r.t.planned)?.slice(0, 10) },
    { key: "dept", label: "Department", type: "select", options: (data?.departments ?? []).map((d) => ({ value: d, label: d })), get: (r) => data?.users.find((u) => u.userId === r.who)?.department },
  ], [flows, data?.users, data?.departments]);

  const quickFns = useMemo<Record<string, (r: Row) => boolean>>(() => {
    const view = (r: Row) => inReach(r.who, "fms");
    return {
      mine: (r) => r.who === meId && r.state !== "done",
      today: (r) => r.state === "today" && view(r),
      overdue: (r) => r.state === "overdue" && view(r),
      upcoming: (r) => r.state === "upcoming" && view(r),
      done: (r) => r.state === "done" && (r.who === meId || view(r)),
      all: (r) => r.state !== "done" && view(r),
    };
  }, [meId, inReach]);
  const count = (id: string) => rows.filter(quickFns[id]).length;
  const quick: QuickDef[] = [
    { id: "mine", label: "My tasks", count: count("mine") }, { id: "today", label: "Today", count: count("today") }, { id: "overdue", label: "Overdue", count: count("overdue") },
    { id: "upcoming", label: "Upcoming", count: count("upcoming") }, { id: "done", label: "Completed" }, { id: "all", label: "Everyone's" },
  ];

  const shown = useMemo(() => applyFilters(rows, fields, fstate, { quick: quickFns, text: (r) => `${r.item.title} ${r.item.tags} ${userName(r.who)} ${flows.find((f) => f.flowId === r.t.flowId)?.steps.find((s) => s.stepId === r.t.stepId)?.name ?? ""}` })
    .sort((a, b) => (a.t.planned || "9").localeCompare(b.t.planned || "9") || PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority]),
  [rows, fields, fstate, quickFns, userName, flows]);

  const away = absentOn(data?.absences ?? [], meId, today);
  const overdueMine = rows.filter((r) => r.who === meId && r.state === "overdue").length;

  async function exportRows() {
    const body = shown.map((r) => [flowOf(r.t.flowId).name, r.item.title, stepName(r), r.state, r.t.planned, r.t.actual, userName(r.who), r.item.priority]);
    downloadCsv("tasks.csv", toCsv(["FMS", "Entry", "Step", "Status", "Planned", "Actual", "Assigned to", "Priority"], body));
    await call("logExport", { module: "fms", rows: shown.length, what: "Tasks" });
  }

  return (
    <>
      <PageHeader help={{ id: "tasks", title: "These are the steps waiting for you", text: "Tap a title to see the whole entry. Tap Done when you finish a step — or More time if you need to move it. Red = late, amber = due today. The buttons at the top (My tasks, Today, Overdue…) are one-click filters; use Filters for more." }} title="My tasks" subtitle={`${count("mine")} waiting for you · ${overdueMine} overdue`} />
      {away && (
        <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          You are marked away until {away.toDate}. Steps in this period are handled by <b>{userName(away.backupUserId)}</b>.
        </div>
      )}
      <FilterBar page="fms:tasks" module="fms" fields={fields} quick={quick} state={fstate} onChange={setFstate} shown={shown.length} total={rows.length} placeholder="Search entry, step, person…" onExport={exportRows} />

      {shown.length === 0 && <EmptyState title={fstate.quick === "mine" && !fstate.q && !fstate.conds.length ? "Nothing pending 🎉" : "No tasks match"} hint={fstate.quick === "mine" ? "When a new entry is added, its steps show up here at the right time." : "Change or clear the filters."} />}
      {GROUPS.map((g) => {
        const list = shown.filter((m) => m.state === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="mb-5">
            <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Pill tone={g.key === "done" ? "green" : stateTone(g.key)}>{g.title}</Pill><span className="text-muted-foreground">{list.length}</span>{g.hint && <span className="text-xs font-normal text-muted-foreground">{g.hint}</span>}{allow("fms", "assign") && (g.key === "overdue" || g.key === "today" || g.key === "upcoming") && <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setMoving(list.map((r) => r.t.taskId))}><ArrowRightLeftIcon /> Move all {list.length}</Button>}</h2>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {list.slice(0, 60).map((r) => {
                const { t, item } = r;
                const flow = flowOf(t.flowId);
                const step = flow.steps.find((s) => s.stepId === t.stepId);
                const prev = [...tasksOf(item.itemId)].reverse().find((x) => x.seq < t.seq && x.status !== "Skipped");
                const blocked = !!step?.sequential && !!prev && prev.status !== "Done";
                const late = delayMinutes(t, n); const delay = r.state !== "done" && late > 0 ? fmtDuration(late) : "";
                const mine = r.who === meId;
                return (
                  <div key={t.taskId} className="rounded-lg border bg-card p-3 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 flex-1 text-left" onClick={() => setPanel(item.itemId)}>
                        <div className="flex items-center gap-1.5 text-sm font-medium">{step?.name}{item.priority !== "Normal" && <PriorityPill priority={item.priority} />}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.title} · {flow.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {step?.how && <span>{step.how}</span>}
                          {r.state === "done" ? <span>Done {fmtDT(t.actual)}</span> : t.planned && <span>Planned {fmtDT(t.planned)}</span>}
                          {delay && <span className="font-medium text-[#a41c4e]">Late {delay}</span>}
                          {!mine && <Pill tone="blue">{userName(r.who)}</Pill>}
                          {r.covering && mine && <Pill tone="violet">covering for {userName(t.assigneeId)}</Pill>}
                        </div>
                      </button>
                      {r.state !== "done" && (blocked ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><LockIcon className="size-3.5" /> Waiting</span> : (
                        <div className="flex shrink-0 flex-col gap-1.5">
                          {allow("fms", "edit") && <Button size="sm" className="h-9" onClick={() => setDone({ task: t, item })}><CheckIcon /> Done</Button>}
                          {allow("fms", "edit") && t.planned && mine && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExt({ task: t, item })}><TimerResetIcon /> More time</Button>}
                          {allow("fms", "assign") && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMoving([t.taskId])}><ArrowRightLeftIcon /> Move</Button>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {list.length > 60 && <p className="text-center text-xs text-muted-foreground">Showing 60 of {list.length} — narrow the filters.</p>}
            </div>
          </section>
        );
      })}
      {done && <DoneDialog task={done.task} step={flowOf(done.task.flowId).steps.find((s) => s.stepId === done.task.stepId)} itemTitle={done.item.title} onClose={() => setDone(null)} />}
      {ext && <ExtensionDialog task={ext.task} step={flowOf(ext.task.flowId).steps.find((s) => s.stepId === ext.task.stepId)} itemTitle={ext.item.title} onClose={() => setExt(null)} />}
      {panel && <EntryPanel itemId={panel} onClose={() => setPanel("")} />}
      {moving && <MoveDialog kind="fms" ids={moving} onClose={() => setMoving(null)} />}
    </>
  );
}
