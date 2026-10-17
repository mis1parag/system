"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, Field, Section, Spinner, StatCard } from "@/components/common";
import { useFlows } from "@/lib/flow-store";
import type { YearBalance } from "@/lib/attendance";

type Balance = YearBalance & { userId: string };
interface Policy { year: string; allot: number; carryMax: number; carryUntil: string }
interface Adjustment { adjId: string; userId: string; year: string; allot: number | null; delta: number; note: string; createdBy: string; createdAt: string }
interface Payload { year: string; years: string[]; policy: Policy[]; adjustments: Adjustment[]; balances: Balance[] }
const d1 = (n: number) => String(Math.round(n * 100) / 100);

/** The leave of one calendar year: entitlement, carried forward, adjustments, used, waiting and what is left — for me, and for the people I look after. */
export function LeaveYearPanel({ year, onYear, refreshKey }: { year: string; onYear: (y: string) => void; refreshKey: string }) {
  const { call, meId, isSuper, allow, userName, peopleFor } = useFlows();
  const configure = isSuper || allow("attendance", "configure");
  const others = peopleFor("attendance").filter((p) => p.userId !== meId);
  const [data, setData] = useState<Payload | null>(null);
  const [team, setTeam] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState(false);
  const [adjust, setAdjust] = useState<string | null>(null);

  const load = useCallback(async () => {
    const mine = await call<Payload>("getLeaveYear", { year });
    if (mine.ok) { setData(mine.data!); setError(""); } else { setError(mine.error || "Could not load your leave balance"); return; }
    if (others.length || configure) { const t = await call<Payload>("getLeaveYear", { year, everyone: true }); if (t.ok) setTeam(t.data!); }
  }, [call, year, configure, others.length]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, refreshKey]);

  const me = data?.balances[0];
  const pol = data?.policy.find((p) => p.year === year);
  const step = (n: number) => onYear(String(Number(year) + n));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => step(-1)} aria-label="Previous year"><ChevronLeftIcon /></Button>
          <span className="min-w-14 text-center text-sm font-semibold tabular-nums" aria-live="polite">{year}</span>
          <Button size="icon-sm" variant="ghost" onClick={() => step(1)} aria-label="Next year"><ChevronRightIcon /></Button>
        </div>
        <span className="text-xs text-muted-foreground">Leave is counted for each calendar year on its own.</span>
        {configure && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setPolicy(true)}><SettingsIcon /> Leave policy</Button>}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!me && !error && <p className="py-3 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Loading…</p>}
      {me && (
        me.source === "none" && !me.adjustment ? (
          <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">No leave allowance has been set for {year} yet. {configure ? "Use “Leave policy” to set it." : "Ask HR or the Super Admin."}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <StatCard dense label="Entitlement" value={d1(me.allot)} sub={me.source === "own" ? "your own" : me.source === "policy" ? "company policy" : "from your profile"} />
            <StatCard dense label="Carried forward" value={d1(me.carried)} sub={me.carryLost ? `${d1(me.carryLost)} expired` : me.carryUntil ? `use by ${me.carryUntil.slice(5)}` : undefined} />
            <StatCard dense label="Adjustments" value={`${me.adjustment > 0 ? "+" : ""}${d1(me.adjustment)}`} />
            <StatCard dense label="Used" value={d1(me.used)} />
            <StatCard dense label="Waiting" value={d1(me.pending)} sub="not approved yet" tone={me.pending ? "warn" : undefined} />
            <StatCard dense label="Remaining" value={d1(me.left)} sub={me.pending ? `${d1(me.available)} if all are approved` : undefined} tone={me.left < 0 ? "bad" : me.left <= 2 ? "warn" : "good"} />
          </div>
        )
      )}
      {pol && <p className="text-xs text-muted-foreground">{year} policy: {pol.allot} days a year{pol.carryMax ? `, up to ${pol.carryMax} may be carried to ${Number(year) + 1}${pol.carryUntil ? ` and used until ${pol.carryUntil}` : ""}` : ", nothing is carried forward"}.</p>}
      {team && team.balances.length > 1 && (
        <Section title={`Leave balances ${year}`} hint="The people you look after.">
          <DataTable head={["Person", "Entitlement", "Carried", "Adjust", "Used", "Waiting", "Remaining", ""]}>
            {team.balances.filter((b) => b.userId !== meId).sort((a, b) => userName(a.userId).localeCompare(userName(b.userId))).map((b) => (
              <tr key={b.userId}>
                <td className="font-medium">{userName(b.userId)}</td>
                <td className="tabular-nums">{d1(b.allot)}</td><td className="tabular-nums">{d1(b.carried)}</td><td className="tabular-nums">{b.adjustment ? `${b.adjustment > 0 ? "+" : ""}${d1(b.adjustment)}` : "—"}</td>
                <td className="tabular-nums">{d1(b.used)}</td><td className="tabular-nums">{b.pending ? d1(b.pending) : "—"}</td>
                <td className={`tabular-nums font-semibold ${b.left < 0 ? "text-red-700" : ""}`}>{d1(b.left)}</td>
                <td className="text-right">{(configure || others.some((o) => o.userId === b.userId)) && <Button size="icon-sm" variant="ghost" onClick={() => setAdjust(b.userId)} aria-label={`Adjust ${userName(b.userId)}`}><PencilIcon /></Button>}</td>
              </tr>
            ))}
          </DataTable>
          {team.adjustments.length > 0 && (
            <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Changes made by hand in {year} ({team.adjustments.length})</summary>
              <ul className="mt-1 grid gap-0.5">{team.adjustments.map((a) => <li key={a.adjId}>{userName(a.userId)}: {a.allot !== null ? `allowance ${a.allot}` : ""} {a.delta ? `${a.delta > 0 ? "+" : ""}${a.delta} days` : ""} — {a.note} <span className="opacity-70">({userName(a.createdBy)}, {a.createdAt.slice(0, 10)})</span></li>)}</ul>
            </details>
          )}
        </Section>
      )}
      {policy && <PolicyDialog year={year} current={data?.policy ?? []} onClose={(saved) => { setPolicy(false); if (saved) load(); }} />}
      {adjust && <AdjustDialog userId={adjust} year={year} onClose={(saved) => { setAdjust(null); if (saved) load(); }} />}
    </div>
  );
}

