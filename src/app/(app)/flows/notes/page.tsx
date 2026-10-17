"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, ClipboardCheckIcon, LockIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBox, PageHeader, Pill, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Note { noteId: string; text: string; done: string; dueDate: string; createdAt: string; updatedAt: string; convertedTo: string }

/** A private notepad. Notes are saved on the server for you alone: your manager, admins and the Super Admin cannot see them, and they are never part of any task list, report or score. */
export default function NotesPage() {
  const { call, has } = useFlows();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<"open" | "done" | "all">("open");

  const load = useCallback(async () => {
    const r = await call<{ notes: Note[] }>("listNotes", {});
    if (r.ok) { setNotes(r.data!.notes); setError(""); } else setError(r.error || "Could not load your notes");
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const put = (n: Note) => setNotes((cur) => (cur ? (cur.some((x) => x.noteId === n.noteId) ? cur.map((x) => (x.noteId === n.noteId ? n : x)) : [n, ...cur]) : [n]));

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const r = await call<Note>("saveNote", { text, dueDate: due });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    put(r.data!); setDraft(""); setDue("");
  }

  const shown = useMemo(() => (notes ?? []).filter((n) => (show === "all" ? true : show === "done" ? n.done === "Y" : n.done !== "Y")), [notes, show]);
  const open = (notes ?? []).filter((n) => n.done !== "Y").length;

  return (
    <>
      <PageHeader title="My notes" subtitle={<span className="inline-flex items-center gap-1.5"><LockIcon className="size-3.5" /> Private: only you can see these. They are not tasks, are not counted in any report and nobody is notified.</span>} />
      <div className="mb-4 grid gap-2 rounded-xl border bg-card p-3">
        <Textarea
          value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} aria-label="New note"
          placeholder="Write a note or a to-do… (Ctrl+Enter to save)"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Remind me on <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40" /></label>
          <Button className="ml-auto" onClick={add} disabled={!draft.trim() || busy}>{busy ? <Spinner /> : <PlusIcon />} Add note</Button>
        </div>
      </div>
      <div className="mb-3 flex gap-1.5">
        {([["open", `To do (${open})`], ["done", "Done"], ["all", "All"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setShow(k)} aria-pressed={show === k} className={cn("rounded-full border px-3 py-1 text-xs font-medium", show === k ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{l}</button>
        ))}
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!notes && !error && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening your notes…</p>}
      {notes && shown.length === 0 && <EmptyState title={show === "done" ? "Nothing ticked off yet" : "No notes yet"} hint="Jot down anything you want to remember — it stays between you and this page." />}
      <div className="grid gap-2">
        {shown.map((n) => <Row key={n.noteId} note={n} onChange={put} onGone={(id) => setNotes((cur) => (cur ?? []).filter((x) => x.noteId !== id))} canTask={has("checklist")} />)}
      </div>
    </>
  );
}

function Row({ note, onChange, onGone, canTask }: { note: Note; onChange: (n: Note) => void; onGone: (id: string) => void; canTask: boolean }) {
  const { call, today } = useFlows();
  const [text, setText] = useState(note.text);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const last = useRef(note.text);
  const done = note.done === "Y";

  async function save() {
    const t = text.trim();
    if (!t || t === last.current) { if (!t) setText(last.current); return; }
    setState("saving");
    const r = await call<Note>("saveNote", { noteId: note.noteId, text: t, dueDate: note.dueDate });
    if (!r.ok) { toast.error(r.error || "Could not save"); setState(""); return; }
    last.current = t; onChange(r.data!); setState("saved"); setTimeout(() => setState(""), 1500);
  }
  async function toggle() {
    onChange({ ...note, done: done ? "" : "Y" }); // shown at once; put back if the server says no
    const r = await call<Note>("toggleNote", { noteId: note.noteId, done: !done });
    if (!r.ok) { onChange(note); toast.error(r.error || "Could not update"); } else onChange(r.data!);
  }
  async function remove() {
    if (!window.confirm("Delete this note?")) return;
    const r = await call("deleteNote", { noteId: note.noteId });
    if (!r.ok) toast.error(r.error || "Could not delete"); else onGone(note.noteId);
  }
  async function makeTask() {
    if (!window.confirm("Make this an official task for yourself? It will appear in your Checklist and count in your reports. The note stays here.")) return;
    const r = await call<{ note: Note }>("convertNote", { noteId: note.noteId, dueDate: note.dueDate || today });
    if (!r.ok) toast.error(r.error || "Could not make a task"); else { onChange(r.data!.note); toast.success("Added to your Checklist"); }
  }

  return (
    <div className={cn("flex items-start gap-2 rounded-lg border bg-card p-2.5", done && "opacity-60")}>
      <button onClick={toggle} aria-label={done ? "Mark as not done" : "Mark as done"} aria-pressed={done} className={cn("mt-1 flex size-5 shrink-0 items-center justify-center rounded border", done ? "border-primary bg-primary text-white" : "border-input hover:border-primary")}>{done && <CheckIcon className="size-3.5" />}</button>
      <div className="min-w-0 flex-1">
        <Textarea value={text} rows={Math.min(6, Math.max(1, text.split("\n").length))} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Note" maxLength={2000} className={cn("min-h-0 resize-none border-transparent bg-transparent px-1 py-0.5 shadow-none focus-visible:border-input", done && "line-through")} />
        <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {note.dueDate && <Pill tone={!done && note.dueDate < today ? "red" : "gray"}>{fmtDate(note.dueDate)}</Pill>}
          {note.convertedTo && <Pill tone="violet">Official task</Pill>}
          <span>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : `Edited ${fmtDate(note.updatedAt.slice(0, 10))}`}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {canTask && !note.convertedTo && !done && <Button size="icon-sm" variant="ghost" onClick={makeTask} title="Make this an official task" aria-label="Make this an official task"><ClipboardCheckIcon /></Button>}
        <Button size="icon-sm" variant="ghost" className="text-red-700" onClick={remove} aria-label="Delete note"><Trash2Icon /></Button>
      </div>
    </div>
  );
}
