"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2Icon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

/** Super Admin only. Takes whole sets of FMS entries out of everybody's lists; finished work can stay. Nothing is erased: they are cancelled and can be restored. */
export function RemoveFmsEntries({ flowId, flowName }: { flowId: string; flowName: string }) {
  const { call, isSuper, refresh } = useFlows();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"open" | "everything">("open");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState<{ total: number; open: number; completed: number; cancelled: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    call<{ total: number; open: number; completed: number; cancelled: number }>("previewRemoval", { kind: "fms", flowId }).then((r) => { if (live && r.ok) setN(r.data!); });
    return () => { live = false; };
  }, [open, call, flowId]);
  if (!isSuper) return null;
  const count = n ? (scope === "open" ? n.open : n.open + n.completed) : 0;
  async function go() {
    setBusy(true);
    const r = await call<{ removed: number }>("removeFlowEntries", { flowId, scope, reason, confirm });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not remove"); return; }
    toast.success(`${r.data!.removed} entries removed from ${flowName}`);
    setOpen(false); setConfirm(""); setReason("");
    refresh();
  }
  async function undo() {
    setBusy(true);
    const r = await call<{ restored: number }>("restoreFlowEntries", { flowId });
    setBusy(false);
    if (r.ok) { toast.success(`${r.data!.restored} entries brought back`); setOpen(false); refresh(); } else toast.error(r.error || "Could not restore");
  }
  return (
    <>
      <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}><Trash2Icon /> Remove entries</Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && !busy && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove entries of “{flowName}”</DialogTitle>
              <DialogDescription>They disappear from everybody&apos;s FMS tasks. Nothing is erased — they are cancelled, and you can bring them back.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="What to remove">
                <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  <option value="open">Only open entries{n ? ` (${n.open})` : ""}</option>
                  <option value="everything">Everything, finished ones too{n ? ` (${n.open + n.completed})` : ""}</option>
                </NativeSelect>
              </Field>
              <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Test data, wrong import…" /></Field>
              <Field label={`Type REMOVE to remove ${count} entries`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="REMOVE" autoComplete="off" /></Field>
              {n && n.cancelled > 0 && <p className="text-xs text-muted-foreground">{n.cancelled} entries of this FMS are already removed. <button type="button" className="font-medium text-primary underline" onClick={undo} disabled={busy}>Bring them all back</button></p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={go} disabled={busy || confirm.trim().toUpperCase() !== "REMOVE" || count === 0}>{busy ? <Spinner /> : `Remove ${count}`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Super Admin only: archive checklist tasks (everybody's or one person's) and cancel their unfinished entries. Finished entries stay as history. */
export function RemoveChecklistTasks() {
  const { call, isSuper, data, refresh } = useFlows();
  const [open, setOpen] = useState(false);
  const [doerId, setDoerId] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState<{ tasks: number; pending: number; done: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    call<{ tasks: number; pending: number; done: number }>("previewRemoval", { kind: "checklist", doerId }).then((r) => { if (live && r.ok) setN(r.data!); });
    return () => { live = false; };
  }, [open, call, doerId]);
  if (!isSuper) return null;
  const people = [...(data?.users ?? [])].filter((u) => u.deleted !== "Y").sort((a, b) => a.name.localeCompare(b.name));
  async function go() {
    setBusy(true);
    const r = await call<{ tasks: number; entriesCancelled: number }>("removeChecklistTasks", { doerId, reason, confirm });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not remove"); return; }
    toast.success(`${r.data!.tasks} checklist tasks removed (${r.data!.entriesCancelled} unfinished entries cancelled)`);
    setOpen(false); setConfirm(""); setReason("");
    refresh();
  }
  return (
    <>
      <Button variant="outline" size="sm" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}><Trash2Icon /> Remove checklist tasks</Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && !busy && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove checklist tasks</DialogTitle>
              <DialogDescription>The tasks are archived and their unfinished entries cancelled, so they vanish from everybody&apos;s checklist. Finished entries stay as history.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Whose tasks">
                <NativeSelect value={doerId} onChange={(e) => setDoerId(e.target.value)}>
                  <option value="">Everybody&apos;s</option>
                  {people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}
                </NativeSelect>
              </Field>
              {n && <p className="rounded-lg bg-muted px-3 py-2 text-sm">This removes <b>{n.tasks}</b> tasks and cancels <b>{n.pending}</b> unfinished entries. <b>{n.done}</b> finished entries stay.</p>}
              <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Test data, old tasks…" /></Field>
              <Field label="Type REMOVE to confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="REMOVE" autoComplete="off" /></Field>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Undo2Icon className="size-3" /> A task can be switched back on later in Task setup (its cancelled entries are not restored).</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={go} disabled={busy || confirm.trim().toUpperCase() !== "REMOVE" || !n || n.tasks === 0}>{busy ? <Spinner /> : "Remove"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
