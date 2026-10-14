"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { DataTable, EmptyState, Hint, PageHeader, Pill, Section, StatCard } from "@/components/common";
import { buildUnits, scoreTone, teamWeek, weekCard, weekEndOf, weekStartOf, type ScoreRow } from "@/lib/scorecard";
import { addDays, fmtDate } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/filters";
import { useFlows } from "@/lib/flow-store";
import { pct1 } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_TEXT = { green: "text-emerald-700", amber: "text-amber-700", red: "text-red-700" } as const;
const TONE_PILL = { green: "green", amber: "amber", red: "red" } as const;

export default function ScorecardPage() {
  const { data, flows, meId, today, userName, peopleFor, inReach, allow, call } = useFlows();
  const people = peopleFor("scorecard");
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [person, setPerson] = useState("");
  const bench = Number(data?.settings?.SCORE_BENCHMARK ?? 10) || 10;
  const multi = people.length > 1;
  const who = multi ? person : meId; // nobody sees people outside their department / reporting line
  const thisWeek = weekStartOf(today);

  const units = useMemo(() => buildUnits({ flows, items: data?.items ?? [], tasks: data?.tasks ?? [], checklistTasks: data?.checklistTasks ?? [], checklistLog: data?.checklistLog ?? [] }), [flows, data]);
  const team = useMemo(() => teamWeek(units, weekStart, today).filter((t) => inReach(t.person, "scorecard")), [units, weekStart, today, inReach]);
  const card = useMemo(() => (who ? weekCard(units, who, weekStart, today) : null), [units, who, weekStart, today]);

  async function exportCsv() {
    const head = ["Person", "System", "Planned", "Due", "Done", "Done on time", "% work not done", "% work not done on time", "Last week % not on time", "Next week planned"];
    const lines: (string | number)[][] = [];
    const sources = who && card ? [card] : team.map((t) => weekCard(units, t.person, weekStart, today));
    for (const c of sources) for (const r of [...c.rows, c.total]) lines.push([userName(c.person), r.system, r.planned, r.due, r.done, r.doneOnTime, r.notDonePct, r.notOnTimePct, r.lastNotOnTimePct ?? "", r.nextPlanned]);
    downloadCsv(`scorecard-${weekStart}.csv`, toCsv(head, lines));
    await call("logExport", { module: "scorecard", rows: lines.length, what: "Scorecard" });
  }

  const teamDue = team.reduce((a, t) => a + t.total.due, 0);
  const teamNotOnTime = team.reduce((a, t) => a + t.total.notOnTime, 0);
  const teamNotDone = team.reduce((a, t) => a + t.total.notDone, 0);

  return (
    <>
      <PageHeader
        help={{ id: "scorecard", title: "How to read this", text: "For each person and week: how much of the planned work is not done, and how much was not done on time. Lower is better. Green means within the target, amber is up to double, red is worse. Use the arrows to see other weeks." }}
        title="Scorecard"
        subtitle="Per person, per week: what was planned, what is done, and what was done on time — checklists and every FMS step together."
        actions={allow("scorecard", "export") && <Button variant="outline" onClick={exportCsv}><DownloadIcon /> Export CSV</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border bg-card">
          <Button size="icon-sm" variant="ghost" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeftIcon /></Button>
          <span className="px-2 text-sm font-medium tabular-nums">{fmtDate(weekStart)} – {fmtDate(weekEndOf(weekStart), true)}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} disabled={weekStart >= thisWeek}><ChevronRightIcon /></Button>
        </div>
        {weekStart !== thisWeek && <Button size="sm" variant="ghost" onClick={() => setWeekStart(thisWeek)}>This week</Button>}
        {multi && (
          <NativeSelect className="w-48" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">Whole team ({people.length})</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}
          </NativeSelect>
        )}
        <span className="text-xs text-muted-foreground">Green = {bench}% or less not done / not on time</span>
      </div>

      {!who && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatCard label="Work due so far" value={teamDue} sub={`${team.length} people`} />
            <StatCard label={<>Not done <Hint>Work that was due by now and is still not finished.</Hint></>} value={teamNotDone} tone={teamDue && (teamNotDone / teamDue) * 100 > bench ? "bad" : "good"} sub={teamDue ? pct1((teamNotDone / teamDue) * 100) : undefined} />
            <StatCard label={<>Not done on time <Hint>Work that is still open or was finished after its planned time.</Hint></>} value={teamNotOnTime} tone={teamDue ? scoreTone((teamNotOnTime / teamDue) * 100, bench) === "green" ? "good" : "bad" : undefined} sub={teamDue ? pct1((teamNotOnTime / teamDue) * 100) : undefined} />
            <StatCard label="Team score" value={teamDue ? `${Math.round(100 - (teamNotOnTime / teamDue) * 100)}` : "—"} sub="100 − % not done on time" />
          </div>
          {team.length === 0 ? <EmptyState title="Nothing was planned this week" hint="Add checklist tasks or entries to an FMS." /> : (
            <DataTable head={["Person", "Due", "Done", "On time", "% not done", "% not on time", "Score", "Last 6 weeks (% not on time)", ""]}>
              {team.map((t) => {
                const tone = scoreTone(t.total.notOnTimePct, bench);
                return (
                  <tr key={t.person}>
                    <td className="font-medium">{userName(t.person)}</td><td className="tabular-nums">{t.total.due}</td><td className="tabular-nums">{t.total.done}</td><td className="tabular-nums">{t.total.doneOnTime}</td>
                    <td className={cn("tabular-nums", TONE_TEXT[scoreTone(t.total.notDonePct, bench)])}>{t.total.due ? pct1(t.total.notDonePct) : "—"}</td>
                    <td className={cn("tabular-nums", TONE_TEXT[tone])}>{t.total.due ? pct1(t.total.notOnTimePct) : "—"}</td>
                    <td>{t.score === null ? "—" : <Pill tone={TONE_PILL[tone]}>{Math.round(t.score)}</Pill>}</td>
                    <td><Trend values={t.trend} bench={bench} /></td>
                    <td className="text-right"><button className="text-xs text-primary underline" onClick={() => setPerson(t.person)}>Details</button></td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </>
      )}

      {who && card && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatCard label={`${userName(who)} · score`} value={card.score === null ? "—" : Math.round(card.score)} tone={card.score === null ? undefined : scoreTone(card.total.notOnTimePct, bench) === "green" ? "good" : scoreTone(card.total.notOnTimePct, bench) === "amber" ? "warn" : "bad"} sub="100 − % not done on time" />
            <StatCard label="Due so far" value={card.total.due} sub={card.total.upcoming ? `${card.total.upcoming} more later this week` : undefined} />
            <StatCard label={<>% work not done <Hint>(due − done) ÷ due. Work planned for later in the week is not counted yet.</Hint></>} value={card.total.due ? pct1(card.total.notDonePct) : "—"} tone={card.total.due ? (scoreTone(card.total.notDonePct, bench) === "green" ? "good" : "bad") : undefined} sub={`${card.total.notDone} open`} />
            <StatCard label={<>% not done on time <Hint>(due − finished by the planned time) ÷ due.</Hint></>} value={card.total.due ? pct1(card.total.notOnTimePct) : "—"} tone={card.total.due ? (scoreTone(card.total.notOnTimePct, bench) === "green" ? "good" : "bad") : undefined} sub={`${card.total.notOnTime} late or open`} />
          </div>
          <Section title="By system" hint="Every checklist type and every FMS step you own. “Due” counts work planned up to today; later days of this week show under Upcoming.">
            {card.rows.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nothing planned for {userName(who)} around this week.</p> : (
              <DataTable head={["System", "KPI", "Planned", "Due", "Done", "On time", "% not done", "% not on time", "Last week", "Next week"]}>
                {[...card.rows, card.total].map((r) => <Line key={r.system + r.group} r={r} bench={bench} total={r === card.total} />)}
              </DataTable>
            )}
          </Section>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">How it is counted: <b>% work not done</b> = (due − done) ÷ due. <b>% not done on time</b> = (due − done by the planned date/time) ÷ due. Work done by a buddy or backup counts for the person who did it. Skipped and cancelled work is ignored.</p>
    </>
  );
}

function Line({ r, bench, total }: { r: ScoreRow; bench: number; total: boolean }) {
  const nd = scoreTone(r.notDonePct, bench), no = scoreTone(r.notOnTimePct, bench);
  return (
    <tr className={cn(total && "border-t-2 bg-muted/40 font-semibold")}>
      <td className="max-w-64"><span className="line-clamp-2">{r.system}</span></td>
      <td className="text-xs text-muted-foreground">{total ? "All" : "Work & timing"}</td>
      <td className="tabular-nums">{r.planned}</td><td className="tabular-nums">{r.due}</td><td className="tabular-nums">{r.done}</td><td className="tabular-nums">{r.doneOnTime}</td>
      <td className={cn("tabular-nums", r.due && TONE_TEXT[nd])}>{r.due ? pct1(r.notDonePct) : "—"}</td>
      <td className={cn("tabular-nums", r.due && TONE_TEXT[no])}>{r.due ? pct1(r.notOnTimePct) : "—"}</td>
      <td className="tabular-nums text-muted-foreground">{r.lastNotOnTimePct === null ? "—" : pct1(r.lastNotOnTimePct)}</td>
      <td className="tabular-nums text-muted-foreground">{r.nextPlanned || "—"}</td>
    </tr>
  );
}

function Trend({ values, bench }: { values: (number | null)[]; bench: number }) {
  return (
    <div className="flex h-7 items-end gap-0.5" aria-label="Trend">
      {values.map((v, i) => (
        <div key={i} title={v === null ? "nothing due" : `${v}% not on time`} className={cn("w-2 rounded-sm", v === null ? "bg-muted" : v <= bench ? "bg-emerald-500" : v <= bench * 2 ? "bg-amber-500" : "bg-red-500")} style={{ height: v === null ? 3 : Math.max(3, Math.min(28, 3 + (v / 100) * 25)) }} />
      ))}
    </div>
  );
}
