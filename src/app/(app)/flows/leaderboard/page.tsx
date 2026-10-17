"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CrownIcon, MedalIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBox, PageHeader, Progress, Spinner } from "@/components/common";
import { addMonths, fmtMonth } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Row {
  userId: string; name: string; department: string; rank: number | null; days: number; onTime: number; late: number; arrivalPct: number | null;
  fmsDue: number; fmsDone: number; fmsOnTime: number; clDue: number; clDone: number; clOnTime: number; workPct: number | null; score: number | null;
}
interface Board { month: string; from: string; to: string; board: Row[]; rule: string }
const MEDAL = ["text-amber-500", "text-slate-400", "text-orange-600"];

/** This month's ranking: who arrived on time and who finished their work. Only totals are shown — no punch times, no task titles. */
export default function LeaderboardPage() {
  const { call, today, meId } = useFlows();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [res, setRes] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRes(null);
    const r = await call<Board>("getLeaderboard", { month });
    if (r.ok) { setRes(r.data!); setError(""); } else setError(r.error || "Could not load the leaderboard");
  }, [call, month]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const ranked = res?.board.filter((r) => r.rank !== null) ?? [];
  const unranked = res?.board.filter((r) => r.rank === null) ?? [];
  const me = res?.board.find((r) => r.userId === meId);
  const top = ranked.filter((r) => (r.rank ?? 9) <= 3);

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Who came on time and finished their work this month — FMS steps and checklist together." actions={
        <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeftIcon /></Button>
          <span className="min-w-28 text-center text-sm font-semibold">{fmtMonth(month)}</span>
          <Button size="icon-sm" variant="ghost" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRightIcon /></Button>
        </div>
      } />
      {error && <ErrorBox message={error} onRetry={load} />}
      {!res && !error && <p className="py-8 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Working it out…</p>}
      {res && !ranked.length && <EmptyState title="Nothing to rank yet" hint="The ranking starts once people have checked in or finished tasks this month." />}
      {res && ranked.length > 0 && (
        <>
          {me && me.rank !== null && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-[#efeeff] px-4 py-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">#{me.rank}</span>
              <div className="min-w-0 flex-1"><div className="font-semibold">You are #{me.rank} of {ranked.length}</div><div className="text-xs text-muted-foreground">Score {me.score} · on time {me.onTime} of {me.days} days · {me.fmsDone + me.clDone} of {me.fmsDue + me.clDue} tasks done</div></div>
            </div>
          )}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {top.slice(0, 3).map((r) => (
              <div key={r.userId} className={cn("relative rounded-xl border bg-card p-4 text-center shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]", r.userId === meId && "ring-2 ring-primary")}>
                <div className={cn("absolute right-3 top-3", MEDAL[Math.min((r.rank ?? 3) - 1, 2)])}>{r.rank === 1 ? <CrownIcon className="size-5" /> : <MedalIcon className="size-5" />}</div>
                <div className="mx-auto mb-2 w-fit"><Avatar userId={r.userId} size={52} /></div>
                <div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.department || " "}</div>
                <div className="mt-2 text-3xl font-bold tabular-nums">{r.score}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">#{r.rank} · score</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground"><tr>
                <th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Person</th><th className="px-3 py-2.5">On time</th><th className="px-3 py-2.5">FMS steps</th><th className="px-3 py-2.5">Checklist</th><th className="px-3 py-2.5">Work on time</th><th className="px-3 py-2.5 text-right">Score</th>
              </tr></thead>
              <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t">
                {ranked.map((r) => (
                  <tr key={r.userId} className={cn(r.userId === meId && "bg-[#faf9ff]")}>
                    <td className="w-10 font-semibold tabular-nums">{r.rank}</td>
                    <td><div className="flex items-center gap-2"><Avatar userId={r.userId} size={28} /><div><div className="font-medium">{r.name}{r.userId === meId && <span className="ml-1.5 text-xs text-primary">you</span>}</div><div className="text-[11px] text-muted-foreground">{r.department}</div></div></div></td>
                    <td className="min-w-32"><div className="text-xs tabular-nums">{r.onTime}/{r.days} days{r.late ? ` · ${r.late} late` : ""}</div><Progress value={r.arrivalPct} /></td>
                    <td className="text-xs tabular-nums">{r.fmsDue ? `${r.fmsDone}/${r.fmsDue} done` : <span className="text-muted-foreground">none due</span>}</td>
                    <td className="text-xs tabular-nums">{r.clDue ? `${r.clDone}/${r.clDue} done` : <span className="text-muted-foreground">none due</span>}</td>
                    <td className="min-w-32"><div className="text-xs tabular-nums">{r.workPct === null ? "—" : `${r.workPct}%`}</div><Progress value={r.workPct} /></td>
                    <td className="text-right text-base font-bold tabular-nums">{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unranked.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Not ranked yet (nothing to measure this month): {unranked.map((r) => r.name).join(", ")}.</p>}
          <p className="mt-3 text-xs text-muted-foreground">{res.rule} Days of leave, weekly off and holidays do not count against anyone. Up to {res.to}.</p>
        </>
      )}
    </>
  );
}
