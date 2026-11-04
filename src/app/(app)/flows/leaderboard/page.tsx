"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CrownIcon, MedalIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorBox, PageHeader, Progress, Spinner } from "@/components/common";
import { addMonths, fmtMonth } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Row {
  userId: string; name: string; department: string; days: number; onTime: number; late: number; arrivalPct: number | null; absent: number; hours: number;
  fmsDue: number; fmsDone: number; fmsOnTime: number; clDue: number; clDone: number; clOnTime: number; workPct: number | null; doneAll: number; dueAll: number; donePct: number | null;
  attRank: number | null; taskRank: number | null;
}
interface Board { month: string; from: string; to: string; board: Row[] }
type Which = "att" | "task";
const MEDAL = ["text-amber-500", "text-slate-400", "text-orange-600"];

/** One ranking. Attendance = how often you arrived on time. Tasks = how much of your work was finished by its planned time. Only totals are shown — no punch times, no task titles. */
function BoardView({ which, rows, meId, upTo }: { which: Which; rows: Row[]; meId: string; upTo: string }) {
  const rankOf = (r: Row) => (which === "att" ? r.attRank : r.taskRank);
  const valueOf = (r: Row) => (which === "att" ? r.arrivalPct : r.workPct);
  const ranked = rows.filter((r) => rankOf(r) !== null).sort((a, b) => (rankOf(a)! - rankOf(b)!) || a.name.localeCompare(b.name));
  const unranked = rows.filter((r) => rankOf(r) === null);
  const me = rows.find((r) => r.userId === meId);
  const top = ranked.filter((r) => rankOf(r)! <= 3).slice(0, 3);
  if (!ranked.length) return <EmptyState title="Nothing to rank yet" hint={which === "att" ? "The attendance ranking starts once people have checked in this month." : "The task ranking starts once tasks have come due this month."} />;
  return (
    <>
      {me && rankOf(me) !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-[#efeeff] px-4 py-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">#{rankOf(me)}</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">You are #{rankOf(me)} of {ranked.length}</div>
            <div className="text-xs text-muted-foreground">
              {which === "att" ? `On time ${me.onTime} of ${me.days} days${me.late ? ` · ${me.late} late` : ""}${me.absent ? ` · ${me.absent} absent` : ""}` : `${me.doneAll} of ${me.dueAll} tasks done · ${valueOf(me)}% finished on time`}
            </div>
          </div>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {top.map((r) => (
          <div key={r.userId} className={cn("relative rounded-xl border bg-card p-4 text-center shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]", r.userId === meId && "ring-2 ring-primary")}>
            <div className={cn("absolute right-3 top-3", MEDAL[Math.min((rankOf(r) ?? 3) - 1, 2)])}>{rankOf(r) === 1 ? <CrownIcon className="size-5" /> : <MedalIcon className="size-5" />}</div>
            <div className="mx-auto mb-2 w-fit"><Avatar userId={r.userId} size={52} /></div>
            <div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.department || " "}</div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{valueOf(r)}%</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">#{rankOf(r)} · {which === "att" ? "on time" : "tasks on time"}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
            {which === "att" ? (
              <tr><th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Person</th><th className="px-3 py-2.5">Days on time</th><th className="px-3 py-2.5">Late</th><th className="px-3 py-2.5">Absent</th><th className="px-3 py-2.5">Hours worked</th><th className="px-3 py-2.5 text-right">On time %</th></tr>
            ) : (
              <tr><th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Person</th><th className="px-3 py-2.5">FMS steps</th><th className="px-3 py-2.5">Checklist</th><th className="px-3 py-2.5">Tasks done</th><th className="px-3 py-2.5">Done on time</th><th className="px-3 py-2.5 text-right">On time %</th></tr>
            )}
          </thead>
          <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t">
            {ranked.map((r) => (
              <tr key={r.userId} className={cn(r.userId === meId && "bg-[#faf9ff]")}>
                <td className="w-10 font-semibold tabular-nums">{rankOf(r)}</td>
                <td><div className="flex items-center gap-2"><Avatar userId={r.userId} size={28} /><div><div className="font-medium">{r.name}{r.userId === meId && <span className="ml-1.5 text-xs text-primary">you</span>}</div><div className="text-[11px] text-muted-foreground">{r.department}</div></div></div></td>
                {which === "att" ? (
                  <>
                    <td className="min-w-36"><div className="text-xs tabular-nums">{r.onTime}/{r.days} days</div><Progress value={r.arrivalPct} /></td>
                    <td className="text-xs tabular-nums">{r.late || <span className="text-muted-foreground">0</span>}</td>
                    <td className="text-xs tabular-nums">{r.absent ? <span className="font-medium text-[#a41c4e]">{r.absent}</span> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="text-xs tabular-nums">{r.hours ? `${r.hours} h` : "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="text-xs tabular-nums">{r.fmsDue ? `${r.fmsDone}/${r.fmsDue} done` : <span className="text-muted-foreground">none due</span>}</td>
                    <td className="text-xs tabular-nums">{r.clDue ? `${r.clDone}/${r.clDue} done` : <span className="text-muted-foreground">none due</span>}</td>
                    <td className="text-xs tabular-nums">{r.doneAll}/{r.dueAll}{r.donePct !== null ? ` · ${r.donePct}%` : ""}</td>
                    <td className="min-w-36"><div className="text-xs tabular-nums">{r.fmsOnTime + r.clOnTime} of {r.dueAll}</div><Progress value={r.workPct} /></td>
                  </>
                )}
                <td className="text-right text-base font-bold tabular-nums">{valueOf(r)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unranked.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Not ranked yet ({which === "att" ? "no days to count" : "no tasks due"} this month): {unranked.map((r) => r.name).join(", ")}.</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        {which === "att" ? "On time % = days you arrived on time ÷ days that counted (present, half day or absent). Leave, weekly off and holidays do not count against anyone." : "On time % = tasks (FMS steps and checklist) finished by their planned time ÷ tasks that were due. Work not yet due does not count."} Up to {upTo}.
      </p>
    </>
  );
}

export default function LeaderboardPage() {
  const { call, today, meId } = useFlows();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tab, setTab] = useState<Which>("att");
  const [res, setRes] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRes(null);
    const r = await call<Board>("getLeaderboard", { month });
    if (r.ok) { setRes(r.data!); setError(""); } else setError(r.error || "Could not load the leaderboard");
  }, [call, month]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Two rankings for the month: who comes on time, and who finishes their tasks on time." actions={
        <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeftIcon /></Button>
          <span className="min-w-28 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <Button size="icon-sm" variant="ghost" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRightIcon /></Button>
        </div>
      } />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Which)} className="mb-3">
        <TabsList><TabsTrigger value="att">Attendance</TabsTrigger><TabsTrigger value="task">Tasks</TabsTrigger></TabsList>
      </Tabs>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!res && !error && <p className="py-8 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Working it out…</p>}
      {res && <BoardView which={tab} rows={res.board} meId={meId} upTo={res.to} />}
    </>
  );
}
