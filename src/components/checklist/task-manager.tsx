"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClockIcon, ClipboardPasteIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/avatar";
import { EmptyState, Field, Pill, Section, Spinner } from "@/components/common";
import { BulkDialog, scheduleText, TaskDialog } from "@/components/checklist/task-dialogs";
import { FREQ_LABEL } from "@/lib/checklist-shared";
import { plannedDates } from "@/lib/checklist-schedule";
import { CHECKLIST_FREQ, type ChecklistFreq, type ChecklistTask } from "@/lib/flow-types";
import { addDays, fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

type Kind = "DC" | "NDC" | "OT";
const KINDS: { id: Kind; label: string; hint: string; first: ChecklistFreq }[] = [
  { id: "DC", label: "Daily", hint: "Every working day", first: "D" },
  { id: "NDC", label: "Non-daily", hint: "Weekly, monthly, quarterly…", first: "W" },
  { id: "OT", label: "One-time", hint: "Once, on one date", first: "O" },
];
const kindOf = (f: string): Kind => (CHECKLIST_FREQ.find((x) => x.id === f)?.group ?? "DC") as Kind;

function useCalendar() {
  const { data } = useFlows();
  return useMemo(() => ({
    off: new Set(String(data?.settings?.WEEKLY_OFF ?? "0").split(",").filter((x) => /^[0-6]$/.test(x.trim())).map(Number)),
    holidays: new Set((data?.holidays ?? []).filter((h) => !h.flowId).map((h) => h.date)),
  }), [data]);
}

/** A separate, clearly laid out place to add a task: 1 What · 2 Who · 3 When, with a live preview of the dates it will land on. */
export function AddTaskPanel() {
  const { call, today, meId, allow, peopleFor } = useFlows();
  const cal = useCalendar();
  const people = allow("checklist", "assign") ? peopleFor("checklist") : peopleFor("checklist").filter((u) => u.userId === meId);
  const [v, setV] = useState({ title: "", department: "", kra: "", proof: false, doerId: "", backupId: "", kind: "DC" as Kind, freq: "D" as ChecklistFreq, startDate: today, endDate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bulk, setBulk] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((c) => ({ ...c, [k]: val }));
  const doer = v.doerId || (people.length === 1 ? people[0].userId : "");
  const freqs = CHECKLIST_FREQ.filter((f) => f.group === v.kind);
  const dates = useMemo(() => (v.startDate ? plannedDates({ freq: v.freq, startDate: v.startDate, endDate: v.endDate }, v.startDate, addDays(v.startDate, 400), cal).slice(0, 5) : []), [v.freq, v.startDate, v.endDate, cal]);

  function pickKind(k: Kind) { setV((c) => ({ ...c, kind: k, freq: KINDS.find((x) => x.id === k)!.first })); }
  async function add() {
    setBusy(true); setErr("");
    const r = await call<{ created: number }>("saveChecklistTask", { title: v.title, department: v.department, kra: v.kra, proof: v.proof ? "Y" : "N", doerId: doer, backupId: v.backupId, freq: v.freq, startDate: v.startDate, endDate: v.endDate });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not add"); return; }
    toast.success(`Task added — ${r.data!.created} entr${r.data!.created === 1 ? "y" : "ies"} created for the coming days`);
    setV((c) => ({ ...c, title: "", kra: "" })); // the rest stays, so adding the next task of the same kind is quick
  }

  const step = (n: number, title: string) => <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>{title}</div>;
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <Section title="Add a checklist task" hint="Fill the three boxes, check the preview, press Add." actions={allow("checklist", "import") && <Button size="sm" variant="outline" onClick={() => setBulk(true)}><ClipboardPasteIcon /> Paste many</Button>}>
        <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (v.title.trim() && doer) add(); }}>
          <div className="rounded-xl border p-3">
            {step(1, "What has to be done")}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Task *" className="sm:col-span-2"><Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Check the order group at 6 before leaving" autoFocus /></Field>
              <Field label="Department"><Input value={v.department} onChange={(e) => set("department", e.target.value)} placeholder="Accounts" /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-input" checked={v.proof} onChange={(e) => set("proof", e.target.checked)} /> Needs proof to tick (a link or a note)</label>
              <Field label="Notes / KRA (optional)" className="sm:col-span-2"><Textarea rows={2} value={v.kra} onChange={(e) => set("kra", e.target.value)} /></Field>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            {step(2, "Who does it")}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Doer *"><NativeSelect value={doer} onChange={(e) => set("doerId", e.target.value)}><option value="">Select…</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
              <Field label="Buddy (covers when away)"><NativeSelect value={v.backupId} onChange={(e) => set("backupId", e.target.value)}><option value="">—</option>{people.filter((u) => u.userId !== doer).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
            </div>
          </div>

          <div className="rounded-xl border p-3">
            {step(3, "When")}
            <div className="mb-3 grid grid-cols-3 gap-2" role="tablist" aria-label="Type of task">
              {KINDS.map((k) => (
                <button key={k.id} type="button" role="tab" aria-selected={v.kind === k.id} onClick={() => pickKind(k.id)} className={cn("rounded-lg border p-2.5 text-left transition-colors", v.kind === k.id ? "border-primary bg-[#efeeff]" : "bg-card hover:bg-muted")}>
                  <div className="text-sm font-semibold">{k.label}</div><div className="text-[11px] text-muted-foreground">{k.hint}</div>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {freqs.length > 1 && <Field label="How often"><NativeSelect value={v.freq} onChange={(e) => set("freq", e.target.value as ChecklistFreq)}>{freqs.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</NativeSelect></Field>}
              <Field label={v.kind === "OT" ? "On this date" : v.kind === "DC" ? "Starting" : "First date"}><Input type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
              {v.kind !== "OT" && <Field label="Stop after (optional)"><Input type="date" value={v.endDate} min={v.startDate} onChange={(e) => set("endDate", e.target.value)} /></Field>}
            </div>
            <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <div>{scheduleText(v.freq, v.startDate)} <span className="text-muted-foreground">Weekly-off days and holidays are skipped.</span></div>
              {dates.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Coming dates: {dates.map((d) => fmtDate(d)).join(" · ")}{v.kind !== "OT" ? " …" : ""}</div>}
            </div>
          </div>

          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <div className="flex justify-end"><Button type="submit" size="lg" disabled={busy || !v.title.trim() || !doer}>{busy ? <Spinner /> : <><PlusIcon /> Add task</>}</Button></div>
        </form>
      </Section>
      {bulk && <BulkDialog onClose={() => setBulk(false)} />}
    </div>
  );
}

/** One task's page: its coming / overdue entries, each with its own "change date" and "remove". */
function TaskPanel({ task, onClose, onEdit, onDelete }: { task: ChecklistTask; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const { data, call, today, userName, allow } = useFlows();
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const canMove = allow("checklist", "assign");
  const entries = (data?.checklistLog ?? []).filter((e) => e.ctId === task.ctId);
  const open = entries.filter((e) => e.status === "Pending").sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const done = entries.filter((e) => e.status === "Done");

  async function change(id: string) {
    const when = dates[id];
    if (!when) return;
    setBusy(id);
    const r = await call("moveWork", { kind: "checklist", ids: [id], when });
    setBusy("");
    if (r.ok) { toast.success(`Moved to ${fmtDate(when, true)}`); setDates((d) => ({ ...d, [id]: "" })); } else toast.error(r.error || "Could not move");
  }
  async function remove(id: string) {
    const why = window.prompt("Why remove this day's entry? (it stays in the history as skipped)");
    if (!why?.trim()) return;
    setBusy(id);
    const r = await call("skipChecklist", { clId: id, remarks: why.trim() });
    setBusy("");
    if (r.ok) toast.success("Entry removed"); else toast.error(r.error || "Could not remove");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{task.title}</DialogTitle>
          <DialogDescription>{userName(task.doerId)} · {FREQ_LABEL[task.freq]} · {scheduleText(task.freq, task.startDate)}{task.endDate ? ` Stops after ${fmtDate(task.endDate, true)}.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}><PencilIcon /> Edit task (people, how often, dates)</Button>
          <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={onDelete}><Trash2Icon /> Delete this task</Button>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm font-semibold"><span>Waiting entries ({open.length})</span><span className="text-xs font-normal text-muted-foreground">{done.length} already done</span></div>
          {open.length === 0 ? <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">Nothing waiting. New entries appear by themselves as the days come.</p> : (
            <ul className="grid gap-1.5">
              {open.slice(0, 40).map((e) => (
                <li key={e.clId} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="min-w-32 font-medium tabular-nums">{fmtDate(e.plannedDate, true)}</span>
                  {e.plannedDate < today ? <Pill tone="red">Overdue</Pill> : e.plannedDate === today ? <Pill tone="amber">Today</Pill> : <Pill tone="gray">Coming</Pill>}
                  {e.origDate && e.origDate !== e.plannedDate && <span className="text-xs text-muted-foreground">was {fmtDate(e.origDate)}</span>}
                  <span className="flex-1" />
                  {canMove && (
                    <>
                      <Input type="date" className="h-8 w-36" value={dates[e.clId] ?? ""} onChange={(ev) => setDates((d) => ({ ...d, [e.clId]: ev.target.value }))} aria-label="New date" />
                      <Button size="sm" variant="outline" className="h-8" disabled={!dates[e.clId] || busy === e.clId} onClick={() => change(e.clId)}><CalendarClockIcon /> Change date</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-red-700" disabled={busy === e.clId} onClick={() => remove(e.clId)} aria-label="Remove this day"><Trash2Icon /></Button>
                </li>
              ))}
            </ul>
          )}
          {open.length > 40 && <p className="mt-1 text-xs text-muted-foreground">Showing the first 40 of {open.length}.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTask({ task, onClose }: { task: ChecklistTask; onClose: () => void }) {
  const { data, call } = useFlows();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = (data?.checklistLog ?? []).filter((e) => e.ctId === task.ctId);
  const waiting = entries.filter((e) => e.status === "Pending").length, done = entries.filter((e) => e.status === "Done").length;
  async function go() {
    setBusy(true);
    const r = await call<{ cancelled: number }>("deleteChecklistTask", { ctId: task.ctId, reason });
    setBusy(false);
    if (r.ok) { toast.success(`Deleted — ${r.data!.cancelled} waiting entries removed`); onClose(); } else toast.error(r.error || "Could not delete");
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Delete “{task.title}”?</DialogTitle><DialogDescription>Only this task is deleted. The {waiting} waiting entr{waiting === 1 ? "y" : "ies"} go from {task.doerId ? "the person's" : "the"} list; the {done} already done stay as history. You can bring it back from the Deleted list.</DialogDescription></DialogHeader>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No longer needed…" /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="destructive" onClick={go} disabled={busy}>{busy ? <Spinner /> : "Delete this task"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every assigned task, person by person and type by type, each with its own Open / Edit / Pause / Delete. */
export function TaskManager({ onAdd }: { onAdd: () => void }) {
  const { data, userName, today, call, peopleFor } = useFlows();
  const cal = useCalendar();
  const people = peopleFor("checklist");
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<"" | Kind>("");
  const [status, setStatus] = useState<"Active" | "Paused" | "Deleted">("Active");
  const [panel, setPanel] = useState<ChecklistTask | null>(null);
  const [edit, setEdit] = useState<ChecklistTask | null>(null);
  const [del, setDel] = useState<ChecklistTask | null>(null);
  const [busy, setBusy] = useState("");
  const wantStatus = status === "Deleted" ? "Archived" : status;
  const all = status === "Deleted" ? data?.deletedChecklistTasks ?? [] : data?.checklistTasks ?? [];
  const counts = { Active: (data?.checklistTasks ?? []).filter((t) => t.status === "Active").length, Paused: (data?.checklistTasks ?? []).filter((t) => t.status === "Paused").length, Deleted: (data?.deletedChecklistTasks ?? []).length };
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.checklistLog ?? []) if (e.status === "Pending") m.set(e.ctId, (m.get(e.ctId) ?? 0) + 1);
    return m;
  }, [data?.checklistLog]);
  const tasks = all.filter((t) => t.status === wantStatus && (!who || t.doerId === who) && (!kind || kindOf(t.freq) === kind) && (!q || `${t.title} ${t.department}`.toLowerCase().includes(q.toLowerCase())));
  const byPerson = useMemo(() => {
    const m = new Map<string, ChecklistTask[]>();
    for (const t of tasks) (m.get(t.doerId) ?? m.set(t.doerId, []).get(t.doerId)!).push(t);
    return [...m.entries()].sort((a, b) => userName(a[0]).localeCompare(userName(b[0])));
  }, [tasks, userName]);
  const next = (t: ChecklistTask) => plannedDates(t, today, addDays(today, 40), cal)[0] ?? "";

  async function setTaskStatus(t: ChecklistTask, to: "Active" | "Paused") {
    setBusy(t.ctId);
    const r = await call("saveChecklistTask", { ctId: t.ctId, title: t.title, doerId: t.doerId, backupId: t.backupId, department: t.department, freq: t.freq, startDate: t.startDate, endDate: t.endDate, proof: t.proof, kra: t.kra, status: to });
    setBusy("");
    if (r.ok) toast.success(to === "Active" ? "Task is back on" : "Task paused — no new entries"); else toast.error(r.error || "Could not change");
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="h-10 min-w-48 flex-1" placeholder="Search a task or department…" value={q} onChange={(e) => setQ(e.target.value)} />
        <NativeSelect className="w-44" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person"><option value="">Everyone</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect>
        <Button className="h-10" onClick={onAdd}><PlusIcon /> Add task</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {([["", "All types"], ["DC", "Daily"], ["NDC", "Non-daily"], ["OT", "One-time"]] as const).map(([k, l]) => (
          <button key={k || "all"} onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("rounded-full border px-3 py-1 text-xs font-medium", kind === k ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{l}</button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {(["Active", "Paused", "Deleted"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={cn("rounded-full border px-3 py-1 text-xs font-medium", status === s ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{s}{counts[s] ? ` (${counts[s]})` : ""}</button>
        ))}
      </div>
      {byPerson.length === 0 ? <EmptyState title="No tasks here" hint={status === "Active" ? "Add a task, or change the filters." : "Nothing in this list."} /> : (
        <div className="grid gap-4">
          {byPerson.map(([person, list]) => (
            <section key={person} className="rounded-xl border bg-card">
              <header className="flex items-center gap-2 border-b px-3 py-2"><Avatar userId={person} size={28} /><span className="font-semibold">{userName(person)}</span><span className="text-xs text-muted-foreground">{list.length} task{list.length === 1 ? "" : "s"}</span></header>
              {KINDS.map((k) => {
                const part = list.filter((t) => kindOf(t.freq) === k.id).sort((a, b) => a.title.localeCompare(b.title));
                if (!part.length) return null;
                return (
                  <div key={k.id} className="border-b last:border-b-0">
                    <div className="bg-muted/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label} · {part.length}</div>
                    <ul className="divide-y">
                      {part.map((t) => (
                        <li key={t.ctId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                          <button className="min-w-48 flex-1 text-left" onClick={() => setPanel(t)}>
                            <span className="font-medium hover:underline">{t.title}</span>
                            <span className="block text-xs text-muted-foreground">{FREQ_LABEL[t.freq]}{t.department ? ` · ${t.department}` : ""}{t.proof === "Y" ? " · proof" : ""}{t.backupId ? ` · buddy ${userName(t.backupId)}` : ""}</span>
                          </button>
                          {t.status === "Active" && <span className="whitespace-nowrap text-xs text-muted-foreground">{next(t) ? `next ${fmtDate(next(t))}` : "no coming date"}</span>}
                          {(pendingBy.get(t.ctId) ?? 0) > 0 && t.status !== "Archived" && <Pill tone="amber">{pendingBy.get(t.ctId)} waiting</Pill>}
                          <span className="flex gap-1">
                            {t.status === "Archived" ? <Button size="sm" variant="outline" className="h-8" disabled={busy === t.ctId} onClick={() => setTaskStatus(t, "Active")}><RotateCcwIcon /> Bring back</Button> : (
                              <>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => setPanel(t)}><CalendarClockIcon /> Dates</Button>
                                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEdit(t)} aria-label={`Edit ${t.title}`}><PencilIcon /></Button>
                                <Button size="sm" variant="ghost" className="h-8" disabled={busy === t.ctId} onClick={() => setTaskStatus(t, t.status === "Active" ? "Paused" : "Active")} aria-label={t.status === "Active" ? "Pause" : "Resume"}>{t.status === "Active" ? <PauseIcon /> : <PlayIcon />}</Button>
                                <Button size="sm" variant="ghost" className="h-8 text-red-700" onClick={() => setDel(t)} aria-label={`Delete ${t.title}`}><Trash2Icon /></Button>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
      {panel && <TaskPanel task={panel} onClose={() => setPanel(null)} onEdit={() => { setEdit(panel); setPanel(null); }} onDelete={() => { setDel(panel); setPanel(null); }} />}
      {edit && <TaskDialog task={edit} onClose={() => setEdit(null)} />}
      {del && <DeleteTask task={del} onClose={() => setDel(null)} />}
    </>
  );
}
