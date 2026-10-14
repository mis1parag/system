"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, ClockIcon, HourglassIcon, LockIcon, PencilIcon, SendIcon, Trash2Icon, UserRoundCogIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Field, Pill, Spinner } from "@/components/common";
import { EntryForm } from "@/components/flow/entry-form";
import { FieldInput, FieldValue, PriorityPill, TagChips } from "@/components/flow/fields";
import { absentOn, delayMinutes, effectiveAssignee, itemData, itemStatusLabel, slaState, taskData, taskState } from "@/lib/flow";
import type { Flow, FlowComment, FlowItem, FlowRequest, FlowStep, FlowTask } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { addDays, fmtDT, fmtDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function stateTone(s: ReturnType<typeof taskState>): "green" | "red" | "amber" | "gray" | "blue" {
  return s === "done" ? "green" : s === "overdue" ? "red" : s === "today" ? "amber" : s === "upcoming" ? "blue" : "gray";
}

/** Complete a step: remarks, the step's own data fields, and (rarely) a different completion time. */
export function DoneDialog({ task, step, itemTitle, onClose }: { task: FlowTask; step?: FlowStep; itemTitle: string; onClose: () => void }) {
  const { call, now } = useFlows();
  const [remarks, setRemarks] = useState("");
  const [at, setAt] = useState("");
  const [data, setData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const r = await call("completeTask", { taskId: task.taskId, remarks, data, actual: at ? at.replace("T", " ") : undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success("Marked done");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Mark done</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-lg bg-muted p-2.5 text-sm"><div className="font-medium">{step?.name}</div><div className="text-xs text-muted-foreground">{itemTitle}{step?.how ? ` · ${step.how}` : ""}</div></div>
          {(step?.completionFields ?? []).map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}><FieldInput field={f} value={data[f.key] ?? ""} onChange={(x) => setData({ ...data, [f.key]: x })} /></Field>
          ))}
          <Field label="Remarks (optional)"><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Aakash confirmed, docket no. 4521" /></Field>
          <Field label="Done at" hint="Leave empty for right now. Change only if you are entering this later."><Input type="datetime-local" className="h-10" max={now().replace(" ", "T")} value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : <><CheckIcon /> Done</>}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ task, onClose }: { task: FlowTask; onClose: () => void }) {
  const { data, call, userName } = useFlows();
  const [to, setTo] = useState(task.assigneeId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const people = (data?.users ?? []).filter((u) => u.status === "Active");
  async function save() {
    setBusy(true); setErr("");
    const r = await call("reassignTask", { taskId: task.taskId, assigneeId: to });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(`Reassigned to ${userName(to)}`);
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reassign this step</DialogTitle></DialogHeader>
        <Field label="New responsible person"><NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || to === task.assigneeId}>{busy ? <Spinner /> : "Reassign"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "I need more time": the doer proposes a new planned time; an admin or the doer's manager approves. */
export function ExtensionDialog({ task, step, itemTitle, onClose }: { task: FlowTask; step?: FlowStep; itemTitle: string; onClose: () => void }) {
  const { call, now } = useFlows();
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const r = await call("requestExtension", { taskId: task.taskId, newPlanned: when.replace("T", " "), reason });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not send"); return; }
    toast.success("Request sent for approval");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ask for more time</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-lg bg-muted p-2.5 text-sm"><div className="font-medium">{step?.name}</div><div className="text-xs text-muted-foreground">{itemTitle} · now planned {fmtDT(task.planned)}</div></div>
          <Field label="New planned time *"><Input type="datetime-local" className="h-10" min={(task.planned || now()).replace(" ", "T")} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Why do you need it? *"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !when || !reason.trim()}>{busy ? <Spinner /> : <><SendIcon /> Send request</>}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostponeDialog({ item, flow, onClose }: { item: FlowItem; flow: Flow; onClose: () => void }) {
  const { call } = useFlows();
  const [days, setDays] = useState<number | null>(1);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const label = flow.fields.find((f) => f.key === flow.anchorField)?.label ?? "Date";
  async function save() {
    setBusy(true); setErr("");
    const r = await call("postponeEntry", custom ? { itemId: item.itemId, newAnchor: custom.replace("T", " "), reason } : { itemId: item.itemId, days, reason });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not postpone"); return; }
    toast.success("Postponed — pending steps re-planned");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Postpone · {label}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">Currently {fmtDT(item.anchorDate, true)}. Steps that are not done yet get new planned times (weekly-off days and holidays are skipped) and the people involved are notified.</p>
          <Field label="Move by">
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 5, 7].map((n) => (
                <button key={n} type="button" onClick={() => { setDays(n); setCustom(""); }} className={cn("h-9 rounded-full border px-3 text-xs font-medium", days === n && !custom ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>+{n} day{n > 1 ? "s" : ""}</button>
              ))}
            </div>
          </Field>
          <Field label="…or pick the exact new date"><Input type="datetime-local" className="h-10" min={addDays(item.anchorDate.slice(0, 10), 0)} value={custom} onChange={(e) => { setCustom(e.target.value); setDays(null); }} /></Field>
          <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hub asked for a new slot" /></Field>
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !reason.trim() || (!days && !custom)}>{busy ? <Spinner /> : "Postpone"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Detail { comments: FlowComment[]; requests: FlowRequest[]; trail: { timestamp: string; user: string; action: string; oldValue: string; newValue: string }[] }

export function EntryPanel({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { data, flows, allow, inReach, meId, userName, now, today, call, tasksOf } = useFlows();
  const canDelete = allow("fms", "delete"), canUndo = allow("fms", "delete"), canManage = allow("fms", "manage");
  const [done, setDone] = useState<FlowTask | null>(null);
  const [reassign, setReassign] = useState<FlowTask | null>(null);
  const [extend, setExtend] = useState<FlowTask | null>(null);
  const [postpone, setPostpone] = useState(false);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [comment, setComment] = useState("");
  const item = data?.items.find((i) => i.itemId === itemId);
  const flow = flows.find((f) => f.flowId === item?.flowId);
  const tasksKey = item ? tasksOf(item.itemId).map((t) => t.updatedAt).join() : "";

  // comments, requests and the activity trail are loaded on demand (and again after every change to this entry)
  useEffect(() => {
    let alive = true;
    call<Detail>("getItemDetail", { itemId }).then((r) => { if (alive && r.ok) setDetail(r.data!); });
    return () => { alive = false; };
  }, [itemId, tasksKey, call]);

  if (!item || !flow) return null;
  const tasks = tasksOf(item.itemId);
  const values = itemData(item);
  const n = now();
  const open = item.status === "Open";
  const sla = slaState(flow, item, tasks, n);
  const absences = data?.absences ?? [];
  const pendingReq = (taskId: string) => (data?.requests ?? []).find((r) => r.taskId === taskId && r.status === "Pending");

  async function run(label: string, action: string, payload: Record<string, unknown>) {
    setBusy(label);
    const r = await call(action, payload);
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success(label);
    return r.ok;
  }
  async function send() {
    if (!comment.trim()) return;
    if (await run("Comment added", "addComment", { itemId, text: comment })) setComment("");
  }

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="pr-8">{item.title}</SheetTitle>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Pill tone={item.status === "Completed" ? "green" : item.status === "Cancelled" ? "red" : "amber"}>{itemStatusLabel(flow, item)}</Pill>
              <PriorityPill priority={item.priority} />
              <span>{flow.name}</span><span>· {item.itemId}</span>
              {item.postponeCount > 0 && <Pill tone="violet">Postponed {item.postponeCount}×</Pill>}
              {sla && <Pill tone={sla.breached ? "red" : sla.daysLeft <= 1 ? "amber" : "gray"}>{sla.breached ? "SLA breached" : `SLA ${sla.daysLeft <= 0 ? "due today" : `${sla.daysLeft}d left`}`}</Pill>}
              <TagChips tags={item.tags} />
            </div>
          </SheetHeader>

          <div className="grid gap-4 px-4 pb-6">
            <div className="flex flex-wrap gap-2">
              {item.status !== "Cancelled" && <Button size="sm" variant="outline" onClick={() => setEdit(true)}><PencilIcon /> Edit</Button>}
              {open && flow.anchorField && <Button size="sm" variant="outline" onClick={() => setPostpone(true)}><ClockIcon /> Postpone</Button>}
              {canDelete && item.status !== "Cancelled" && <Button size="sm" variant="ghost" className="text-red-700" disabled={busy !== ""} onClick={() => { const reason = window.prompt("Why is this entry being cancelled?"); if (reason) run("Entry cancelled", "cancelEntry", { itemId, reason }); }}>Cancel entry</Button>}
              {canDelete && item.status === "Cancelled" && <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => run("Entry restored", "cancelEntry", { itemId, cancel: false })}>Restore</Button>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border p-3 text-sm">
              {flow.fields.map((f) => (
                <div key={f.key} className={["text", "textarea", "url"].includes(f.type) && String(values[f.key] ?? "").length > 28 ? "col-span-2" : ""}>
                  <dt className="text-xs text-muted-foreground">{f.label}{f.key === flow.anchorField ? " ★" : ""}</dt>
                  <dd className="font-medium">{f.type === "datetime" || f.type === "date" ? fmtDT(String(values[f.key] ?? ""), true) : <FieldValue field={f} value={values[f.key]} />}</dd>
                </div>
              ))}
              {item.postponeCount > 0 && (
                <div className="col-span-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-900">Originally {fmtDT(item.originalAnchor, true)} → now {fmtDT(item.anchorDate, true)}. Reason: {item.postponeReason || "—"}</div>
              )}
            </dl>

            <Tabs defaultValue="steps">
              <TabsList><TabsTrigger value="steps">Steps</TabsTrigger><TabsTrigger value="comments">Comments{detail?.comments.length ? ` (${detail.comments.length})` : ""}</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>

              <TabsContent value="steps" className="pt-3">
                <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {tasks.map((t, i) => {
                    const step = flow.steps.find((s) => s.stepId === t.stepId);
                    const st = taskState(t, n);
                    const eff = effectiveAssignee(t, absences, today);
                    const canAct = t.status === "Pending" && open && allow("fms", "edit") && (t.assigneeId === meId || eff.userId === meId || inReach(t.assigneeId, "fms"));
                    const prev = [...tasks.slice(0, i)].reverse().find((x) => x.status !== "Skipped");
                    const blocked = !!step?.sequential && !!prev && prev.status !== "Done";
                    const late = delayMinutes(t, n);
                    const away = t.status === "Pending" && absentOn(absences, t.assigneeId, today);
                    const req = pendingReq(t.taskId);
                    const sd = taskData(t);
                    if (t.status === "Skipped") {
                      return <li key={t.taskId} className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground"><span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[11px]">{i + 1}</span>{step?.name} — <i>not applicable for this entry</i></li>;
                    }
                    return (
                      <li key={t.taskId} className={cn("rounded-xl border p-3", st === "overdue" && "border-red-200 bg-red-50/40", st === "done" && "bg-muted/30")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-medium"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px]">{i + 1}</span>{step?.name ?? t.stepId}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {userName(t.status === "Done" ? t.doneBy || t.assigneeId : eff.userId)}
                              {eff.covering && <Pill tone="violet" className="ml-1">covering for {userName(t.assigneeId)}</Pill>}
                              {away && !eff.covering && <Pill tone="amber" className="ml-1">away</Pill>}
                              {step?.how ? ` · ${step.how}` : ""}
                            </div>
                          </div>
                          <Pill tone={stateTone(st)}>{st === "done" ? (late ? `Done · late ${fmtDuration(late)}` : "Done on time") : st === "overdue" ? `Late ${fmtDuration(late)}` : st === "today" ? "Due today" : st === "upcoming" ? "Upcoming" : "No time yet"}</Pill>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs">
                          <div><span className="text-muted-foreground">Planned </span>{t.planned ? fmtDT(t.planned) : "—"}</div>
                          <div><span className="text-muted-foreground">Actual </span>{t.actual ? fmtDT(t.actual) : "—"}</div>
                        </div>
                        {t.extCount > 0 && <div className="mt-1 text-xs text-violet-800">Extended {t.extCount}× (first planned {fmtDT(t.origPlanned)})</div>}
                        {req && <div className="mt-1 flex items-center gap-1 text-xs text-amber-800"><HourglassIcon className="size-3.5" /> More time requested until {fmtDT(req.newPlanned)} — waiting for approval</div>}
                        {t.remarks && <div className="mt-1 text-xs text-muted-foreground">“{t.remarks}”</div>}
                        {Object.keys(sd).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {(step?.completionFields ?? []).filter((f) => sd[f.key] !== undefined && sd[f.key] !== "").map((f) => <span key={f.key} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]"><span className="text-muted-foreground">{f.label}: </span>{String(sd[f.key])}</span>)}
                          </div>
                        )}
                        {(canAct || (canUndo && t.status === "Done" && inReach(t.assigneeId, "fms"))) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {canAct && !blocked && <Button size="sm" className="h-8" onClick={() => setDone(t)}><CheckIcon /> Mark done</Button>}
                            {canAct && blocked && <span className="flex items-center gap-1 text-xs text-muted-foreground"><LockIcon className="size-3.5" /> Waiting for the previous step</span>}
                            {canAct && t.planned && !req && <Button size="sm" variant="outline" className="h-8" onClick={() => setExtend(t)}><HourglassIcon /> More time</Button>}
                            {canAct && <Button size="sm" variant="outline" className="h-8" onClick={() => setReassign(t)}><UserRoundCogIcon /> Reassign</Button>}
                            {canUndo && t.status === "Done" && <Button size="sm" variant="ghost" className="h-8" disabled={busy !== ""} onClick={() => run("Step reopened", "reopenTask", { taskId: t.taskId })}>Undo</Button>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </TabsContent>

              <TabsContent value="comments" className="grid gap-3 pt-3">
                {!detail && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading…</div>}
                {detail?.comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet. Use this to leave notes for the next person.</div>}
                {detail?.comments.map((c) => (
                  <div key={c.commentId} className="rounded-xl border p-2.5 text-sm">
                    <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="font-medium text-foreground">{userName(c.userId)}</span><span className="flex items-center gap-2">{fmtDT(c.createdAt.slice(0, 16))}{(canManage || c.userId === meId) && <button aria-label="Delete comment" className="hover:text-red-700" onClick={() => run("Comment deleted", "deleteComment", { commentId: c.commentId }).then(() => call<Detail>("getItemDetail", { itemId }).then((r) => r.ok && setDetail(r.data!)))}><Trash2Icon className="size-3.5" /></button>}</span></div>
                    <div className="mt-1 whitespace-pre-wrap">{c.text}</div>
                  </div>
                ))}
                <div className="flex items-end gap-2">
                  <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" className="flex-1" />
                  <Button size="icon-lg" aria-label="Send comment" disabled={!comment.trim() || busy !== ""} onClick={send}><SendIcon /></Button>
                </div>
              </TabsContent>

              <TabsContent value="activity" className="pt-3">
                {!detail && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading…</div>}
                <ul className="grid gap-1.5 text-xs">
                  {detail?.trail.map((a, i) => (
                    <li key={i} className="rounded-lg border px-2.5 py-1.5">
                      <div className="flex justify-between gap-2"><span className="font-medium">{a.action}</span><span className="text-muted-foreground">{fmtDT(a.timestamp.slice(0, 16))}</span></div>
                      <div className="text-muted-foreground">{userName(a.user)}{a.newValue ? ` · ${a.newValue.slice(0, 120)}` : ""}</div>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
      {done && <DoneDialog task={done} step={flow.steps.find((s) => s.stepId === done.stepId)} itemTitle={item.title} onClose={() => setDone(null)} />}
      {reassign && <ReassignDialog task={reassign} onClose={() => setReassign(null)} />}
      {extend && <ExtensionDialog task={extend} step={flow.steps.find((s) => s.stepId === extend.stepId)} itemTitle={item.title} onClose={() => setExtend(null)} />}
      {postpone && <PostponeDialog item={item} flow={flow} onClose={() => setPostpone(false)} />}
      {edit && <EntryForm flow={flow} item={item} onClose={() => setEdit(false)} />}
    </>
  );
}
