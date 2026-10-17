"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CalendarCheck2Icon, CheckIcon, ClipboardCheckIcon, ExternalLinkIcon, InboxIcon, ListChecksIcon, TimerIcon, UsersIcon, WorkflowIcon, XIcon, ZapIcon, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, Pill, Section } from "@/components/common";
import { DoneDialog, EntryPanel, stateTone } from "@/components/flow/entry-panel";
import { PunchCard } from "@/components/attendance/punch-card";
import { AnnouncementBar } from "@/components/announcements";
import { useAttendance } from "@/components/attendance/use-attendance";
import { checklistOwner } from "@/lib/checklist-shared";
import { delayMinutes, effectiveAssignee, parseFlow, taskState } from "@/lib/flow";
import type { FlowItem, FlowTask } from "@/lib/flow-types";
import { fmtDate, fmtDT, fmtDuration } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Work { t: FlowTask; item: FlowItem; who: string; covering: boolean }

/** My work: what needs me today, one tap from the list behind each number. Only modules the person has are shown — a module they do not have is not "0", it does not exist. */
export default function HomePage() {
  const { data, flows, meId, isSuper, has, allow, inReach, userName, now, today, call } = useFlows();
  const [done, setDone] = useState<Work | null>(null);
  const [panel, setPanel] = useState("");
  const [busy, setBusy] = useState("");
  const n = now();
  const att = useAttendance();
  const me = data?.me;
  const fms = has("fms") && (isSuper || flows.length > 0), checklist = has("checklist"), attendance = has("attendance"), quickAccess = has("quick_access");

  const model = useMemo(() => {
    const items = new Map((data?.items ?? []).map((i) => [i.itemId, i]));
    const absences = data?.absences ?? [];
    const open: Work[] = [];
    if (fms) for (const t of data?.tasks ?? []) {
      const item = items.get(t.itemId);
      if (!item || item.status !== "Open" || t.status !== "Pending") continue;
      const eff = effectiveAssignee(t, absences, today);
      open.push({ t, item, who: eff.userId, covering: eff.covering });
    }
    const mine = open.filter((w) => w.who === meId);
    const team = open.filter((w) => w.who !== meId && inReach(w.who, "fms"));
    const st = (w: Work) => taskState(w.t, n);
    const overdue = mine.filter((w) => st(w) === "overdue");
    const dueToday = mine.filter((w) => st(w) === "today");
    const teamLate = team.filter((w) => st(w) === "overdue");
    const byPlanned = (a: Work, b: Work) => a.t.planned.localeCompare(b.t.planned);
    const attention = [...overdue.sort(byPlanned), ...dueToday.sort(byPlanned)].slice(0, 8);

    // checklist: what is still open up to today for me, and what I ticked today
    const clTasks = new Map((data?.checklistTasks ?? []).map((t) => [t.ctId, t]));
    let clDone = 0, clOpen = 0, clOverdue = 0;
    if (checklist) for (const e of data?.checklistLog ?? []) {
      const ct = clTasks.get(e.ctId);
      if (!ct) continue;
      if (e.status === "Done") { if (e.actual.slice(0, 10) === today && (e.doneBy || e.doerId) === meId) clDone++; continue; }
      if (e.status !== "Pending" || e.plannedDate > today) continue;
      if (checklistOwner(e, ct, absences, today).userId !== meId) continue;
      clOpen++; if (e.plannedDate < today) clOverdue++;
    }

    // the team, when the person can see one
    const peopleIn = (data?.users ?? []).filter((u) => u.status === "Active" && u.userId !== meId && inReach(u.userId, "attendance"));
    const here = attendance ? peopleIn.filter((u) => { const d = att.days(u.userId, today, today)[0]; return d.status === "present" || d.status === "half" || d.punches > 0; }).length : 0;
    const notIn = attendance ? peopleIn.filter((u) => { const d = att.days(u.userId, today, today)[0]; return d.status === "pending" && d.punches === 0; }).length : 0;
    const pendingLeave = attendance && allow("attendance", "approve") ? (data?.leaves ?? []).filter((l) => l.status === "Pending" && l.userId !== meId && inReach(l.userId, "attendance")).length : 0;
    const decisions = fms ? (data?.requests ?? []).filter((r) => r.status === "Pending" && r.requestedBy !== meId) : [];

    const load = new Map<string, { open: number; overdue: number; today: number }>();
    for (const w of open) {
      const l = load.get(w.who) ?? load.set(w.who, { open: 0, overdue: 0, today: 0 }).get(w.who)!;
      l.open++;
      const s = st(w);
      if (s === "overdue") l.overdue++; else if (s === "today") l.today++;
    }
    const workload = (data?.users ?? []).filter((u) => u.status === "Active" && u.userId !== meId && inReach(u.userId, "fms") && load.has(u.userId)).map((u) => ({ u, l: load.get(u.userId)! })).sort((a, b) => b.l.overdue - a.l.overdue || b.l.open - a.l.open).slice(0, 8);
    return { mine, overdue, dueToday, attention, teamLate, clDone, clOpen, clOverdue, peopleIn: peopleIn.length, here, notIn, pendingLeave, decisions, workload };
  }, [data, fms, checklist, attendance, today, n, meId, inReach, allow, att]);

  const flowOf = (id: string) => flows.find((f) => f.flowId === id) ?? parseFlow(data!.flows.find((f) => f.flowId === id)!);
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    const r = await call("decideRequest", { requestId: id, approve, note: "" });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success(approve ? "Approved — planned time moved" : "Rejected");
  }

  const hour = Number(n.slice(11, 13));
  const hello = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}${me ? `, ${me.name.split(" ")[0]}` : ""}`;
  const todo = model.overdue.length + model.dueToday.length + model.clOpen;
  const links = [...(data?.quickLinks ?? [])].filter((l) => l.favorite === "Y" || !l.ownerId).slice(0, 8);
  const decisions = model.decisions.filter((r) => isSuper || data?.users.find((u) => u.userId === r.requestedBy)?.managerId === meId || (allow("fms", "approve") && inReach(r.requestedBy, "fms")));

  return (
    <>
      <PageHeader
        title={hello}
        subtitle={`${fmtDate(today, true)} · ${todo === 0 ? "You are all caught up." : `${todo} thing${todo === 1 ? "" : "s"} need${todo === 1 ? "s" : ""} you today.`}`}
        actions={<>{isSuper && <Link href="/flows/admin" className={cn(buttonVariants({ variant: "outline" }), "h-9")}>Control center</Link>}</>}
      />

      <AnnouncementBar />

      {attendance && <div className="mb-4"><PunchCard compact /></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {fms && <Card icon={ListChecksIcon} label="FMS tasks" value={model.mine.length} sub="waiting for me" href="/flows/tasks?quick=mine" />}
        {fms && <Card icon={TimerIcon} label="Due today" value={model.dueToday.length} tone={model.dueToday.length ? "warn" : undefined} sub="steps" href="/flows/tasks?quick=today" />}
        {fms && <Card icon={WorkflowIcon} label="Overdue" value={model.overdue.length} tone={model.overdue.length ? "bad" : "good"} sub={model.teamLate.length ? `+ ${model.teamLate.length} in my team` : "steps"} href="/flows/tasks?quick=overdue" />}
        {checklist && <Card icon={ClipboardCheckIcon} label="Checklist pending" value={model.clOpen} tone={model.clOverdue ? "bad" : model.clOpen ? "warn" : "good"} sub={model.clDone ? `${model.clDone} ticked today` : model.clOverdue ? `${model.clOverdue} overdue` : "for today"} href="/flows/checklist?quick=mine" />}
        {attendance && model.peopleIn > 0 && <Card icon={UsersIcon} label="Team in today" value={`${model.here}/${model.peopleIn}`} tone={model.notIn ? "warn" : "good"} sub={model.notIn ? `${model.notIn} not in yet` : "everyone is in"} href="/flows/attendance?tab=today" />}
        {attendance && model.pendingLeave > 0 && <Card icon={CalendarCheck2Icon} label="Leave to decide" value={model.pendingLeave} tone="warn" sub="requests" href="/flows/attendance?tab=leave" />}
        {fms && decisions.length > 0 && <Card icon={InboxIcon} label="Decisions waiting" value={decisions.length} tone="warn" sub="more-time requests" href="/flows/approvals" />}
      </div>

      {quickAccess && links.length > 0 && (
        <Section title="Quick access" hint="One click opens it in a new tab" className="mb-5" actions={<Link href="/flows/quick" className="text-xs font-medium text-primary hover:underline">All shortcuts</Link>}>
          <div className="flex flex-wrap gap-2">{links.map((l) => <a key={l.linkId} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-sm font-medium shadow-[0_1px_1px_rgba(26,31,54,0.05)] hover:bg-[#f6f9fc]"><ZapIcon className="size-3.5 text-primary" />{l.title}<ExternalLinkIcon className="size-3 text-muted-foreground" /></a>)}</div>
        </Section>
      )}

      {fms && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Do these first" hint="Most overdue first, then due today. Mark done right here." className="xl:col-span-2" actions={<Link href="/flows/tasks?quick=mine" className="text-xs font-medium text-primary hover:underline">All my tasks</Link>}>
            {model.attention.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing is late and nothing is due today. 🎉</p>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                {model.attention.map((w) => {
                  const flow = flowOf(w.t.flowId);
                  const step = flow.steps.find((s) => s.stepId === w.t.stepId);
                  const st = taskState(w.t, n);
                  const late = delayMinutes(w.t, n);
                  return (
                    <div key={w.t.taskId} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
                      <button className="min-w-0 flex-1 text-left" onClick={() => setPanel(w.item.itemId)}>
                        <div className="truncate text-sm font-medium">{step?.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{w.item.title} · {flow.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <Pill tone={stateTone(st)}>{st === "overdue" ? `Late ${fmtDuration(late)}` : "Due today"}</Pill>
                          <span className="text-muted-foreground">{fmtDT(w.t.planned)}</span>
                          {w.covering && <span className="text-muted-foreground">· covering</span>}
                        </div>
                      </button>
                      {allow("fms", "edit") && <Button size="sm" className="h-9 shrink-0" onClick={() => setDone(w)}><CheckIcon /> Done</Button>}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <div className="grid content-start gap-4">
            {decisions.length > 0 && (
              <Section title="Decisions" hint="People asking for more time" actions={<Link href="/flows/approvals" className="text-xs font-medium text-primary hover:underline">Open</Link>}>
                <div className="grid gap-1.5">
                  {decisions.slice(0, 4).map((r) => {
                    const item = data?.items.find((i) => i.itemId === r.itemId);
                    const task = data?.tasks.find((t) => t.taskId === r.taskId);
                    const step = task ? flowOf(task.flowId).steps.find((s) => s.stepId === task.stepId) : undefined;
                    return (
                      <div key={r.requestId} className="rounded-lg border p-2.5 text-sm">
                        <div className="truncate font-medium">{step?.name ?? "Step"} <span className="font-normal text-muted-foreground">· {item?.title}</span></div>
                        <div className="text-xs text-muted-foreground">{userName(r.requestedBy)} wants {fmtDT(r.newPlanned)}{r.reason ? ` — “${r.reason}”` : ""}</div>
                        <div className="mt-1.5 flex gap-1.5">
                          <Button size="sm" className="h-8" disabled={busy === r.requestId} onClick={() => decide(r.requestId, true)}><CheckIcon /> Approve</Button>
                          <Button size="sm" variant="outline" className="h-8 text-red-700" disabled={busy === r.requestId} onClick={() => decide(r.requestId, false)}><XIcon /> Reject</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
            {model.workload.length > 0 && (
              <Section title="My team's work" hint="Open steps right now" actions={<Link href="/flows/tasks?quick=all" className="text-xs font-medium text-primary hover:underline">Everyone&apos;s tasks</Link>}>
                <ul className="grid gap-1.5 text-sm">
                  {model.workload.map(({ u, l }) => (
                    <li key={u.userId} className="flex items-center justify-between gap-2"><span className="truncate font-medium">{u.name}</span><span className="flex shrink-0 gap-1.5 text-xs tabular-nums"><span className="text-muted-foreground">{l.open} open</span>{l.overdue > 0 && <Pill tone="red">{l.overdue} late</Pill>}{l.today > 0 && <Pill tone="amber">{l.today} today</Pill>}</span></li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      )}


      {!fms && !checklist && !attendance && !quickAccess && (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Nothing has been given to you yet. Ask the Super Admin which modules you should have.</p>
      )}

      {done && <DoneDialog task={done.t} step={flowOf(done.t.flowId).steps.find((s) => s.stepId === done.t.stepId)} itemTitle={done.item.title} onClose={() => setDone(null)} />}
      {panel && <EntryPanel itemId={panel} onClose={() => setPanel("")} />}
    </>
  );
}

/** A number you can tap: it opens the list behind it, already filtered. */
function Card({ icon: Icon, label, value, sub, tone, href }: { icon: LucideIcon; label: string; value: ReactNode; sub?: string; tone?: "good" | "warn" | "bad"; href: string }) {
  return (
    <Link href={href} className="group rounded-lg border bg-card p-4 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)] transition-shadow hover:shadow-[0_2px_8px_rgba(60,66,87,0.14)]">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground"><span>{label}</span><Icon className="size-4 text-[#8792a2] group-hover:text-primary" /></div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", tone === "good" && "text-[#0e6245]", tone === "warn" && "text-[#983705]", tone === "bad" && "text-[#a41c4e]")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Link>
  );
}
