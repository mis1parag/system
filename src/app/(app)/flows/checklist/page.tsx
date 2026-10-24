"use client";


import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeftIcon, CheckIcon, CircleIcon, LinkIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/avatar";
import { RemoveChecklistTasks } from "@/components/bulk-remove";
import { DataTable, EmptyState, PageHeader, Pill, Progress, Spinner } from "@/components/common";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { AddTaskPanel, TaskManager } from "@/components/checklist/task-manager";
import { ProofDialog, ProofPicture } from "@/components/checklist/proof-dialog";
import { MoveDialog } from "@/components/move-dialog";
import { checklistOwner, FREQ_LABEL } from "@/lib/checklist-shared";
import { ChecklistMoreTimeDialog } from "@/components/checklist/more-time-dialog";
import { applyFilters, downloadCsv, EMPTY_FILTER, toCsv, type FieldDef, type FilterState } from "@/lib/filters";
import { CHECKLIST_FREQ, type ChecklistEntry, type ChecklistTask } from "@/lib/flow-types";
import { addDays, fmtDate, weekdayName } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Row { e: ChecklistEntry; t: ChecklistTask; covering: boolean; owner: string }

const groupOf = (f: string) => CHECKLIST_FREQ.find((x) => x.id === f)?.group ?? "";

export default function ChecklistPage() {
  const { allow, peopleFor, isSuper } = useFlows();
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("add") === "1" ? "add" : "mine"));
  const [fstate, setFstate] = useFilters("checklist:list", "mine");
  const sees = peopleFor("checklist").length > 1;
  return (
    <>
      <PageHeader help={{ id: "checklist", title: "All your repeating work in one place", text: "Daily, weekly, monthly and one-time tasks are all here. The buttons at the top are one-click filters (My tasks, Today, Pending, Overdue, Completed); open Filters for more — type, proof needed, department, dates. Tap the circle to tick a task; a task marked “Proof needed” asks for a link or a note. Late ticks count as not on time in the scorecard. Ticked by mistake? Undo within 30 minutes." }} title="Checklist" subtitle="Daily, non-daily and one-time tasks together — filter, add and tick right here." />
      {isSuper && <div className="mb-3 flex justify-end"><RemoveChecklistTasks /></div>}
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="mb-3 overflow-x-auto"><TabsList>
          <TabsTrigger value="mine">Checklist</TabsTrigger>
          {sees && <TabsTrigger value="team">Team today</TabsTrigger>}
          {allow("checklist", "create") && <TabsTrigger value="add">Add task</TabsTrigger>}
          {allow("checklist", "manage") && <TabsTrigger value="tasks">Manage tasks</TabsTrigger>}
        </TabsList></div>
        <TabsContent value="mine"><Unified state={fstate} onState={setFstate} onAdd={() => setTab("add")} /></TabsContent>
        {sees && <TabsContent value="team"><TeamToday onOpen={(id) => { setFstate({ ...EMPTY_FILTER("pending"), conds: [{ id: "p1", field: "who", op: "is", value: id }] }); setTab("mine"); }} /></TabsContent>}
        {allow("checklist", "create") && <TabsContent value="add"><AddTaskPanel /></TabsContent>}
        {allow("checklist", "manage") && <TabsContent value="tasks"><TaskManager onAdd={() => setTab("add")} /></TabsContent>}
      </Tabs>
    </>
  );
}

/** Every entry in reach, with the owner rule (buddy cover) applied. */
function useRows() {
  const { data, today } = useFlows();
  return useMemo(() => {
    const tasks = new Map((data?.checklistTasks ?? []).map((t) => [t.ctId, t]));
    const abs = data?.absences ?? [];
    const rows: Row[] = [];
    for (const e of data?.checklistLog ?? []) {
      const t = tasks.get(e.ctId);
      if (!t || e.status === "Cancelled" || e.status === "Skipped") continue;
      if (e.status === "Done") { rows.push({ e, t, covering: e.doneBy !== "" && e.doneBy !== e.doerId, owner: e.doneBy || e.doerId }); continue; }
      const o = checklistOwner(e, t, abs, today);
      rows.push({ e, t, covering: o.covering, owner: o.userId });
    }
    return rows;
  }, [data, today]);
}

