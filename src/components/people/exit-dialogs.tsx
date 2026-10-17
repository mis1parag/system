"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LogOutIcon, PowerIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, Segmented, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import type { FlowUser } from "@/lib/flow-types";

const EXIT_TYPES = ["Resigned", "Terminated", "Retired", "Contract ended", "Absconded", "Other"];
type Mode = "exit" | "off" | "delete" | "back" | "on";

/** What can be done with one person: record that they left, switch them off, bring them back, or (Super Admin) delete a person who was added by mistake. */
export function RemoveUserDialog({ user, onClose }: { user: FlowUser; onClose: () => void }) {
  const { data, call, isSuper, today } = useFlows();
  const left = user.exitDone === "Y";
  const leaving = !!user.exitDate && !left;
  const off = user.status !== "Active";
  const [mode, setMode] = useState<Mode>(left ? "back" : off ? "on" : "exit");
  const [date, setDate] = useState(user.exitDate || today);
  const [type, setType] = useState(user.exitType || "Resigned");
  const [reason, setReason] = useState(user.exitReason ?? "");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const work = useMemo(() => {
    const openItems = new Set((data?.items ?? []).filter((i) => i.status === "Open").map((i) => i.itemId));
    return {
      steps: (data?.tasks ?? []).filter((t) => t.assigneeId === user.userId && t.status === "Pending" && openItems.has(t.itemId)).length,
      checklist: (data?.checklistTasks ?? []).filter((c) => c.doerId === user.userId && c.status === "Active").length,
      reports: (data?.users ?? []).filter((u) => u.managerId === user.userId && u.status === "Active").length,
    };
  }, [data, user.userId]);
  const colleagues = (data?.users ?? []).filter((u) => u.status === "Active" && u.userId !== user.userId).sort((a, b) => a.name.localeCompare(b.name));
  const future = date > today;
  const hasWork = work.steps + work.checklist + work.reports > 0;

  async function go() {
    setBusy(true);
    let r;
    if (mode === "exit") r = await call<{ applied: boolean; stepsMoved: number; checklistMoved: number; reportsMoved: number; flowEntry: string }>("recordExit", { userId: user.userId, exitDate: date, exitType: type, reason, handoverToId: to });
    else if (mode === "off" || mode === "on") r = await call("setUserStatus", { userId: user.userId, status: mode === "off" ? "Inactive" : "Active", note });
    else if (mode === "back") r = await call("reinstateUser", { userId: user.userId, note });
    else r = await call("deleteUser", { userId: user.userId, confirmName: confirm });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not do this"); return; }
    if (mode === "exit") {
      const d = r.data as { applied: boolean; stepsMoved: number; checklistMoved: number; flowEntry: string };
      toast.success(d.applied ? `${user.name}'s exit is recorded — the account is switched off${to ? `; ${d.stepsMoved} step(s) and ${d.checklistMoved} checklist task(s) handed over` : ""}` : `${user.name} leaves on ${fmtDate(date, true)} — the account is switched off that day`);
      if (d.flowEntry) toast.message("The Employee Exit checklist (FMS) was started");
    } else toast.success(mode === "off" ? "Switched off — they cannot sign in; their history stays" : mode === "delete" ? `${user.name} was deleted` : "Done");
    onClose();
  }

  const options: { value: Mode; label: string; sub?: string }[] = off && !left
    ? [{ value: "on", label: "Switch on" }, { value: "exit", label: "Record exit" }, ...(isSuper ? [{ value: "delete" as Mode, label: "Delete" }] : [])]
    : left ? [{ value: "back", label: "Reinstate" }]
      : [{ value: "exit", label: "Record exit" }, { value: "off", label: "Switch off" }, ...(isSuper ? [{ value: "delete" as Mode, label: "Delete" }] : [])];

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>
            {left ? `Left on ${fmtDate(user.exitDate!, true)}${user.exitType ? ` · ${user.exitType}` : ""}.` : leaving ? `Leaving on ${fmtDate(user.exitDate!, true)}.` : off ? "Switched off — cannot sign in." : "Active."}
          </DialogDescription>
        </DialogHeader>
        {options.length > 1 && <Segmented value={mode} onChange={setMode} options={options} />}

        {mode === "exit" && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Last working day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Kind of exit"><NativeSelect value={type} onChange={(e) => setType(e.target.value)}>{EXIT_TYPES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
            </div>
            <Field label="Who takes over their work?" hint={hasWork ? `They have ${work.steps} open FMS step(s), ${work.checklist} checklist task(s)${work.reports ? ` and ${work.reports} person(s) reporting to them` : ""}. These move to the person you choose.` : "They have no open work."}>
              <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}><option value="">— nobody yet —</option>{colleagues.map((u) => <option key={u.userId} value={u.userId}>{u.name}{u.department ? ` · ${u.department}` : ""}</option>)}</NativeSelect>
            </Field>
            <Field label="Note (only Admins see it)"><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, notice served, anything to remember" /></Field>
            <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              {future ? "The person stays active until the last working day; then the account is switched off automatically and the work is handed over." : "The account is switched off now: they can no longer sign in, logins they could open are closed, and pending leave requests are cancelled."} Their attendance, work and reports stay. If your company has the “Employee Exit” FMS, its checklist starts for this person.
            </p>
          </div>
        )}
        {(mode === "off" || mode === "on" || mode === "back") && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{mode === "off" ? "They cannot sign in until you switch them on again. Nothing is deleted. Use this for a long absence or a suspension." : mode === "on" ? "They can sign in again." : "They are active again and their exit details are cleared. The activity log keeps the history."}</p>
            <Field label="Note (optional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
        {mode === "delete" && (
          <div className="grid gap-3">
            <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">Delete removes the person from every list. Someone who has used the app must be switched off (or have their exit recorded) first, and nobody may still report to them. Their old attendance and work keep their name. This cannot be undone.</p>
            <Field label={`Type “${user.name}” to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={busy || (mode === "delete" && confirm.trim() !== user.name) || (mode === "exit" && !date)} variant={mode === "delete" || mode === "exit" || mode === "off" ? "destructive" : "default"}>
            {busy ? <Spinner /> : mode === "exit" ? <LogOutIcon /> : mode === "delete" ? <Trash2Icon /> : mode === "off" ? <PowerIcon /> : <RotateCcwIcon />}
            {mode === "exit" ? (future ? "Record planned exit" : "Record exit") : mode === "off" ? "Switch off" : mode === "on" ? "Switch on" : mode === "back" ? "Reinstate" : "Delete person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
