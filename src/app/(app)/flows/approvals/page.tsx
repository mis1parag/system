"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Pill } from "@/components/common";
import { EntryPanel } from "@/components/flow/entry-panel";
import { fmtDate, fmtDT } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

export default function ApprovalsPage() {
  const { data, flows, userName, meId, isSuper, can, allow, inReach, call } = useFlows();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [panel, setPanel] = useState("");
  const requests = [...(data?.requests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = requests.filter((r) => r.status === "Pending");
  const decided = requests.filter((r) => r.status !== "Pending");

  const info = (taskId: string, itemId: string) => {
    const task = data?.tasks.find((t) => t.taskId === taskId);
    const item = data?.items.find((i) => i.itemId === itemId);
    const flow = flows.find((f) => f.flowId === item?.flowId);
    return { task, item, flow, step: flow?.steps.find((s) => s.stepId === task?.stepId) };
  };
  const canDecideCl = (requestedBy: string) => isSuper || data?.users.find((u) => u.userId === requestedBy)?.managerId === meId || (allow("checklist", "manage") && inReach(requestedBy, "checklist"));
  const canDecide = (requestedBy: string) => isSuper || data?.users.find((u) => u.userId === requestedBy)?.managerId === meId || (can("decideRequests") && inReach(requestedBy, "work"));

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    const r = await call("decideRequest", { requestId: id, approve, note: note[id] ?? "" });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success(approve ? "Approved — planned time moved" : "Rejected");
  }

  const card = (r: (typeof requests)[number], actions: boolean) => {
    if (r.kind === "checklist") {
      const e = data?.checklistLog.find((l) => l.clId === r.taskId);
      const t = data?.checklistTasks.find((c) => c.ctId === r.itemId);
      return (
        <div key={r.requestId} className="rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><div className="font-medium">{t?.title ?? "Checklist task"} <Pill tone="blue">Checklist</Pill></div><div className="text-xs text-muted-foreground">asked by {userName(r.requestedBy)} · {fmtDT(r.createdAt)}</div></div>
            {!actions && <Pill tone={r.status === "Approved" ? "green" : "red"}>{r.status}{r.decidedBy ? ` by ${userName(r.decidedBy)}` : ""}</Pill>}
          </div>
          <div className="mt-2 text-xs">{e?.plannedDate ? <>Planned <b>{fmtDate(e.origDate && r.status === "Approved" ? e.origDate : e.plannedDate)}</b> → </> : null}requested <b>{fmtDate(r.newPlanned)}</b></div>
          {r.reason && <p className="mt-1 text-xs text-muted-foreground">“{r.reason}”</p>}
          {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
          {actions && canDecideCl(r.requestedBy) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input className="h-9 min-w-40 flex-1" placeholder="Note (optional)" value={note[r.requestId] ?? ""} onChange={(ev) => setNote({ ...note, [r.requestId]: ev.target.value })} />
              <Button size="sm" className="h-9" disabled={busy === r.requestId} onClick={() => decide(r.requestId, true)}><CheckIcon /> Approve</Button>
              <Button size="sm" variant="outline" className="h-9 text-red-700" disabled={busy === r.requestId} onClick={() => decide(r.requestId, false)}><XIcon /> Reject</Button>
            </div>
          )}
          {actions && !canDecideCl(r.requestedBy) && <p className="mt-2 text-xs text-muted-foreground">Waiting for an approver.</p>}
        </div>
      );
    }
    const { task, item, flow, step } = info(r.taskId, r.itemId);
    return (
      <div key={r.requestId} className="rounded-xl border bg-card p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button className="min-w-0 text-left" onClick={() => item && setPanel(item.itemId)}>
            <div className="font-medium">{step?.name ?? r.taskId} <span className="font-normal text-muted-foreground">· {item?.title ?? r.itemId}</span></div>
            <div className="text-xs text-muted-foreground">{flow?.name} · asked by {userName(r.requestedBy)} · {fmtDT(r.createdAt)}</div>
          </button>
          {!actions && <Pill tone={r.status === "Approved" ? "green" : "red"}>{r.status}{r.decidedBy ? ` by ${userName(r.decidedBy)}` : ""}</Pill>}
        </div>
        <div className="mt-2 text-xs">{task?.planned ? <>Planned <b>{fmtDT(task.planned)}</b> → </> : null}requested <b>{fmtDT(r.newPlanned)}</b></div>
        {r.reason && <p className="mt-1 text-xs text-muted-foreground">“{r.reason}”</p>}
        {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
        {actions && canDecide(r.requestedBy) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="h-9 min-w-40 flex-1" placeholder="Note (optional)" value={note[r.requestId] ?? ""} onChange={(e) => setNote({ ...note, [r.requestId]: e.target.value })} />
            <Button size="sm" className="h-9" disabled={busy === r.requestId} onClick={() => decide(r.requestId, true)}><CheckIcon /> Approve</Button>
            <Button size="sm" variant="outline" className="h-9 text-red-700" disabled={busy === r.requestId} onClick={() => decide(r.requestId, false)}><XIcon /> Reject</Button>
          </div>
        )}
        {actions && !canDecide(r.requestedBy) && <p className="mt-2 text-xs text-muted-foreground">Waiting for an approver.</p>}
      </div>
    );
  };

  return (
    <>
      <PageHeader help={{ id: "approvals", title: "Requests for more time", text: "When someone cannot finish an FMS step or a checklist task by its planned time they ask here. Approve moves the planned time (for an FMS step also the steps after it); reject keeps it." }} title="Approvals" subtitle="Requests for more time on a step. Approve to move its planned time (and the steps that depend on it)." />
      {requests.length === 0 && <EmptyState title="No requests" hint="When someone needs more time for a step, the request appears here." />}
      {pending.length > 0 && <div className="mb-5 grid grid-cols-[minmax(0,1fr)] gap-2"><h2 className="text-sm font-semibold">Waiting for a decision ({pending.length})</h2>{pending.map((r) => card(r, true))}</div>}
      {decided.length > 0 && <div className="grid grid-cols-[minmax(0,1fr)] gap-2"><h2 className="text-sm font-semibold text-muted-foreground">Recently decided</h2>{decided.slice(0, 30).map((r) => card(r, false))}</div>}
      {panel && <EntryPanel itemId={panel} onClose={() => setPanel("")} />}
    </>
  );
}
