"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

/** Move unfinished work to another day and / or hand it to someone else. Only for people the Super Admin has allowed ("Move work"). */
export function MoveDialog({ kind, ids, onClose }: { kind: "checklist" | "fms"; ids: string[]; onClose: (done: boolean) => void }) {
  const { peopleFor, call, meId, today } = useFlows();
  const people = peopleFor(kind === "fms" ? "fms" : "checklist");
  const [when, setWhen] = useState("next");
  const [date, setDate] = useState(today);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr("");
    const r = await call<{ moved: number; skipped: { id: string; reason: string }[] }>("moveWork", { kind, ids, when: when === "keep" ? "" : when === "date" ? date : when, toUserId: who, note });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not move"); return; }
    const { moved, skipped } = r.data!;
    toast.success(`${moved} moved${skipped.length ? ` · ${skipped.length} left as they were (${skipped[0].reason})` : ""}`);
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move or hand over {ids.length} {kind === "checklist" ? "task" : "step"}{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>The person is told. The change is kept in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Day">
            <NativeSelect value={when} onChange={(e) => setWhen(e.target.value)}>
              <option value="next">Next working day</option><option value="today">Today</option><option value="date">Pick a date…</option><option value="keep">Keep the same day</option>
            </NativeSelect>
          </Field>
          {when === "date" && <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
          <Field label="Hand over to (optional)" hint="Leave empty to keep the same person.">
            <NativeSelect value={who} onChange={(e) => setWho(e.target.value)}><option value="">Same person</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.userId === meId ? "Me" : u.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was moved" /></Field>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy || (when === "keep" && !who)}>{busy ? <Spinner /> : "Move"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
