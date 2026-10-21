"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart3Icon, CalendarDaysIcon, Columns3Icon, LayoutGridIcon, ListIcon, PencilIcon, PlusIcon, UploadIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Pill } from "@/components/common";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { BulkBar } from "@/components/flow/bulk-bar";
import { CalendarView } from "@/components/flow/calendar-view";
import { EntryForm } from "@/components/flow/entry-form";
import { EntryPanel } from "@/components/flow/entry-panel";
import { FlowDashboard } from "@/components/flow/flow-dashboard";
import { FlowImportDialog } from "@/components/flow/flow-import-dialog";
import { KanbanView } from "@/components/flow/kanban-view";
import { ListView } from "@/components/flow/list-view";
import { SheetView } from "@/components/flow/sheet-view";
import { itemData, PRIORITY_RANK, tagList, taskState } from "@/lib/flow";
import { PRIORITIES, type FlowItem, type FlowTask } from "@/lib/flow-types";
import { applyFilters, downloadCsv, toCsv, type FieldDef } from "@/lib/filters";
import { RemoveFmsEntries } from "@/components/bulk-remove";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

type View = "list" | "sheet" | "kanban" | "calendar" | "dashboard";
const VIEWS: { id: View; label: string; icon: typeof ListIcon }[] = [
  { id: "list", label: "List", icon: ListIcon },
  { id: "sheet", label: "Sheet", icon: LayoutGridIcon },
  { id: "kanban", label: "Board", icon: Columns3Icon },
  { id: "calendar", label: "Calendar", icon: CalendarDaysIcon },
  { id: "dashboard", label: "Dashboard", icon: BarChart3Icon },
];

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { flows, data, allow, isSuper, now, loadHistory, userName, meId, call } = useFlows();
  const flow = flows.find((f) => f.flowId === id);
  const [view, setView] = useState<View>(() => {
    // preferred view is remembered per device (this page only renders client-side, after the data has loaded)
    try { const v = typeof window !== "undefined" ? localStorage.getItem("fms-view") : null; if (v && VIEWS.some((x) => x.id === v)) return v as View; } catch { /* storage blocked */ }
    return "list";
  });
  const [fstate, setFstate] = useFilters(`fms:${id}`, "all");
  // ?new=1 and ?item=… (from the quick search, notifications, links) open the form / panel; closing them sticks
  const sp = useSearchParams();
  const [addPick, setAdding] = useState<boolean | null>(null);
  const adding = addPick ?? sp.get("new") === "1";
  const [importing, setImporting] = useState(false);
  const [panelPick, setPanel] = useState<string | null>(null);
  const panel = panelPick ?? sp.get("item") ?? "";
  const [loadingAll, setLoadingAll] = useState(false);
  const [allLoaded, setAllLoaded] = useState(isSuper); // the Super Admin already has the complete history
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // a switched-off FMS has no entries in the normal data: the Super Admin opening it asks for them (to look, remove or restore)
  const off = !!flow?.archived;
  useEffect(() => { if (off && isSuper) void loadHistory(id); }, [off, isSuper, id, loadHistory]);

  const pick = (v: View) => { setView(v); try { localStorage.setItem("fms-view", v); } catch { /* storage blocked */ } };

  const n = now();
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.flowId === id), [data, id]);
  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => t.flowId === id), [data, id]);
  const tasksByItem = useMemo(() => {
    const m = new Map<string, FlowTask[]>();
    tasks.forEach((t) => (m.get(t.itemId) ?? m.set(t.itemId, []).get(t.itemId)!).push(t));
    m.forEach((v) => v.sort((a, b) => a.seq - b.seq));
    return m;
  }, [tasks]);

  const users = useMemo(() => data?.users ?? [], [data?.users]);
  const fields = useMemo<FieldDef<FlowItem>[]>(() => {
    if (!flow) return [];
    const pendingBy = (i: FlowItem) => (tasksByItem.get(i.itemId) ?? []).filter((x) => x.status === "Pending").map((x) => x.assigneeId);
    const base: FieldDef<FlowItem>[] = [
      { key: "status", label: "Status", type: "select", options: [{ value: "Open", label: flow.openLabel }, { value: "Completed", label: flow.doneLabel }, { value: "Cancelled", label: "Cancelled" }], get: (i) => i.status },
      { key: "assignee", label: "Assigned to (waiting on)", type: "user", options: users.map((u) => ({ value: u.userId, label: u.name })), get: pendingBy },
      { key: "priority", label: "Priority", type: "select", options: PRIORITIES.map((p) => ({ value: p, label: p })), get: (i) => i.priority },
      { key: "due", label: "Due date", type: "date", get: (i) => i.anchorDate?.slice(0, 10) },
      { key: "created", label: "Created", type: "date", get: (i) => i.createdAt?.slice(0, 10) },
      { key: "createdBy", label: "Created by", type: "user", options: users.map((u) => ({ value: u.userId, label: u.name })), get: (i) => i.createdBy },
      { key: "tags", label: "Tags", type: "tags", get: (i) => tagList(i) },
      { key: "dept", label: "Department", type: "select", options: (data?.departments ?? []).map((d) => ({ value: d, label: d })), get: (i) => i.department },
      { key: "postponed", label: "Postponed", type: "select", options: [{ value: "yes", label: "Yes" }], get: (i) => (i.postponeCount > 0 ? "yes" : "") },
    ];
    // the FMS's own fields, so any column of the sheet can be filtered
    for (const fl of flow.fields) base.push({ key: "f:" + fl.key, label: fl.label, type: fl.type === "date" ? "date" : fl.type === "select" ? "select" : "text", options: fl.options?.map((o) => ({ value: o, label: o })), get: (i) => { const v = itemData(i)[fl.key]; return v == null ? "" : String(v); } });
    return base;
  }, [flow, tasksByItem, users, data?.departments]);

  const quickFns = useMemo<Record<string, (i: FlowItem) => boolean>>(() => {
    const st = (i: FlowItem, s: string) => (tasksByItem.get(i.itemId) ?? []).some((x) => x.status === "Pending" && taskState(x, n) === s);
    return {
      all: () => true,
      mine: (i) => i.createdBy === meId || (tasksByItem.get(i.itemId) ?? []).some((x) => x.assigneeId === meId),
      today: (i) => i.status === "Open" && st(i, "today"),
      overdue: (i) => i.status === "Open" && st(i, "overdue"),
      upcoming: (i) => i.status === "Open" && st(i, "upcoming"),
      pending: (i) => i.status === "Open",
      done: (i) => i.status === "Completed",
    };
  }, [tasksByItem, n, meId]);
  const quick: QuickDef[] = [
    { id: "mine", label: "My FMS", count: items.filter(quickFns.mine).length }, { id: "today", label: "Today", count: items.filter(quickFns.today).length }, { id: "overdue", label: "Overdue", count: items.filter(quickFns.overdue).length },
    { id: "upcoming", label: "Upcoming" }, { id: "pending", label: "Pending", count: items.filter(quickFns.pending).length }, { id: "done", label: "Completed" }, { id: "all", label: "All", count: items.length },
  ];

  const filtered = useMemo(() => {
    if (!flow) return [];
    return applyFilters(items, fields, fstate, { quick: quickFns, text: (i) => `${i.title} ${i.dataJson} ${i.tags} ${i.itemId}` })
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.anchorDate || b.createdAt).localeCompare(a.anchorDate || a.createdAt));
  }, [items, flow, fields, fstate, quickFns]);

  async function exportRows(ids?: string[]) {
    if (!flow) return;
    const rows = ids ? filtered.filter((i) => ids.includes(i.itemId)) : filtered;
    const head = ["Entry", "Status", "Priority", "Due", "Created", "Created by", "Waiting on", "Tags", ...flow.fields.map((x) => x.label)];
    const body = rows.map((i) => [i.title, i.status, i.priority, i.anchorDate, i.createdAt.slice(0, 10), userName(i.createdBy), [...new Set((tasksByItem.get(i.itemId) ?? []).filter((x) => x.status === "Pending").map((x) => userName(x.assigneeId)))].join(", "), i.tags, ...flow.fields.map((x) => { const v = itemData(i)[x.key]; return v == null ? "" : String(v); })]);
    downloadCsv(`${flow.name}.csv`, toCsv(head, body));
    await call("logExport", { module: "fms", rows: rows.length, what: flow.name });
  }

  const toggle = (itemId: string) => setSelected((s) => { const x = new Set(s); if (x.has(itemId)) x.delete(itemId); else x.add(itemId); return x; });
  const toggleAll = (ids: string[], on: boolean) => setSelected((s) => { const x = new Set(s); ids.forEach((i) => (on ? x.add(i) : x.delete(i))); return x; });

  if (!flow) return <EmptyState title="FMS not found" action={<Link href="/flows" className={buttonVariants({ variant: "outline" })}>All FMS</Link>} />;
  const filterable = view !== "dashboard";
  const shownSelection = new Set([...selected].filter((s) => items.some((i) => i.itemId === s)));

  return (
    <>
      <PageHeader
        help={{ id: "fms-detail", title: "Switch the view at the top", text: "List = cards, Sheet = like Excel, Board = columns per step, Calendar = by day, Dashboard = numbers. Tap an entry to see every step, who does it and the planned vs actual time." }}
        title={flow.name}
        subtitle={flow.description || `${flow.steps.length} steps`}
        actions={
          <>
            {allow("fms", "configure") && <Link href={`/flows/${flow.flowId}/edit`} className={cn(buttonVariants({ variant: "outline" }), "h-9")}><PencilIcon /> Edit FMS</Link>}
            {isSuper && <RemoveFmsEntries flowId={flow.flowId} flowName={flow.name} />}
            {allow("fms", "import") && <Button variant="outline" onClick={() => setImporting(true)}><UploadIcon /> Import</Button>}
            {!flow.archived && allow("fms", "create") && <Button onClick={() => setAdding(true)}><PlusIcon /> New entry</Button>}
          </>
        }
      />
      {flow.archived && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">This FMS is switched off — nobody sees its entries or steps, and no reminders go out. Switch it on from the FMS list to use it again.</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => pick(v.id)} className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium", view === v.id ? "bg-background shadow-sm" : "text-muted-foreground")}>
              <v.icon className="size-4" /> {v.label}
            </button>
          ))}
        </div>
        {flow.slaDays > 0 && <Pill tone="blue">SLA {flow.slaDays} working days</Pill>}
      </div>

      {filterable && <FilterBar page={`fms:${id}`} module="fms" fields={fields} quick={quick} state={fstate} onChange={setFstate} shown={filtered.length} total={items.length} placeholder="Search PO, location, tag, anything…" onExport={() => exportRows()} />}

      {view === "list" && (filtered.length === 0 ? items.length ? <EmptyState title="No entries match" hint="Change or clear the filters." /> : (
        <div className="rounded-xl border border-dashed bg-card p-4">
          <div className="text-sm font-medium">No entries yet</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Every entry you add goes through these {flow.steps.length} steps. The planned time of each step is worked out for you.</p>
          <ol className="mt-3 grid gap-1.5 text-sm">{flow.steps.map((s, i) => <li key={s.stepId} className="flex gap-2.5"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span><span className="min-w-0"><span className="font-medium">{s.name}</span><span className="block text-xs text-muted-foreground">{userName(s.assigneeId)}{s.how ? ` · ${s.how}` : ""}{s.whenText ? ` · ${s.whenText}` : ""}</span></span></li>)}</ol>
          {!flow.archived && allow("fms", "create") && <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => setAdding(true)}><PlusIcon /> Add the first entry</Button>{allow("fms", "import") && <Button variant="outline" onClick={() => setImporting(true)}><UploadIcon /> Import existing data</Button>}</div>}
        </div>
      ) : <ListView flow={flow} items={filtered} tasksByItem={tasksByItem} onOpen={setPanel} selected={shownSelection} onToggle={toggle} />)}
      {view === "sheet" && <SheetView flow={flow} items={filtered} tasksByItem={tasksByItem} onOpen={setPanel} selected={shownSelection} onToggle={toggle} onToggleAll={toggleAll} />}
      {view === "kanban" && <KanbanView flow={flow} items={filtered} tasksByItem={tasksByItem} onOpen={setPanel} />}
      {view === "calendar" && <CalendarView flow={flow} items={filtered} tasksByItem={tasksByItem} onOpen={setPanel} />}
      {view === "dashboard" && <FlowDashboard flow={flow} items={items} tasks={tasks} />}

      {!allLoaded && (
        <div className="mt-4 text-center text-xs text-muted-foreground">
          Showing open entries and those finished in the last 90 days.{" "}
          <button className="font-medium text-primary underline" disabled={loadingAll} onClick={async () => { setLoadingAll(true); await loadHistory(flow.flowId); setLoadingAll(false); setAllLoaded(true); }}>{loadingAll ? "Loading…" : "Load full history"}</button>
        </div>
      )}
      <BulkBar flow={flow} selected={shownSelection} onClear={() => setSelected(new Set())} onExport={(ids) => exportRows(ids)} />
      {adding && !flow.archived && <EntryForm flow={flow} onClose={() => setAdding(false)} onSaved={setPanel} />}
      {importing && <FlowImportDialog flow={flow} onClose={() => setImporting(false)} />}
      {panel && <EntryPanel itemId={panel} onClose={() => setPanel("")} />}
    </>
  );
}
