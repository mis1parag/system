"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarPlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, Field, PageHeader, Pill, Section, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

export default function TeamPage() {
  const { can } = useFlows();
  const isAdmin = can("manageHolidays");
  return (
    <>
      <PageHeader title="Absence & Holidays" subtitle="When someone is away, their steps move to a backup automatically. Holidays are skipped in planned times." />
      <Tabs defaultValue="absence">
        <div className="mb-3"><TabsList><TabsTrigger value="absence">Absence</TabsTrigger>{isAdmin && <TabsTrigger value="holidays">Holidays</TabsTrigger>}</TabsList></div>
        <TabsContent value="absence"><Absences /></TabsContent>
        {isAdmin && <TabsContent value="holidays"><Holidays /></TabsContent>}
      </Tabs>
    </>
  );
}

function Absences() {
  const { data, userName, today, can, meId, call, inReach } = useFlows();
  const isAdmin = can("manageHolidays");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const rows = useMemo(() => [...(data?.absences ?? [])].filter((a) => inReach(a.userId) || a.backupUserId === meId).sort((a, b) => b.fromDate.localeCompare(a.fromDate)), [data, inReach, meId]);
  const current = rows.filter((a) => a.fromDate <= today && a.toDate >= today);
  const upcoming = rows.filter((a) => a.fromDate > today);
  const past = rows.filter((a) => a.toDate < today);

  async function remove(id: string) {
    setBusy(id);
    const r = await call("deleteAbsence", { absenceId: id });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success("Absence removed — tasks return to the original person");
  }
  const list = (title: string, items: typeof rows, tone: "violet" | "blue" | "gray") => (
    <Section title={<span className="flex items-center gap-2">{title} <Pill tone={tone}>{items.length}</Pill></span>}>
      {items.length === 0 ? <div className="text-xs text-muted-foreground">None</div> : (
        <div className="grid gap-2">
          {items.map((a) => (
            <div key={a.absenceId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{userName(a.userId)} <span className="font-normal text-muted-foreground">→ backup {userName(a.backupUserId)}</span></div>
                <div className="text-xs text-muted-foreground">{fmtDate(a.fromDate, true)}{a.toDate !== a.fromDate ? ` – ${fmtDate(a.toDate, true)}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
              </div>
              {(isAdmin || a.userId === meId) && a.toDate >= today && (
                <Button size="icon-sm" variant="ghost" className="text-red-700" disabled={busy === a.absenceId} onClick={() => remove(a.absenceId)} aria-label="Remove absence"><Trash2Icon /></Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );

  return (
    <div className="grid gap-4">
      <div><Button onClick={() => setAdding(true)}><CalendarPlusIcon /> {isAdmin ? "Mark someone absent" : "Mark my absence"}</Button></div>
      {rows.length === 0 && <EmptyState title="Nobody is away" hint="Mark an absence and pick a backup; the steps planned in that period move to the backup." />}
      {list("Away now", current, "violet")}
      {list("Upcoming", upcoming, "blue")}
      {past.length > 0 && list("Recent (last 60 days)", past.slice(0, 20), "gray")}
      {adding && <AbsenceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AbsenceDialog({ onClose }: { onClose: () => void }) {
  const { data, can, meId, call, today, userName, peopleFor } = useFlows();
  const reach = peopleFor("attendance");
  const isAdmin = can("manageHolidays") && reach.length > 1;
  const everyone = (data?.users ?? []).filter((u) => u.status === "Active");
  const people = isAdmin ? reach : everyone;
  const [userId, setUserId] = useState(meId);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [backup, setBackup] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const affected = useMemo(() => (data?.tasks ?? []).filter((t) => !t.actual && t.assigneeId === userId && t.planned && t.planned.slice(0, 10) >= from && t.planned.slice(0, 10) <= to &&
    data?.items.find((i) => i.itemId === t.itemId)?.status === "Open").length, [data, userId, from, to]);

  async function save() {
    setBusy(true); setErr("");
    const r = await call("createAbsence", { userId, fromDate: from, toDate: to, backupUserId: backup, reason });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(`Saved — ${userName(backup)} will cover`);
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{userId === meId ? "Mark my absence" : `Mark ${userName(userId)} absent`}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {isAdmin && <Field label="Who is away"><NativeSelect value={userId} onChange={(e) => { setUserId(e.target.value); if (e.target.value === backup) setBackup(""); }}>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Input type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
            <Field label="To (last day away)"><Input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="Backup person *" hint={backup ? `${affected} open step${affected === 1 ? "" : "s"} planned in this period will go to ${userName(backup)}.` : "Steps planned in this period move to the backup."}>
            <NativeSelect value={backup} onChange={(e) => setBackup(e.target.value)}><option value="">Select…</option>{everyone.filter((u) => u.userId !== userId).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Leave, training, sick…" /></Field>
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !backup}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Holidays() {
  const { data, flows, call } = useFlows();
  const [flowId, setFlowId] = useState("");
  const [dates, setDates] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rows = useMemo(() => [...(data?.holidays ?? [])].filter((h) => h.date >= "2000").sort((a, b) => a.date.localeCompare(b.date)), [data]);
  const upcoming = rows.filter((h) => h.date >= new Date().toISOString().slice(0, 10));

  async function add() {
    const list = dates.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(x);
      return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : x;
    });
    setBusy(true); setErr("");
    const r = await call<{ added: number; skipped: number; replanned: number }>("addHolidays", { dates: list, label, flowId });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    setDates(""); setLabel("");
    toast.success(`${r.data!.added} holiday${r.data!.added === 1 ? "" : "s"} added · ${r.data!.replanned} pending steps re-planned`);
  }
  async function remove(id: string) {
    const r = await call("deleteHoliday", { holidayId: id });
    if (!r.ok) toast.error(r.error || "Failed");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="Add holidays" hint="Weekly-off days (like Sunday) are set per FMS — add only real holidays here." className="lg:col-span-1">
        <Field label="Applies to"><NativeSelect value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">All FMS</option>{flows.map((f) => <option key={f.flowId} value={f.flowId}>{f.name}</option>)}</NativeSelect></Field>
        <Field label="Dates" hint="One per line or comma separated. yyyy-mm-dd or dd/mm/yyyy"><Textarea rows={4} value={dates} onChange={(e) => setDates(e.target.value)} placeholder={"2026-11-08\n12/11/2026"} /></Field>
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Diwali" /></Field>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <Button onClick={add} disabled={busy || !dates.trim()}>{busy ? <Spinner /> : "Add holidays"}</Button>
      </Section>
      <Section title={`Upcoming holidays (${upcoming.length})`} className="lg:col-span-2">
        {upcoming.length === 0 ? <div className="text-xs text-muted-foreground">No upcoming holidays added</div> : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {upcoming.slice(0, 60).map((h) => (
              <div key={h.holidayId} className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm">
                <span>{fmtDate(h.date, true)} <span className="text-xs text-muted-foreground">{h.label}{h.flowId ? ` · ${flows.find((f) => f.flowId === h.flowId)?.name ?? h.flowId}` : ""}</span></span>
                <button onClick={() => remove(h.holidayId)} className="text-muted-foreground hover:text-red-700" aria-label="Remove holiday"><Trash2Icon className="size-4" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{rows.length - upcoming.length} past holidays are kept for history.</p>
      </Section>
    </div>
  );
}
