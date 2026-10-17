"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BellRingIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBox, Field, PageHeader, Pill, Spinner } from "@/components/common";
import { fmtDT } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Reminder { remId: string; batchId: string; fromId: string; toId: string; message: string; relatedType: string; relatedTitle: string; link: string; dueDate: string; status: string; createdAt: string; readAt: string }
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function RemindersPage() {
  const { allow, isSuper } = useFlows();
  const canSend = isSuper || allow("reminders", "create");
  const sp = useSearchParams();
  const [tab, setTab] = useState<"inbox" | "send" | "sent">(sp.get("to") && canSend ? "send" : "inbox");
  return (
    <>
      <PageHeader title="Reminders" subtitle="Reminders sent to you, and — for managers — reminders to your team." />
      <div className="mb-4 flex gap-1.5">
        {([["inbox", "For me"], ...(canSend ? [["send", "Send a reminder"], ["sent", "Sent by me"]] : [])] as [typeof tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("rounded-full border px-3 py-1 text-xs font-medium", tab === k ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{l}</button>
        ))}
      </div>
      {tab === "send" ? <Send onSent={() => setTab("sent")} /> : <List box={tab === "sent" ? "sent" : "inbox"} />}
    </>
  );
}

function List({ box }: { box: "inbox" | "sent" }) {
  const { call, userName, refresh } = useFlows();
  const [rows, setRows] = useState<Reminder[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRows(null);
    const r = await call<{ reminders: Reminder[] }>("listReminders", { box });
    if (r.ok) { setRows(r.data!.reminders); setError(""); } else setError(r.error || "Could not load");
  }, [call, box]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function markRead(r: Reminder) {
    if (box !== "inbox" || r.readAt) return;
    const res = await call<Reminder>("readReminder", { remId: r.remId });
    if (res.ok) { setRows((cur) => (cur ?? []).map((x) => (x.remId === r.remId ? res.data! : x))); refresh(); }
  }
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!rows) return <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening…</p>;
  if (!rows.length) return <EmptyState title={box === "inbox" ? "No reminders for you" : "You have not sent any reminder yet"} hint={box === "inbox" ? "When your manager sends you a reminder it shows here and in the bell." : undefined} />;
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <div key={r.remId} className={cn("flex items-start gap-3 rounded-lg border bg-card p-3", box === "inbox" && !r.readAt && "border-primary/40 bg-[#faf9ff]")}>
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#efeeff] text-primary"><BellRingIcon className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm"><b>{box === "inbox" ? userName(r.fromId) : `To ${userName(r.toId)}`}</b> <span className="text-xs text-muted-foreground">{fmtDT(r.createdAt)}</span></div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{r.message}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {r.relatedTitle && (r.link ? <Link href={r.link} onClick={() => markRead(r)} className="font-medium text-primary hover:underline">{r.relatedTitle}</Link> : <span>{r.relatedTitle}</span>)}
              {r.dueDate && <Pill tone="amber">Due {r.dueDate.slice(0, 10)}</Pill>}
              {box === "sent" && <Pill tone={r.readAt ? "green" : "gray"}>{r.readAt ? "Read" : "Sent"}</Pill>}
              {box === "inbox" && !r.readAt && <Button size="sm" variant="outline" onClick={() => markRead(r)}>Mark as read</Button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Send({ onSent }: { onSent: () => void }) {
  const { data, call, peopleFor, meId, userName, today } = useFlows();
  const people = peopleFor("reminders").filter((p) => p.userId !== meId);
  const sp = useSearchParams();
  const [pick, setPick] = useState<Set<string>>(() => new Set(sp.get("to") ? [sp.get("to")!] : []));
  const [q, setQ] = useState("");
  const [message, setMessage] = useState("");
  const [due, setDue] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ count: number; recipients: { userId: string; name: string }[]; about: string } | null>(null);
  const key = useRef(newKey());

  const shown = useMemo(() => people.filter((p) => !q || `${p.name} ${p.department}`.toLowerCase().includes(q.toLowerCase())), [people, q]);
  // what a reminder can be about: only for ONE person, and only open work that person has
  const one = pick.size === 1 ? [...pick][0] : "";
  const options = useMemo(() => {
    if (!one) return [] as { value: string; label: string; type: string }[];
    const items = new Map((data?.items ?? []).map((i) => [i.itemId, i]));
    const fms = (data?.tasks ?? []).filter((t) => t.assigneeId === one && t.status === "Pending" && items.get(t.itemId)?.status === "Open").slice(0, 60).map((t) => ({ value: `fms:${t.taskId}`, label: `${items.get(t.itemId)?.title ?? "FMS entry"} — ${t.planned ? `due ${t.planned.slice(0, 10)}` : "open step"}`, type: "fms" }));
    const cl = (data?.checklistTasks ?? []).filter((c) => c.doerId === one && c.status === "Active").slice(0, 40).map((c) => ({ value: `checklist:${c.ctId}`, label: `Checklist: ${c.title}`, type: "checklist" }));
    return [...fms, ...cl];
  }, [one, data]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (about && !options.some((o) => o.value === about)) setAbout(""); }, [options, about]);

  const toggle = (id: string) => setPick((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const payload = () => { const [relatedType, relatedId] = about ? about.split(":") : ["", ""]; return { toIds: [...pick], message, dueDate: due, relatedType, relatedId }; };

  async function review() {
    if (!pick.size) { toast.error("Choose at least one person"); return; }
    if (!message.trim()) { toast.error("Write the reminder"); return; }
    setBusy(true);
    const r = await call<NonNullable<typeof preview>>("sendReminders", { ...payload(), preview: true });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not prepare the reminder"); else setPreview(r.data!);
  }
  async function send() {
    if (busy) return; // a second click while sending does nothing
    setBusy(true);
    const r = await call<{ sent: number; duplicate: boolean }>("sendReminders", { ...payload(), sendKey: key.current });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not send"); return; }
    toast.success(r.data!.duplicate ? "This reminder was already sent" : `Reminder sent to ${r.data!.sent} ${r.data!.sent === 1 ? "person" : "people"}`);
    key.current = newKey(); setPreview(null); setPick(new Set()); setMessage(""); setDue(""); setAbout(""); onSent();
  }

  if (!people.length) return <EmptyState title="Nobody to remind" hint="Reminders go to the people who report to you. Ask the Super Admin to set reporting managers." />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="h-8" aria-label="Search people" />
          <Button size="sm" variant="outline" onClick={() => setPick(new Set(shown.map((p) => p.userId)))}>All{q ? " shown" : ""}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPick(new Set())}>None</Button>
        </div>
        <div className="grid max-h-[26rem] gap-1 overflow-y-auto">
          {shown.map((p) => (
            <label key={p.userId} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted", pick.has(p.userId) && "bg-[#efeeff]")}>
              <input type="checkbox" checked={pick.has(p.userId)} onChange={() => toggle(p.userId)} />
              <Avatar userId={p.userId} size={24} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-xs text-muted-foreground">{p.department}</span>
            </label>
          ))}
          {!shown.length && <div className="p-2 text-xs text-muted-foreground">No one matches.</div>}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{pick.size} selected</div>
      </div>
      <div className="grid content-start gap-3 rounded-xl border bg-card p-3">
        <Field label="Message"><Textarea rows={4} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: Please share the PO status by 5 pm." /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due date (optional)"><Input type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="About (optional)" hint={pick.size === 1 ? undefined : "Choose exactly one person to attach a task"}>
            <NativeSelect value={about} onChange={(e) => setAbout(e.target.value)} disabled={options.length === 0}>
              <option value="">Nothing in particular</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Button onClick={review} disabled={busy || !pick.size || !message.trim()} className="justify-self-end">{busy ? <Spinner /> : <SendIcon />} Review and send</Button>
      </div>
      {preview && (
        <Dialog open onOpenChange={(v) => !v && !busy && setPreview(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send this reminder to {preview.count} {preview.count === 1 ? "person" : "people"}?</DialogTitle></DialogHeader>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{message}{preview.about && <div className="mt-1.5 text-xs text-muted-foreground">About: {preview.about}</div>}{due && <div className="text-xs text-muted-foreground">Due {due}</div>}</div>
            <div className="flex flex-wrap gap-1">{preview.recipients.slice(0, 40).map((r) => <Pill key={r.userId} tone="violet">{userName(r.userId)}</Pill>)}{preview.count > 40 && <Pill>+{preview.count - 40} more</Pill>}</div>
            <DialogFooter><Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>Back</Button><Button onClick={send} disabled={busy}>{busy ? <Spinner /> : <SendIcon />} Send now</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
