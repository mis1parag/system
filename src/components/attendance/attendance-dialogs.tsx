"use client";
/* eslint-disable @next/next/no-img-element -- punch photos are small data: URLs, nothing to optimise */

import { useState } from "react";
import { toast } from "sonner";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, Spinner } from "@/components/common";
import { LEAVE_TYPES } from "@/lib/flow-types";
import { fmtDate, weekdayName } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { leaveDays } from "@/lib/attendance";
import { useAttendance } from "@/components/attendance/use-attendance";

/** Everything punched on one day by one person. Admins can add, correct or remove punches. */
export function DayDialog({ userId, date, onClose }: { userId: string; date: string; onClose: () => void }) {
  const { data, can, userName, call } = useFlows();
  const isAdmin = can("editAttendance");
  const rows = (data?.attendance ?? []).filter((r) => r.userId === userId && r.date === date).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const [cin, setIn] = useState("");
  const [cout, setOut] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function add() {
    setBusy("add"); setErr("");
    const r = await call("markAttendance", { userId, date, checkIn: cin, checkOut: cout, note });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    setIn(""); setOut(""); setNote("");
    toast.success("Saved");
  }
  async function del(attId: string) {
    setBusy(attId);
    const r = await call("deleteAttendance", { attId });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success("Removed");
  }
  async function fix(attId: string, checkIn: string, checkOut: string) {
    setBusy(attId); setErr("");
    const r = await call("markAttendance", { attId, checkIn, checkOut });
    setBusy("");
    if (!r.ok) setErr(r.error || "Could not save"); else toast.success("Corrected");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{userName(userId)} · {weekdayName(date).slice(0, 3)} {fmtDate(date, true)}</DialogTitle></DialogHeader>
        <div className="grid gap-2 text-sm">
          {rows.length === 0 && <p className="text-muted-foreground">No check-in on this day.</p>}
          {rows.map((r) => (
            <PunchRow key={r.attId + r.checkOut} r={r} editable={isAdmin} busy={busy === r.attId} onSave={(i, o) => fix(r.attId, i, o)} onDelete={() => del(r.attId)} />
          ))}
        </div>
        {isAdmin && (
          <div className="mt-2 grid gap-2 rounded-xl border bg-muted/40 p-3">
            <div className="text-xs font-medium">Add a punch (forgot to check in / out)</div>
            <div className="grid grid-cols-2 gap-2"><Field label="Check in"><Input type="time" value={cin} onChange={(e) => setIn(e.target.value)} /></Field><Field label="Check out"><Input type="time" value={cout} onChange={(e) => setOut(e.target.value)} /></Field></div>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was added" /></Field>
            <Button size="sm" className="w-fit" disabled={!cin || busy === "add"} onClick={add}>{busy === "add" ? <Spinner /> : "Add punch"}</Button>
          </div>
        )}
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhotoLink({ id, label }: { id: string; label: string }) {
  const { call } = useFlows();
  const [img, setImg] = useState("");
  const [busy, setBusy] = useState(false);
  async function show() {
    if (img) { setImg(""); return; }
    setBusy(true);
    const r = await call<{ image: string }>("getPunchPhoto", { photoId: id });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not load the photo"); else setImg(r.data!.image);
  }
  return (
    <span className="inline-block">
      <button type="button" onClick={show} disabled={busy} className="inline-flex items-center gap-1 text-primary underline"><CameraIcon className="size-3" /> {label}</button>
      {img && <span className="mt-1 block"><img src={img} alt={`${label} photo`} className="w-40 rounded-lg border" /></span>}
    </span>
  );
}

function PunchRow({ r, editable, busy, onSave, onDelete }: { r: { checkIn: string; inPhoto: string; outPhoto: string; checkOut: string; lat: number | null; lng: number | null; note: string; source: string }; editable: boolean; busy: boolean; onSave: (i: string, o: string) => void; onDelete: () => void }) {
  const [i, setI] = useState(r.checkIn.slice(11));
  const [o, setO] = useState(r.checkOut.slice(11));
  const dirty = i !== r.checkIn.slice(11) || o !== r.checkOut.slice(11);
  return (
    <div className="rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <>
            <Input type="time" className="h-9 w-28" value={i} onChange={(e) => setI(e.target.value)} aria-label="Check in" />→
            <Input type="time" className="h-9 w-28" value={o} onChange={(e) => setO(e.target.value)} aria-label="Check out" />
            {dirty && <Button size="sm" disabled={busy || !i} onClick={() => onSave(i, o)}>Save</Button>}
            <Button size="icon-sm" variant="ghost" className="ml-auto text-red-700" disabled={busy} aria-label="Remove punch" onClick={onDelete}><Trash2Icon /></Button>
          </>
        ) : <span className="font-medium">{r.checkIn.slice(11)} → {r.checkOut ? r.checkOut.slice(11) : "not checked out"}</span>}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{r.source === "app" ? "Punched in the app" : r.source === "kiosk" ? "Office kiosk" : r.source === "manual" ? "Added by an admin" : "Imported"}{r.lat != null && r.lng != null && <> · <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}>map</a></>}{r.note ? ` · ${r.note}` : ""}{(r.inPhoto || r.outPhoto) && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{r.inPhoto && <PhotoLink id={r.inPhoto} label="check-in photo" />}{r.outPhoto && <PhotoLink id={r.outPhoto} label="check-out photo" />}</div>}</div>
    </div>
  );
}

/** Ask for leave. A full-day leave with a backup also moves the person's FMS steps to the backup once approved. */
export function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { data, meId, today, call, peopleFor, allow } = useFlows();
  const isAdmin = allow("attendance", "manage");
  const reach = peopleFor("attendance");
  const att = useAttendance();
  const people = (data?.users ?? []).filter((u) => u.status === "Active"); // anyone can be a backup
  const forOthers = isAdmin && reach.length > 1;
  const [who, setWho] = useState(meId);
  const [type, setType] = useState<string>("Full Day");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [backup, setBackup] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const days = leaveDays(type, from, type === "Full Day" ? to : from, att.cal);

  async function save() {
    setBusy(true); setErr("");
    const r = await call("requestLeave", { userId: who, type, startDate: from, endDate: to, reason, backupUserId: backup });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not send"); return; }
    toast.success("Leave requested — you will be told when it is decided");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ask for leave</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {forOthers && <Field label="For"><NativeSelect value={who} onChange={(e) => setWho(e.target.value)}>{reach.map((u) => <option key={u.userId} value={u.userId}>{u.userId === meId ? "Me" : u.name}</option>)}</NativeSelect></Field>}
          <Field label="Type"><NativeSelect value={type} onChange={(e) => setType(e.target.value)}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={type === "Full Day" ? "From" : "Date"}><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
            {type === "Full Day" && <Field label="To (last day)"><Input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">{type === "Short Leave" ? "A short leave (a few hours) does not use up leave days." : `${days} leave day${days === 1 ? "" : "s"} (weekly-off days and holidays are not counted).`}</p>
          <Field label="Reason *"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {type === "Full Day" && <Field label="Who covers your work? (optional)" hint="After approval your FMS steps go to this person automatically."><NativeSelect value={backup} onChange={(e) => setBackup(e.target.value)}><option value="">—</option>{people.filter((u) => u.userId !== who).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !reason.trim()}>{busy ? <Spinner /> : "Send request"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