function PolicyDialog({ year, current, onClose }: { year: string; current: Policy[]; onClose: (saved?: boolean) => void }) {
  const { call } = useFlows();
  const [y, setY] = useState(year);
  const have = current.find((p) => p.year === y);
  const [allot, setAllot] = useState(String(have?.allot ?? ""));
  const [carryMax, setCarryMax] = useState(String(have?.carryMax ?? 0));
  const [until, setUntil] = useState(have?.carryUntil ?? "");
  const [busy, setBusy] = useState(false);
  const pick = (v: string) => { setY(v); const p = current.find((x) => x.year === v); setAllot(String(p?.allot ?? "")); setCarryMax(String(p?.carryMax ?? 0)); setUntil(p?.carryUntil ?? ""); };
  async function save() {
    setBusy(true);
    const r = await call("saveLeavePolicy", { year: y, allot, carryMax, carryUntil: until });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not save"); else { toast.success(`Leave policy for ${y} saved`); onClose(true); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Leave policy</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Year"><Input value={y} inputMode="numeric" maxLength={4} onChange={(e) => pick(e.target.value)} /></Field>
          <Field label="Leave days for everyone" hint="A person's own figure (set from the table) beats this."><Input value={allot} inputMode="decimal" onChange={(e) => setAllot(e.target.value)} placeholder="12" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Carry forward at most (days)" hint="0 = nothing is carried to next year"><Input value={carryMax} inputMode="decimal" onChange={(e) => setCarryMax(e.target.value)} /></Field>
            <Field label="Carried days usable until (MM-DD)" hint="Empty = no deadline. Example 03-31"><Input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="03-31" maxLength={5} /></Field>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button onClick={save} disabled={busy || !allot}>{busy && <Spinner />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ userId, year, onClose }: { userId: string; year: string; onClose: (saved?: boolean) => void }) {
  const { call, userName } = useFlows();
  const [allot, setAllot] = useState("");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await call("setLeaveAdjust", { userId, year, allot, delta, note });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not save"); else { toast.success("Leave balance changed"); onClose(true); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{userName(userId)} · leave {year}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Own allowance (days)" hint="Leave empty to follow the policy"><Input value={allot} inputMode="decimal" onChange={(e) => setAllot(e.target.value)} /></Field>
            <Field label="Add / remove days" hint="For example 2 or -1.5"><Input value={delta} inputMode="decimal" onChange={(e) => setDelta(e.target.value)} /></Field>
          </div>
          <Field label="Reason" hint="Kept in the history; the person is told."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button onClick={save} disabled={busy || !note.trim() || (!allot && !delta)}>{busy && <Spinner />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One person's balance for one year (from the server, so the policy, carry forward and adjustments are all in it). */
export function useYearBalance(userId: string, year: string): Balance | null {
  const { call } = useFlows();
  const [bal, setBal] = useState<{ key: string; b: Balance | null } | null>(null);
  const key = `${userId}|${year}`;
  useEffect(() => {
    let live = true;
    call<Payload>("getLeaveYear", { year, userId }).then((r) => { if (live) setBal({ key, b: r.ok ? r.data!.balances[0] ?? null : null }); });
    return () => { live = false; };
  }, [call, userId, year, key]);
  return bal?.key === key ? bal.b : null;
}

/** One calm sentence about the balance, for the places that only need a line. */
export function BalanceLine({ b, year }: { b: Balance | null; year: string }) {
  if (!b) return null;
  if (b.source === "none" && !b.adjustment) return <p className="text-xs text-muted-foreground">No leave allowance is set for {year}.</p>;
  return <p className="text-sm text-muted-foreground"><b className="text-foreground">{d1(b.left)}</b> of {d1(b.total)} days left in {year} · {d1(b.used)} used{b.pending ? ` · ${d1(b.pending)} waiting` : ""}{b.carried ? ` · ${d1(b.carried)} carried forward` : ""}</p>;
}
