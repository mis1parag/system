"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, Spinner } from "@/components/common";
import { parseFreq } from "@/lib/checklist-shared";
import { CHECKLIST_FREQ, type ChecklistTask } from "@/lib/flow-types";
import { fmtDate, weekdayName } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

const cb = "h-4 w-4 rounded border-input";

/** One sentence that says exactly when the task will appear. */
export function scheduleText(freq: string, start: string): string {
  if (!start) return "";
  const day = Number(start.slice(8));
  switch (freq) {
    case "D": return `Every working day from ${fmtDate(start, true)}.`;
    case "W": return `Every ${weekdayName(start)}, starting ${fmtDate(start, true)}.`;
    case "F": return `Every second ${weekdayName(start)}, starting ${fmtDate(start, true)}.`;
    case "M": return `On day ${day} of every month${day > 28 ? " (the last day in shorter months)" : ""}, from ${fmtDate(start, true)}.`;
    case "Q": return `On day ${day} every 3 months, from ${fmtDate(start, true)}.`;
    case "H": return `On day ${day} every 6 months, from ${fmtDate(start, true)}.`;
    case "Y": return `Every year on ${fmtDate(start)}.`;
    case "O": return `Once, on ${fmtDate(start, true)}.`;
    default: return "";
  }
}

export function TaskDialog({ task, onClose }: { task?: ChecklistTask; onClose: () => void }) {
  const { call, today } = useFlows();
  const { peopleFor } = useFlows();
  const people = peopleFor("checklist");
  const [v, setV] = useState({
    title: task?.title ?? "", doerId: task?.doerId ?? "", backupId: task?.backupId ?? "", department: task?.department ?? "", freq: task?.freq ?? "D",
    startDate: task?.startDate ?? today, endDate: task?.endDate ?? "", proof: task?.proof === "Y", kra: task?.kra ?? "", status: task?.status ?? "Active",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((cur) => ({ ...cur, [k]: val }));

  async function save() {
    setBusy(true); setErr("");
    const r = await call<{ created: number }>("saveChecklistTask", { ctId: task?.ctId, ...v, proof: v.proof ? "Y" : "N" });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(task ? "Saved" : `Added — ${r.data!.created} entr${r.data!.created === 1 ? "y" : "ies"} created for the coming days`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{task ? "Edit checklist task" : "New checklist task"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Task *"><Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Check order group at 6 before leaving" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Who does it *"><NativeSelect value={v.doerId} onChange={(e) => set("doerId", e.target.value)}><option value="">Select…</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
            <Field label="Buddy (covers when away)"><NativeSelect value={v.backupId} onChange={(e) => set("backupId", e.target.value)}><option value="">—</option>{people.filter((u) => u.userId !== v.doerId).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
            <Field label="How often *"><NativeSelect value={v.freq} onChange={(e) => set("freq", e.target.value as ChecklistTask["freq"])}>{CHECKLIST_FREQ.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</NativeSelect></Field>
            <Field label={v.freq === "D" ? "Start date" : v.freq === "O" ? "Date" : "First date"}><Input type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">{scheduleText(v.freq, v.startDate)} Weekly-off days and holidays are skipped.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department"><Input value={v.department} onChange={(e) => set("department", e.target.value)} placeholder="Accounts" /></Field>
            <Field label="Stop after (optional)"><Input type="date" value={v.endDate} min={v.startDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={cb} checked={v.proof} onChange={(e) => set("proof", e.target.checked)} /> Needs proof to tick (a link or a note)</label>
          <Field label="KRA / notes"><Textarea rows={2} value={v.kra} onChange={(e) => set("kra", e.target.value)} /></Field>
          {task && <Field label="Status"><NativeSelect value={v.status} onChange={(e) => set("status", e.target.value as ChecklistTask["status"])}><option value="Active">Active</option><option value="Paused">Paused (no new entries)</option><option value="Archived">Archived</option></NativeSelect></Field>}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Layout = "drive" | "simple";
const LAYOUTS: Record<Layout, { label: string; cols: string[] }> = {
  drive: { label: "Task · Doer · Department · Frequency · Day/Date  (same as your Drive “Task List” sheet)", cols: ["title", "doer", "department", "freq", "startDate"] },
  simple: { label: "Task · Doer · Frequency · Start date · Department · Buddy", cols: ["title", "doer", "freq", "startDate", "department", "buddy"] },
};

/** Paste rows copied from a Google Sheet / Excel (tab separated) or typed with | or commas. */
export function BulkDialog({ onClose }: { onClose: () => void }) {
  const { data, call } = useFlows();
  const [layout, setLayout] = useState<Layout>("drive");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: { row: number; reason: string }[]; unknownDoers: string[] } | null>(null);
  const names = new Set((data?.users ?? []).filter((u) => u.status === "Active").map((u) => u.name.toLowerCase()));

  const rows = useMemo(() => {
    const cols = LAYOUTS[layout].cols;
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
      const cells = line.split(sep).map((c) => c.trim());
      return Object.fromEntries(cols.map((k, i) => [k, cells[i] ?? ""]));
    }).filter((r) => !(String(r.title).toLowerCase() === "task" && /doer/i.test(String(r.doer)))); // header row
  }, [text, layout]);
  const unknown = [...new Set(rows.map((r) => String(r.doer)).filter((d) => d && !names.has(d.toLowerCase())))];
  const badFreq = rows.filter((r) => !parseFreq(r.freq)).length;

  async function save() {
    setBusy(true); setErr("");
    const r = await call<{ added: number; skipped: { row: number; reason: string }[]; unknownDoers: string[]; created: number }>("bulkAddChecklistTasks", { rows });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not add"); return; }
    setResult(r.data!);
    if (r.data!.added) toast.success(`${r.data!.added} task${r.data!.added === 1 ? "" : "s"} added`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add many tasks at once</DialogTitle></DialogHeader>
        {!result ? (
          <div className="grid gap-3">
            <Field label="Column order of what you paste"><NativeSelect value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>{(Object.keys(LAYOUTS) as Layout[]).map((k) => <option key={k} value={k}>{LAYOUTS[k].label}</option>)}</NativeSelect></Field>
            <Field label="Paste rows" hint="Copy the cells from Google Sheets / Excel and paste. Frequency: D, W, F (2 weeks), M, Q, H, Y or O — or the words daily / weekly / monthly… Day/Date can be 05/01/2026 or 2026-01-05.">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder={"Create TDS sheet\tRahul\tAccounts\tM\t07/01/2026\nPost on Instagram\tKunal\tPC\tD\t13/01/2025"} />
            </Field>
            <p className="text-xs text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"} read.{badFreq > 0 && <span className="text-amber-700"> {badFreq} have a frequency that is not understood.</span>}</p>
            {unknown.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">These names are not users yet and will be skipped: <b>{unknown.join(", ")}</b>. Add them in Team first (same spelling), then paste again.</p>}
            {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <p><b>{result.added}</b> task{result.added === 1 ? "" : "s"} added, <b>{result.skipped.length}</b> skipped.</p>
            {result.unknownDoers.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Unknown people: <b>{result.unknownDoers.join(", ")}</b> — add them in Team, then paste those rows again.</p>}
            {result.skipped.length > 0 && <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">{result.skipped.slice(0, 60).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
          {!result && <Button onClick={save} disabled={busy || rows.length === 0}>{busy ? <Spinner /> : `Add ${rows.length} task${rows.length === 1 ? "" : "s"}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