function Unified({ state, onState, onAdd }: { state: FilterState; onState: (s: FilterState) => void; onAdd: () => void }) {
  const { data, meId, today, call, userName, optimistic, now, allow, peopleFor, inReach } = useFlows();
  const allRows = useRows();
  // Daily / Non-daily / One-time: one tap, each with how much is still open
  const [kindTab, setKindTab] = useState<"all" | "DC" | "NDC" | "OT">("all");
  const rows = useMemo(() => (kindTab === "all" ? allRows : allRows.filter((r) => groupOf(r.t.freq) === kindTab)), [allRows, kindTab]);
  const [proofFor, setProofFor] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const [moving, setMoving] = useState<string[] | null>(null);
  const [asking, setAsking] = useState<Row | null>(null);
  const askedIds = new Set((data?.requests ?? []).filter((q) => q.kind === "checklist" && q.status === "Pending").map((q) => q.taskId));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const people = peopleFor("checklist");
  const week = addDays(today, 7);

  const depts = useMemo(() => [...new Set([...(data?.checklistTasks ?? []).map((t) => t.department), ...(data?.departments ?? [])].map((x) => x.trim()).filter(Boolean))].sort(), [data]);
  const fields = useMemo<FieldDef<Row>[]>(() => [
    { key: "who", label: "Person", type: "user", options: (data?.users ?? []).filter((u) => u.status === "Active").map((u) => ({ value: u.userId, label: u.name })), get: (r) => r.owner },
    { key: "title", label: "Task", type: "text", get: (r) => r.t.title },
    { key: "kind", label: "Type", type: "select", options: [{ value: "DC", label: "Daily" }, { value: "NDC", label: "Non-daily" }, { value: "OT", label: "One-time" }], get: (r) => groupOf(r.t.freq) },
    { key: "freq", label: "How often", type: "select", options: CHECKLIST_FREQ.map((f) => ({ value: f.id, label: f.label })), get: (r) => r.t.freq },
    { key: "proof", label: "Proof", type: "select", options: [{ value: "Y", label: "Needed" }, { value: "N", label: "Not needed" }], get: (r) => (r.t.proof === "Y" ? "Y" : "N") },
    { key: "dept", label: "Department", type: "select", options: depts.map((d) => ({ value: d, label: d })), get: (r) => r.t.department },
    { key: "status", label: "Status", type: "select", options: [{ value: "Pending", label: "Pending" }, { value: "Done", label: "Done" }], get: (r) => r.e.status },
    { key: "due", label: "Due date", type: "date", get: (r) => r.e.plannedDate },
    { key: "done", label: "Done on", type: "date", get: (r) => (r.e.status === "Done" ? r.e.actual.slice(0, 10) : "") },
  ], [data?.users, depts]);
  const quickFns = useMemo<Record<string, (r: Row) => boolean>>(() => ({
    mine: (r) => r.owner === meId && r.e.status === "Pending" && r.e.plannedDate <= week,
    today: (r) => r.e.plannedDate === today || (r.e.status === "Done" && r.e.actual.slice(0, 10) === today),
    pending: (r) => r.e.status === "Pending" && r.e.plannedDate <= week,
    overdue: (r) => r.e.status === "Pending" && r.e.plannedDate < today,
    done: (r) => r.e.status === "Done",
    all: () => true,
  }), [meId, today, week]);
  const count = (id: string) => rows.filter(quickFns[id]).length;
  const quick: QuickDef[] = [
    { id: "mine", label: "Mine", count: count("mine") }, { id: "today", label: "Today", count: count("today") }, { id: "pending", label: "Pending", count: count("pending") },
    { id: "overdue", label: "Overdue", count: count("overdue") }, { id: "done", label: "Completed" }, { id: "all", label: "All" },
  ];
  const shown = useMemo(() => applyFilters(rows, fields, state, { quick: quickFns, text: (r) => `${r.t.title} ${r.t.department} ${r.t.kra} ${userName(r.owner)}` })
    .sort((a, b) => (a.e.status === "Done" ? 1 : 0) - (b.e.status === "Done" ? 1 : 0) || (a.e.status === "Done" ? b.e.actual.localeCompare(a.e.actual) : a.e.plannedDate.localeCompare(b.e.plannedDate) || a.t.title.localeCompare(b.t.title))), [rows, fields, state, quickFns, userName]);

  const open = shown.filter((r) => r.e.status === "Pending");
  const overdue = open.filter((r) => r.e.plannedDate < today);
  const todays = open.filter((r) => r.e.plannedDate === today);
  const coming = open.filter((r) => r.e.plannedDate > today);
  const done = shown.filter((r) => r.e.status === "Done");
  const mineToday = rows.filter((r) => r.owner === meId && (r.e.plannedDate === today || (r.e.status === "Done" && r.e.actual.slice(0, 10) === today)));
  const mineDone = mineToday.filter((r) => r.e.status === "Done").length;
  const pct = mineToday.length ? Math.round((mineDone / mineToday.length) * 100) : 100;
  const canEdit = allow("checklist", "edit");
  const mayTick = (r: Row) => canEdit && r.e.status === "Pending" && (r.e.plannedDate <= today || r.t.freq !== "D") && (r.owner === meId || r.e.doerId === meId || allow("checklist", "manage") || inReach(r.owner, "checklist") && r.owner !== meId && allow("checklist", "edit"));
  const canMove = allow("checklist", "assign");

  async function tick(r: Row) {
    if (r.t.proof === "Y") { setProofFor(r); return; }
    // tick it on screen straight away; if the server refuses, put it back and say why
    const back = optimistic("Checklist_Log", r.e as unknown as Record<string, unknown>, { ...r.e, status: "Done", actual: now(), doneBy: meId });
    const res = await call("completeChecklist", { clId: r.e.clId });
    if (!res.ok) { back(); toast.error(res.error || "Could not tick"); } else toast.success("Done", { action: { label: "Undo", onClick: () => undo(r.e.clId) } });
  }
  async function undo(clId: string) {
    const res = await call("reopenChecklist", { clId });
    if (!res.ok) toast.error(res.error || "Could not undo");
  }
  async function tickMany(ids: string[]) {
    if (!ids.length) return;
    setBusy("all");
    const res = await call<{ done: number; skipped: unknown[] }>("completeChecklistMany", { clIds: ids });
    setBusy("");
    if (!res.ok) toast.error(res.error || "Failed"); else { toast.success(`${res.data!.done} ticked${res.data!.skipped.length ? ` · ${res.data!.skipped.length} left (need proof or not yours)` : ""}`); setPicked(new Set()); }
  }
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedRows = open.filter((r) => picked.has(r.e.clId));
  const allIds = open.map((r) => r.e.clId);

  async function exportRows() {
    const body = shown.map((r) => [r.t.title, FREQ_LABEL[r.t.freq], r.t.department, userName(r.owner), r.e.plannedDate, r.e.status, r.e.actual, r.t.proof === "Y" ? "Needed" : "", r.e.proof]);
    downloadCsv("checklist.csv", toCsv(["Task", "How often", "Department", "Person", "Due", "Status", "Done at", "Proof needed", "Proof"], body));
    await call("logExport", { module: "checklist", rows: shown.length, what: "Checklist" });
  }

  const list = (title: string, items: Row[], tone: "red" | "amber" | "blue" | "green") => items.length === 0 ? null : (
    <section className="mb-4">
      <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Pill tone={tone}>{title}</Pill><span className="text-muted-foreground">{items.length}</span></h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">{items.map((r) => (
        <Item key={r.e.clId} r={r} showWho={people.length > 1} busy={busy === r.e.clId} canTick={mayTick(r)} onTick={() => tick(r)}
          asked={askedIds.has(r.e.clId)} onMore={r.e.status === "Pending" && mayTick(r) && r.e.plannedDate <= today && !askedIds.has(r.e.clId) ? () => setAsking(r) : undefined}
          onUndo={r.e.status === "Done" && r.e.actual.slice(0, 10) === today && canEdit ? () => undo(r.e.clId) : undefined}
          selected={picked.has(r.e.clId)} onSelect={r.e.status === "Pending" && (mayTick(r) || canMove) ? () => toggle(r.e.clId) : undefined} />
      ))}</div>
    </section>
  );

  return (
    <>
      {/* my progress today */}
      <div className="mb-3 rounded-lg border bg-card p-3 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
        <div className="mb-1.5 flex items-center justify-between text-sm"><span className="font-medium">My day · {mineDone} of {mineToday.length} done</span><span className="text-xs text-muted-foreground">{count("overdue") ? `${count("overdue")} overdue in view` : "nothing is overdue"}</span></div>
        <Progress value={pct} />
      </div>

      {allow("checklist", "create") && <div className="mb-3 flex justify-end"><Button onClick={onAdd}><PlusIcon /> Add task</Button></div>}

      <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Type of task">
        {([["all", "All tasks"], ["DC", "Daily"], ["NDC", "Non-daily"], ["OT", "One-time"]] as const).map(([k, label]) => {
          const mine = allRows.filter((r) => k === "all" || groupOf(r.t.freq) === k);
          const openN = mine.filter((r) => r.e.status === "Pending" && r.e.plannedDate <= week).length;
          return (
            <button key={k} role="tab" aria-selected={kindTab === k} onClick={() => setKindTab(k)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", kindTab === k ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>
              {label}{openN > 0 && <span className={cn("rounded-full px-1.5 text-[10.5px] font-semibold", kindTab === k ? "bg-primary text-white" : "bg-muted-foreground/15")}>{openN}</span>}
            </button>
          );
        })}
      </div>
      <FilterBar page="checklist:list" module="checklist" fields={fields} quick={quick} state={state} onChange={onState} shown={shown.length} total={rows.length} placeholder="Search task, department, person…" onExport={exportRows} />

      {/* actions */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {open.length > 0 && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="size-4 rounded border-input" checked={picked.size > 0 && picked.size === allIds.length} onChange={(e) => setPicked(e.target.checked ? new Set(allIds) : new Set())} /> Select all {open.length} shown</label>}
        {picked.size > 0 && (
          <>
            <b className="text-sm">{picked.size} selected</b>
            {canEdit && <Button size="sm" disabled={busy === "all"} onClick={() => tickMany(pickedRows.filter((r) => r.t.proof !== "Y" && r.e.plannedDate <= today).map((r) => r.e.clId))}>{busy === "all" ? <Spinner /> : <><CheckIcon /> Tick selected</>}</Button>}
            {canMove && <Button size="sm" variant="outline" onClick={() => setMoving([...picked])}><ArrowRightLeftIcon /> Move / hand over</Button>}
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
            <span className="text-xs text-muted-foreground">Tasks that need proof are ticked one by one.</span>
          </>
        )}
      </div>

      {shown.length === 0 && <EmptyState title={rows.length ? "Nothing matches" : "Nothing on your checklist"} hint={rows.length ? "Change the quick filter or clear the filters." : allow("checklist", "create") ? "Add a task above (or paste many) — it shows up on the right days automatically." : "Your manager has not given you any repeating tasks yet."} />}
      {list("Overdue", overdue, "red")}
      {list("Today", todays, "amber")}
      {list("Coming up", coming, "blue")}
      {list("Done", done, "green")}
      {proofFor && <ProofDialog clId={proofFor.e.clId} title={proofFor.t.title} onClose={() => setProofFor(null)} />}
      {asking && <ChecklistMoreTimeDialog clId={asking.e.clId} title={asking.t.title} plannedDate={asking.e.plannedDate} onClose={() => setAsking(null)} />}
      {moving && <MoveDialog kind="checklist" ids={moving} onClose={(ok) => { setMoving(null); if (ok) setPicked(new Set()); }} />}
    </>
  );
}

/** One-line new entry right on the page. */
function Item({ r, showWho, busy, canTick, onTick, onUndo, selected, onSelect, asked, onMore }: { r: Row; showWho?: boolean; busy: boolean; canTick: boolean; onTick: () => void; onUndo?: () => void; selected?: boolean; onSelect?: () => void; asked?: boolean; onMore?: () => void }) {
  const { today, userName } = useFlows();
  const done = r.e.status === "Done";
  const late = !done && r.e.plannedDate < today;
  const needsProof = r.t.proof === "Y";
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-card p-2.5", late && "border-red-200 bg-red-50/40", done && "opacity-75", selected && "border-primary bg-[#efeeff]/60")}>
      {onSelect && <input type="checkbox" className="size-4 shrink-0 rounded border-input" checked={!!selected} onChange={onSelect} aria-label={`Select ${r.t.title}`} />}
      <button
        onClick={onTick} disabled={!canTick || done || busy} aria-label={done ? "Done" : `Mark done: ${r.t.title}`}
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors", done ? "border-emerald-500 bg-emerald-500 text-white" : canTick ? "border-primary/40 text-transparent hover:bg-primary/10 hover:text-primary" : "border-muted text-transparent")}
      >
        {busy ? <Spinner /> : done ? <CheckIcon className="size-5" /> : canTick ? <CheckIcon className="size-5" /> : <CircleIcon className="size-5 text-muted-foreground/40" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", done && "line-through")}>{r.t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {showWho && <span className="inline-flex items-center gap-1"><Avatar userId={r.owner} size={16} /><span className="font-medium text-foreground/80">{userName(r.owner)}</span></span>}
          <Pill tone={r.t.freq === "D" ? "blue" : r.t.freq === "O" ? "violet" : "gray"}>{FREQ_LABEL[r.t.freq]}</Pill>
          {r.t.department && <span>{r.t.department}</span>}
          <span className={cn(late && "font-medium text-[#a41c4e]")}>· {late ? `was due ${weekdayName(r.e.plannedDate).slice(0, 3)} ${fmtDate(r.e.plannedDate)}` : done ? `done ${r.e.actual.slice(0, 10) === today ? "" : fmtDate(r.e.actual.slice(0, 10)) + " "}${r.e.actual.slice(11)}${r.e.actual.slice(0, 10) > r.e.plannedDate ? " (late)" : ""}` : fmtDate(r.e.plannedDate)}</span>
          {r.e.origDate && r.e.origDate !== r.e.plannedDate && <span title="Moved from its first date">· moved from {fmtDate(r.e.origDate)}</span>}
          {r.covering && <Pill tone="violet">{done ? `for ${userName(r.e.doerId)}` : `covering ${userName(r.e.doerId)}`}</Pill>}
          {r.e.proofImg && <ProofPicture clId={r.e.clId} />}
          {needsProof && !done && <Pill tone="amber"><LinkIcon className="mr-0.5 inline size-3" />Proof needed</Pill>}
          {r.e.proof && /^https?:\/\//.test(r.e.proof) && <a href={r.e.proof} target="_blank" rel="noopener noreferrer" className="text-primary underline">proof</a>}
          {r.e.proof && !/^https?:\/\//.test(r.e.proof) && <span title={r.e.proof}>· proof: {r.e.proof.slice(0, 40)}</span>}
        </div>
      </div>
      {asked && <Pill tone="amber">More time asked</Pill>}
      {onMore && <button onClick={onMore} className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted" title="Ask your manager for more time">More time</button>}
      {onUndo && <button onClick={onUndo} aria-label="Undo" className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Undo2Icon className="size-4" /></button>}
    </div>
  );
}

function TeamToday({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, today, userName } = useFlows();
  const rows = useMemo(() => {
    const tasks = new Map((data?.checklistTasks ?? []).map((t) => [t.ctId, t]));
    const abs = data?.absences ?? [];
    const by = new Map<string, { open: number; overdue: number; today: number; done: number }>();
    for (const e of data?.checklistLog ?? []) {
      const t = tasks.get(e.ctId);
      if (!t || e.status === "Cancelled" || e.status === "Skipped") continue;
      if (e.status === "Done") { if (e.actual.slice(0, 10) !== today) continue; const c = by.get(e.doneBy || e.doerId) ?? by.set(e.doneBy || e.doerId, { open: 0, overdue: 0, today: 0, done: 0 }).get(e.doneBy || e.doerId)!; c.done++; continue; }
      if (e.plannedDate > today) continue;
      const who = checklistOwner(e, t, abs, today).userId;
      const c = by.get(who) ?? by.set(who, { open: 0, overdue: 0, today: 0, done: 0 }).get(who)!;
      c.open++;
      if (e.plannedDate < today) c.overdue++; else c.today++;
    }
    return [...by.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  }, [data, today]);
  if (rows.length === 0) return <EmptyState title="No checklist work yet" hint="Add tasks in “All tasks”." />;
  return (
    <DataTable head={["Person", "Done today", "Still open today", "Older & overdue", ""]}>
      {rows.map((r) => (
        <tr key={r.id}>
          <td className="font-medium">{userName(r.id)}</td><td className="tabular-nums">{r.done}</td><td className="tabular-nums">{r.today}</td>
          <td className={cn("tabular-nums", r.overdue && "font-medium text-red-700")}>{r.overdue}</td>
          <td className="text-right"><button className="text-xs text-primary underline" onClick={() => onOpen(r.id)}>Open</button></td>
        </tr>
      ))}
    </DataTable>
  );
}
