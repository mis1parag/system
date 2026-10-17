"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/common";
import { addDays, fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

/** Ask for more time on a checklist task: your reporting manager (or the Super Admin) approves, as for an FMS step. */
export function ChecklistMoreTimeDialog({ clId, title, plannedDate, onClose }: { clId: string; title: string; plannedDate: string; onClose: () => void }) {
  const { call } = useFlows();
  const [date, setDate] = useState(addDays(plannedDate, 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await call("requestChecklistTime", { clId, newDate: date, reason });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not send the request"); return; }
    toast.success("Request sent — your manager is told"); onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>More time: {title}</DialogTitle><DialogDescription>Planned for {fmtDate(plannedDate, true)}. It moves to the new day only when it is approved.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="New date"><Input type="date" min={addDays(plannedDate, 1)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Why do you need more time?"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: waiting for the vendor's reply" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy || !reason.trim() || !date}>{busy && <Spinner />} Ask for more time</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
