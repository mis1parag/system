"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, ClockIcon, DownloadIcon, FlagIcon, TagIcon, UserRoundCogIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, Spinner } from "@/components/common";
import { FieldInput } from "@/components/flow/fields";
import { PRIORITIES, type Flow } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";

type Op = "complete_step" | "reassign_step" | "postpone" | "priority" | "tags" | "cancel";
interface Result { done: number; failed: number; results: { itemId: string; ok: boolean; error?: string }[] }

/** Floating bar shown while entries are selected: do one thing to all of them. */
export function BulkBar({ flow, selected, onClear, onExport }: { flow: Flow; selected: Set<string>; onClear: () => void; onExport?: (ids: string[]) => void }) {
  const { allow, call, data } = useFlows();
  const [op, setOp] = useState<Op | null>(null);
  if (selected.size === 0) return null;
  const btn = "h-9 shrink-0";
  return (
    <>
      <div className="fixed inset-x-0 bottom-16 z-40 px-3 md:bottom-4 md:left-60">
        <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto rounded-2xl border bg-card p-2 shadow-lg">
          <span className="shrink-0 pl-2 pr-1 text-sm font-semibold">{selected.size} selected</span>
          {/* only what this person is allowed to do is shown; the server checks again */}
          {allow("fms", "edit") && <Button size="sm" className={btn} onClick={() => setOp("complete_step")}><CheckIcon /> Mark step done</Button>}
          {allow("fms", "edit") && <Button size="sm" variant="outline" className={btn} onClick={() => setOp("postpone")}><ClockIcon /> Change due date</Button>}
          {allow("fms", "assign") && <Button size="sm" variant="outline" className={btn} onClick={() => setOp("reassign_step")}><UserRoundCogIcon /> Assign</Button>}
          {allow("fms", "edit") && <Button size="sm" variant="outline" className={btn} onClick={() => setOp("priority")}><FlagIcon /> Priority</Button>}
          {allow("fms", "edit") && <Button size="sm" variant="outline" className={btn} onClick={() => setOp("tags")}><TagIcon /> Tags</Button>}
          {onExport && allow("fms", "export") && <Button size="sm" variant="outline" className={btn} onClick={() => onExport([...selected])}><DownloadIcon /> Export</Button>}
          {allow("fms", "delete") && <Button size="sm" variant="ghost" className={`${btn} text-red-700`} onClick={() => setOp("cancel")}>Cancel / archive</Button>}
          <Button size="icon-sm" variant="ghost" className="ml-auto shrink-0" aria-label="Clear selection" onClick={onClear}><XIcon /></Button>
        </div>
      </div>
      {op && <BulkDialog op={op} flow={flow} ids={[...selected]} users={(data?.users ?? []).filter((u) => u.status === "Active" && (data?.reach?.fms?.all || data?.reach?.fms?.ids.includes(u.userId)))} call={call} onClose={() => setOp(null)} onDone={() => { setOp(null); onClear(); }} />}
    </>
  );
}

function BulkDialog({ op, flow, ids, users, call, onClose, onDone }: {
  op: Op; flow: Flow; ids: string[]; users: { userId: string; name: string }[]; call: <T>(a: string, d?: unknown) => Promise<{ ok: boolean; data?: T; error?: string }>; onClose: () => void; onDone: () => void;
}) {
  const [stepId, setStepId] = useState(flow.steps[0]?.stepId ?? "");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [tags, setTags] = useState("");
  const [assignee, setAssignee] = useState("");
  const [remarks, setRemarks] = useState("");
  const [stepData, setStepData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const step = flow.steps.find((s) => s.stepId === stepId);
  const title = { complete_step: "Mark a step done", reassign_step: "Reassign a step", postpone: "Postpone", priority: "Set priority", tags: "Set tags", cancel: "Cancel / archive entries" }[op];

  async function run() {
    setBusy(true); setErr("");
    const r = await call<Result>("bulkEntries", { op, itemIds: ids, stepId, days: Number(days), reason, priority, tags, assigneeId: assignee, remarks, data: stepData });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Failed"); return; }
    setResult(r.data!);
    if (r.data!.failed === 0) { toast.success(`Done for ${r.data!.done} entries`); onDone(); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title} · {ids.length} entries</DialogTitle></DialogHeader>
        {!result ? (
          <div className="grid gap-3">
            {(op === "complete_step" || op === "reassign_step") && (
              <Field label="Which step?"><NativeSelect value={stepId} onChange={(e) => setStepId(e.target.value)}>{flow.steps.map((s) => <option key={s.stepId} value={s.stepId}>{s.name}</option>)}</NativeSelect></Field>
            )}
            {op === "complete_step" && (
              <>
                <p className="text-xs text-muted-foreground">Applies to selected entries where this step is still pending and you are allowed to do it. Others are listed afterwards.</p>
                {(step?.completionFields ?? []).map((f) => <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}><FieldInput field={f} value={stepData[f.key] ?? ""} onChange={(x) => setStepData({ ...stepData, [f.key]: x })} /></Field>)}
                <Field label="Remarks (optional)"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
              </>
            )}
            {op === "reassign_step" && <Field label="New person"><NativeSelect value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Select…</option>{users.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>}
            {op === "postpone" && (
              <>
                <Field label="Move the schedule date by (days)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d-]/g, ""))} /></Field>
                <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              </>
            )}
            {op === "priority" && <Field label="Priority"><NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field>}
            {op === "tags" && <Field label="Tags (replaces existing)" hint="comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, cold-chain" /></Field>}
            {op === "cancel" && <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
            {err && <p className="text-sm text-red-700">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <div>✅ {result.done} done · ❌ {result.failed} not changed</div>
            <ul className="max-h-48 overflow-y-auto rounded-lg border p-2 text-xs">{result.results.filter((x) => !x.ok).map((x) => <li key={x.itemId}>{x.itemId}: {x.error}</li>)}</ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={result ? onDone : onClose}>{result ? "Close" : "Cancel"}</Button>
          {!result && <Button onClick={run} disabled={busy || (op === "postpone" && (!reason.trim() || !Number(days))) || (op === "reassign_step" && !assignee)}>{busy ? <Spinner /> : "Apply"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
