"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CircleSlashIcon, PencilIcon, PlusIcon, Undo2Icon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, EmptyState, ErrorBox, Field, Pill, Spinner } from "@/components/common";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { rupees } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Line { label: string; amount: number }
interface Waiver { waiverId: string; date: string; kind: "absent" | "late"; reason: string }
interface Calc { daysInMonth: number; present: number; half: number; leave: number; offDays: number; absentDates: string[]; halfDates: string[]; lateDates: string[]; lopDays: number; lateDeductDays: number; paidDays: number; perDay: number; lopAmount: number; lateAmount: number }
interface Row { userId: string; name: string; empCode: string; department: string; hasStructure: boolean; gross: number; fixedDeductions: number; calc: Calc | null; net: number | null; slip: { slipId: string; status: string } | null; waivers: Waiver[] }
interface Preview { period: string; provisional: boolean; lateMarks: number; rows: Row[] }
interface Structure { userId: string; earnings: Line[]; deductions: Line[]; gross: number; note: string; updatedAt: string }

/** The month's attendance turned into pay: who was absent (loss of pay), what payroll chose to waive off, and the draft slips that follow. */
export function PayFromAttendance() {
  const { call, today, isSuper, allow } = useFlows();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [pv, setPv] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [waive, setWaive] = useState<{ row: Row; date: string; kind: "absent" | "late" } | null>(null);
  const [setSalary, setSetSalary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canMake = isSuper || allow("payroll", "create");
  const canWaive = isSuper || allow("payroll", "edit");

  const load = useCallback(async () => {
    const r = await call<Preview>("payrollPreview", { period });
    if (r.ok) { setPv(r.data!); setError(""); } else setError(r.error || "Could not work out the month");
  }, [call, period]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPv(null); load(); }, [load]);

  async function make(ids: string[]) {
    setBusy(true);
    const r = await call<{ made: number; replaced: number; skipped: string[]; provisional: boolean }>("generatePaySlips", { period, userIds: ids });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not prepare the slips"); return; }
    toast.success(`${r.data!.made} slip${r.data!.made === 1 ? "" : "s"} prepared${r.data!.replaced ? `, ${r.data!.replaced} replaced` : ""} — review and publish them under Slips${r.data!.provisional ? ". The month is not over: days to come count as paid." : ""}`);
    if (r.data!.skipped.length) toast.message(r.data!.skipped.slice(0, 3).join(" · "));
    load();
  }
  async function undo(row: Row, w: Waiver) {
    const r = await call("setPayWaiver", { userId: row.userId, period, date: w.date, kind: w.kind, waive: false });
    if (!r.ok) toast.error(r.error || "Could not undo"); else { toast.success("Waiver removed"); load(); }
  }

  const ready = (pv?.rows ?? []).filter((r) => r.hasStructure);
  const stats = useMemo(() => ({ lop: ready.reduce((a, r) => a + (r.calc?.lopDays ?? 0), 0), waived: ready.reduce((a, r) => a + r.waivers.length, 0), net: ready.reduce((a, r) => a + (r.net ?? 0), 0) }), [ready]);
  if (error) return <ErrorBox message={error} onRetry={load} />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={period} max={today.slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="h-9 w-44" aria-label="Month" />
        <span className="text-xs text-muted-foreground">{fmtMonth(period)} · pay per day = monthly pay ÷ days in the month · {pv?.lateMarks ? `every ${pv.lateMarks} late arrivals cost half a day` : "late arrivals do not cost pay (Settings → PAY_LATE_MARKS)"}</span>
        {canMake && ready.length > 0 && <Button className="ml-auto" disabled={busy} onClick={() => make([])}>{busy ? <Spinner /> : <WandSparklesIcon />} Prepare draft slips for all ({ready.length})</Button>}
      </div>
      {pv?.provisional && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">This month is not over. Days still to come are counted as paid; run it again at the end of the month for the final figures.</p>}
      {!pv && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Working it out from attendance…</p>}
      {pv && ready.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg border bg-card p-2"><div className="text-muted-foreground">Loss-of-pay days</div><div className="text-lg font-semibold tabular-nums">{stats.lop}</div></div>
          <div className="rounded-lg border bg-card p-2"><div className="text-muted-foreground">Days waived off</div><div className="text-lg font-semibold tabular-nums">{stats.waived}</div></div>
          <div className="rounded-lg border bg-card p-2"><div className="text-muted-foreground">Net payable (all)</div><div className="text-lg font-semibold tabular-nums">{rupees(stats.net)}</div></div>
        </div>
      )}
      {pv && !pv.rows.length && <EmptyState title="Nobody to show" hint="People appear here when they are inside your payroll access." />}
      {pv && pv.rows.length > 0 && (
        <DataTable head={["Employee", "Attendance", "Loss of pay", "Pay", "Slip", ""]}>
          {pv.rows.map((r) => (
            <tr key={r.userId} className="align-top">
              <td className="font-medium">{r.name}<div className="text-[11px] font-normal text-muted-foreground">{r.empCode} {r.department}</div></td>
              {!r.hasStructure || !r.calc ? (
                <td colSpan={3} className="text-xs text-muted-foreground">No monthly salary set yet.</td>
              ) : (<>
                <td className="text-xs tabular-nums"><div>{r.calc.present}{r.calc.half ? ` + ${r.calc.half}½` : ""} present · {r.calc.leave} leave · {r.calc.offDays} off</div><div className="text-muted-foreground">{r.calc.lateDates.length} late</div></td>
                <td className="min-w-52 text-xs">
                  {r.calc.absentDates.length + r.calc.halfDates.length + r.calc.lateDates.length === 0 && <span className="text-muted-foreground">Full pay</span>}
                  <div className="flex flex-wrap gap-1">
                    {[...r.calc.absentDates.map((d) => ({ d, k: "absent" as const, half: false })), ...r.calc.halfDates.map((d) => ({ d, k: "absent" as const, half: true })), ...r.calc.lateDates.map((d) => ({ d, k: "late" as const, half: false }))].map(({ d, k, half }) => {
                      const w = r.waivers.find((x) => x.date === d && x.kind === k);
                      return (
                        <span key={`${k}${d}`} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5", w ? "border-emerald-200 bg-emerald-50 text-emerald-900" : k === "late" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900")}>
                          {k === "late" ? "late" : half ? "half" : "absent"} {fmtDate(d)}
                          {w ? <button title={`Waived off: ${w.reason}. Click to undo`} onClick={() => undo(r, w)} className="opacity-70 hover:opacity-100"><Undo2Icon className="size-3" /></button>
                            : canWaive && <button title="Waive off (pay for this day)" onClick={() => setWaive({ row: r, date: d, kind: k })} className="opacity-70 hover:opacity-100"><CircleSlashIcon className="size-3" /></button>}
                        </span>
                      );
                    })}
                  </div>
                  {r.calc.lopDays > 0 && <div className="mt-1 text-muted-foreground">{r.calc.lopDays} day{r.calc.lopDays === 1 ? "" : "s"} · −{rupees(r.calc.lopAmount)}{r.calc.lateAmount ? ` · late −${rupees(r.calc.lateAmount)}` : ""}</div>}
                </td>
                <td className="text-xs tabular-nums"><div>{rupees(r.gross)} gross</div><div className="font-semibold">{rupees(r.net ?? 0)} net</div><div className="text-muted-foreground">{r.calc.paidDays}/{r.calc.daysInMonth} days</div></td>
              </>)}
              <td>{r.slip ? <Pill tone={r.slip.status === "Published" ? "green" : "amber"}>{r.slip.status}</Pill> : <Pill>None</Pill>}</td>
              <td className="whitespace-nowrap text-right">
                {!r.hasStructure && canMake && <Button size="sm" variant="outline" onClick={() => setSetSalary(r.userId)}><PlusIcon /> Set salary</Button>}
                {r.hasStructure && canMake && r.slip?.status !== "Published" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => make([r.userId])}>{r.slip ? "Redo draft" : "Prepare"}</Button>}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {waive && <WaiveDialog {...waive} period={period} onClose={(ok) => { setWaive(null); if (ok) load(); }} />}
      {setSalary && <StructureDialog userId={setSalary} onClose={(saved) => { setSetSalary(null); if (saved) load(); }} />}
    </>
  );
}

function WaiveDialog({ row, date, kind, period, onClose }: { row: Row; date: string; kind: "absent" | "late"; period: string; onClose: (ok?: boolean) => void }) {
  const { call } = useFlows();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await call("setPayWaiver", { userId: row.userId, period, date, kind, reason });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not waive"); return; }
    toast.success("Waived off — that day is paid. Redo the draft slip to include it."); onClose(true);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Waive off · {row.name}</DialogTitle><DialogDescription>{kind === "late" ? "This late arrival will not count against the late-arrival rule." : `${fmtDate(date, true)} will be paid instead of counted as loss of pay.`}</DialogDescription></DialogHeader>
        <Field label="Why? (kept in the record)"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="For example: was on official work, forgot to check in" /></Field>
        <DialogFooter><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy || !reason.trim()}>{busy && <Spinner />} Waive off</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- salary of each person
export function SalaryStructures() {
  const { call, peopleFor, isSuper, meId, allow } = useFlows();
  const [rows, setRows] = useState<Structure[] | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const people = peopleFor("payroll").filter((p) => isSuper || p.userId !== meId);
  const load = useCallback(async () => {
    const r = await call<{ structures: Structure[] }>("listStructures", {});
    if (r.ok) { setRows(r.data!.structures); setError(""); } else setError(r.error || "Could not load");
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const by = new Map((rows ?? []).map((s) => [s.userId, s]));
  const can = isSuper || allow("payroll", "edit");
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!rows) return <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening…</p>;
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">The monthly pay of each person. Only people who run payroll see these figures — employees get their finished salary slip, not the numbers.</p>
      <DataTable head={["Employee", "Monthly pay", "Fixed deductions", ""]}>
        {people.map((p) => {
          const s = by.get(p.userId);
          return (
            <tr key={p.userId}>
              <td className="font-medium">{p.name}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{p.department}</span></td>
              <td className="tabular-nums">{s ? rupees(s.gross) : <span className="text-muted-foreground">not set</span>}</td>
              <td className="text-xs text-muted-foreground">{s && s.deductions.length ? s.deductions.map((d) => `${d.label} ${rupees(d.amount)}`).join(" · ") : "—"}</td>
              <td className="text-right">{can && <Button size="sm" variant={s ? "ghost" : "outline"} onClick={() => setEdit(p.userId)}>{s ? <><PencilIcon /> Edit</> : <><PlusIcon /> Set salary</>}</Button>}</td>
            </tr>
          );
        })}
      </DataTable>
      {edit && <StructureDialog userId={edit} existing={by.get(edit)} onClose={(saved) => { setEdit(null); if (saved) load(); }} />}
    </>
  );
}

function StructureDialog({ userId, existing, onClose }: { userId: string; existing?: Structure; onClose: (saved?: boolean) => void }) {
  const { call, userName } = useFlows();
  const [e, setE] = useState<{ label: string; amount: string }[]>(existing ? existing.earnings.map((l) => ({ label: l.label, amount: String(l.amount) })) : ["Basic", "HRA", "Allowances"].map((label) => ({ label, amount: "" })));
  const [d, setD] = useState<{ label: string; amount: string }[]>(existing ? existing.deductions.map((l) => ({ label: l.label, amount: String(l.amount) })) : ["PF", "Tax"].map((label) => ({ label, amount: "" })));
  const [busy, setBusy] = useState(false);
  const total = (l: { amount: string }[]) => l.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const block = (title: string, list: typeof e, setter: typeof setE) => (
    <div className="grid gap-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {list.map((x, i) => (
        <div key={i} className="flex gap-1.5"><Input value={x.label} onChange={(ev) => setter(list.map((y, j) => (j === i ? { ...y, label: ev.target.value } : y)))} placeholder="Name" aria-label={`${title} name`} /><Input value={x.amount} inputMode="decimal" onChange={(ev) => setter(list.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)))} placeholder="0" className="w-28" aria-label={`${title} amount`} /></div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setter([...list, { label: "", amount: "" }])}><PlusIcon /> Add line</Button>
    </div>
  );
  async function save() {
    setBusy(true);
    const r = await call("saveStructure", { userId, earnings: e, deductions: d });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success("Salary saved"); onClose(true);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Monthly salary · {userName(userId)}</DialogTitle><DialogDescription>What they earn in a full month, and deductions that are the same every month. Loss of pay and late arrivals are added from attendance.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">{block("Earnings", e, setE)}{block("Fixed deductions", d, setD)}</div>
        <div className="flex justify-between rounded-lg bg-muted p-2.5 text-sm"><span>Gross per month</span><b className="tabular-nums">{rupees(total(e))}</b></div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || total(e) <= 0}>{busy && <Spinner />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
