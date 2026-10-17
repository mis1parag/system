"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, EyeIcon, LockIcon, PlusIcon, PrinterIcon, SendIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, EmptyState, ErrorBox, Field, Pill, Spinner } from "@/components/common";
import { slipHtml, type SlipDoc } from "@/lib/slip-html";
import { rupees } from "@/lib/money";
import { parseCsv } from "@/lib/csv";
import { addMonths, fmtMonth } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Line { label: string; amount: number }
interface Slip { slipId: string; userId: string; period: string; daysPaid: number | null; earnings: Line[]; deductions: Line[]; gross: number; totalDeductions: number; net: number; note: string; status: "Draft" | "Published"; publishedAt: string; viewedAt: string }
interface Opened { slip: Slip; employee: { userId: string; name: string; empCode: string; department: string }; company: string }



/** Salary slips, inside the Attendance page: my slips (published only), asking for a missing one, and — for payroll people — preparing and publishing. */
export function SalaryPanel() {
  const { allow, isSuper, peopleFor } = useFlows();
  const prepares = isSuper || (["create", "edit", "approve", "manage", "import"] as const).some((a) => allow("payroll", a));
  const people = peopleFor("payroll");
  const [tab, setTab] = useState<"mine" | "manage">("mine");
  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground"><LockIcon className="size-3.5" /> You can open only your own slips, once they are published. Your reporting manager cannot see them.</p>
      {prepares && (
        <div className="mb-4 flex gap-1.5">
          {([["mine", "My slips"], ["manage", `Payroll${people.length > 1 || isSuper ? ` (${people.length})` : ""}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("rounded-full border px-3 py-1 text-xs font-medium", tab === k ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{l}</button>
          ))}
        </div>
      )}
      {tab === "mine" || !prepares ? <Mine /> : <Payroll />}
    </div>
  );
}

interface SlipReq { reqId: string; userId: string; period: string; note: string; status: "Pending" | "Done" | "Declined"; createdAt: string; reply: string }

function Mine() {
  const { call, today } = useFlows();
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [reqs, setReqs] = useState<SlipReq[]>([]);
  const [error, setError] = useState("");
  const [year, setYear] = useState("");
  const [open, setOpen] = useState<Opened | null>(null);
  const [asking, setAsking] = useState(false);
  const load = useCallback(async () => {
    const r = await call<{ slips: Slip[] }>("listSlips", {});
    if (r.ok) { setSlips(r.data!.slips); setError(""); } else setError(r.error || "Could not load your salary slips");
    const q = await call<{ requests: SlipReq[] }>("listSlipRequests", {});
    if (q.ok) setReqs(q.data!.requests);
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const years = useMemo(() => [...new Set((slips ?? []).map((s) => s.period.slice(0, 4)))].sort().reverse(), [slips]);
  const shown = (slips ?? []).filter((s) => !year || s.period.startsWith(year));
  const mine = reqs.filter((q) => q.status === "Pending" || q.status === "Declined").slice(0, 6);

  async function view(s: Slip) {
    const r = await call<Opened>("getSlip", { slipId: s.slipId });
    if (!r.ok) { toast.error(r.error || "Could not open the slip"); return; }
    setOpen(r.data!);
  }
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!slips) return <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening…</p>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {years.length > 1 && ["", ...years].map((y) => <button key={y || "all"} onClick={() => setYear(y)} aria-pressed={year === y} className={cn("rounded-full border px-3 py-1 text-xs font-medium", year === y ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted")}>{y || "All years"}</button>)}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAsking(true)}><SendIcon /> Request a salary slip</Button>
      </div>
      {mine.length > 0 && (
        <div className="mb-3 grid gap-1.5">{mine.map((q) => (
          <div key={q.reqId} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <Pill tone={q.status === "Pending" ? "amber" : "red"}>{q.status === "Pending" ? "Asked" : "Not available"}</Pill><b>{fmtMonth(q.period)}</b>
            <span className="text-xs text-muted-foreground">{q.status === "Pending" ? "Payroll has been told. You get a message when it is ready." : q.reply}</span>
          </div>
        ))}</div>
      )}
      {!slips.length && <EmptyState title="No salary slip yet" hint="When payroll publishes your slip for a month it appears here. If one is missing, use “Request a salary slip”." />}
      <div className="grid gap-2">
        {shown.map((s) => (
          <button key={s.slipId} onClick={() => view(s)} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left hover:bg-muted/40">
            <div><div className="font-medium">{fmtMonth(s.period)}</div><div className="text-xs text-muted-foreground">{s.daysPaid !== null ? `${s.daysPaid} days paid` : "Salary slip"}</div></div>
            <div className="flex items-center gap-3"><span className="font-semibold tabular-nums">{rupees(s.net)}</span><EyeIcon className="size-4 text-muted-foreground" /></div>
          </button>
        ))}
      </div>
      {open && <SlipDialog o={open} onClose={() => setOpen(null)} />}
      {asking && <AskDialog today={today} have={new Set((slips ?? []).map((s) => s.period))} onClose={(sent) => { setAsking(false); if (sent) load(); }} />}
    </>
  );
}

function AskDialog({ today, have, onClose }: { today: string; have: Set<string>; onClose: (sent?: boolean) => void }) {
  const { call } = useFlows();
  const months = useMemo(() => Array.from({ length: 14 }, (_, i) => addMonths(today.slice(0, 7), -i)).filter((m) => !have.has(m)), [today, have]);
  const [period, setPeriod] = useState(months[0] ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await call("requestSlip", { period, note });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not send the request"); return; }
    toast.success("Request sent to payroll"); onClose(true);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request a salary slip</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Which month?"><NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)}>{months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}</NativeSelect></Field>
          <Field label="Note (optional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="For example: needed for a bank loan" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={go} disabled={busy || !period}>{busy && <Spinner />} Send request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The slip as the finished A4 document, with print / save as PDF. */
function SlipDialog({ o, onClose }: { o: Opened; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => slipHtml(o as unknown as SlipDoc), [o]);
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } else toast.error("Could not open the print view"); };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[94dvh] gap-3 overflow-hidden sm:max-w-3xl">
        <DialogHeader><DialogTitle>Salary slip · {fmtMonth(o.slip.period)}</DialogTitle></DialogHeader>
        <iframe ref={frame} title="Salary slip" srcDoc={html} className="h-[68dvh] w-full rounded-lg border bg-[#eef1f6]" />
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={print}><PrinterIcon /> Print / save as PDF</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- payroll people
const DEFAULT_E = ["Basic", "HRA", "Allowances"], DEFAULT_D = ["PF", "Tax"];

function Payroll() {
  const { call, allow, isSuper, userName, peopleFor, today, meId } = useFlows();
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [edit, setEdit] = useState<{ slip?: Slip; userId?: string } | null>(null);
  const [view, setView] = useState<Opened | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [reqs, setReqs] = useState<SlipReq[]>([]);
  const [importing, setImporting] = useState(false);
  const people = peopleFor("payroll").filter((p) => isSuper || p.userId !== meId); // payroll prepares other people's slips, never their own
  const canPublish = isSuper || allow("payroll", "approve");
  const canCreate = isSuper || allow("payroll", "create");
  const canImport = isSuper || allow("payroll", "import");

  const load = useCallback(async () => {
    const r = await call<{ slips: Slip[] }>("listSlips", { everyone: true, period });
    if (r.ok) { setSlips(r.data!.slips); setError(""); setPick(new Set()); } else setError(r.error || "Could not load");
    const q = await call<{ requests: SlipReq[] }>("listSlipRequests", {});
    if (q.ok) setReqs(q.data!.requests.filter((x) => x.status === "Pending" && x.userId !== meId));
  }, [call, period, meId]);
  useEffect(() => { load(); }, [load]);
  const bySlip = new Map((slips ?? []).map((s) => [s.userId, s]));

  async function publish(ids: string[], publish: boolean) {
    const r = await call<{ changed: number }>("publishSlips", { slipIds: ids, publish });
    if (!r.ok) toast.error(r.error || "Failed"); else { toast.success(publish ? `${r.data!.changed} published — employees are told` : `${r.data!.changed} taken back to draft`); load(); }
  }
  async function decline(q: SlipReq) {
    const reply = window.prompt("Why can the slip for " + fmtMonth(q.period) + " not be given to " + userName(q.userId) + "?", "");
    if (!reply) return;
    const r = await call("declineSlipRequest", { reqId: q.reqId, reply });
    if (!r.ok) toast.error(r.error || "Failed"); else { toast.success("Declined - the person is told"); load(); }
  }
  async function open(s: Slip) { const r = await call<Opened>("getSlip", { slipId: s.slipId }); if (r.ok) setView(r.data!); else toast.error(r.error || "Could not open"); }
  async function remove(s: Slip) {
    if (!window.confirm(`Delete ${userName(s.userId)}'s slip for ${fmtMonth(s.period)}?`)) return;
    const r = await call("deleteSlip", { slipId: s.slipId });
    if (!r.ok) toast.error(r.error || "Could not delete"); else { toast.success("Deleted"); load(); }
  }
  const drafts = (slips ?? []).filter((s) => s.status === "Draft");
  const sel = (slips ?? []).filter((s) => pick.has(s.slipId));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-44" aria-label="Month" />
        <span className="text-xs text-muted-foreground">{(slips ?? []).length} of {people.length} people have a slip · {drafts.length} draft</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canImport && <Button variant="outline" onClick={() => setImporting(true)}><UploadIcon /> Import CSV</Button>}
          {canPublish && sel.length > 0 && <Button onClick={() => publish(sel.map((s) => s.slipId), true)}>Publish {sel.length}</Button>}
          {canPublish && drafts.length > 0 && sel.length === 0 && <Button variant="outline" onClick={() => publish(drafts.map((s) => s.slipId), true)}>Publish all {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}</Button>}
        </div>
      </div>
      {reqs.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="mb-1.5 font-medium text-amber-900">{reqs.length} salary slip request{reqs.length === 1 ? "" : "s"} waiting</div>
          <div className="grid gap-1">{reqs.map((q) => (
            <div key={q.reqId} className="flex flex-wrap items-center gap-2"><b>{userName(q.userId)}</b><span>· {fmtMonth(q.period)}</span>{q.note && <span className="text-xs text-muted-foreground">“{q.note}”</span>}
              <span className="ml-auto flex gap-1"><Button size="sm" variant="outline" onClick={() => { setPeriod(q.period); setEdit({ userId: q.userId }); }}>Prepare</Button><Button size="sm" variant="ghost" className="text-red-700" onClick={() => decline(q)}>Decline</Button></span></div>
          ))}</div>
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!slips && !error && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening…</p>}
      {slips && (
        <DataTable head={["", "Employee", "Gross", "Net", "Status", ""]}>
          {people.filter((p) => p.userId !== "").map((p) => {
            const s = bySlip.get(p.userId);
            return (
              <tr key={p.userId}>
                <td className="w-8">{s && canPublish && <input type="checkbox" checked={pick.has(s.slipId)} onChange={(e) => setPick((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.slipId); else n.delete(s.slipId); return n; })} aria-label={`Select ${p.name}`} />}</td>
                <td className="font-medium">{p.name}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{p.department}</span></td>
                <td className="tabular-nums">{s ? rupees(s.gross) : "—"}</td>
                <td className="tabular-nums">{s ? rupees(s.net) : "—"}</td>
                <td>{s ? <Pill tone={s.status === "Published" ? "green" : "amber"}>{s.status}{s.status === "Published" && s.viewedAt ? " · opened" : ""}</Pill> : <Pill>No slip</Pill>}</td>
                <td className="text-right whitespace-nowrap">
                  {s ? (<>
                    <Button size="icon-sm" variant="ghost" onClick={() => open(s)} aria-label="View"><EyeIcon /></Button>
                    {(isSuper || allow("payroll", "edit")) && <Button size="sm" variant="ghost" onClick={() => setEdit({ slip: s })}>Edit</Button>}
                    {canPublish && s.status === "Published" && <Button size="sm" variant="ghost" onClick={() => publish([s.slipId], false)}>Unpublish</Button>}
                    {canPublish && s.status === "Draft" && <Button size="sm" variant="ghost" onClick={() => publish([s.slipId], true)}>Publish</Button>}
                    {(isSuper || allow("payroll", "delete")) && <Button size="icon-sm" variant="ghost" className="text-red-700" onClick={() => remove(s)} aria-label="Delete"><Trash2Icon /></Button>}
                  </>) : (canCreate && p.userId !== "" && <Button size="sm" variant="outline" onClick={() => setEdit({ userId: p.userId })}><PlusIcon /> Prepare</Button>)}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {edit && <SlipForm period={period} slip={edit.slip} userId={edit.userId} onClose={(saved) => { setEdit(null); if (saved) load(); }} />}
      {view && <SlipDialog o={view} onClose={() => setView(null)} />}
      {importing && <ImportDialog period={period} onClose={(done) => { setImporting(false); if (done) load(); }} />}
    </>
  );
}

function SlipForm({ period, slip, userId, onClose }: { period: string; slip?: Slip; userId?: string; onClose: (saved?: boolean) => void }) {
  const { call, userName } = useFlows();
  const [e, setE] = useState<{ label: string; amount: string }[]>(slip ? slip.earnings.map((l) => ({ label: l.label, amount: String(l.amount) })) : DEFAULT_E.map((label) => ({ label, amount: "" })));
  const [d, setD] = useState<{ label: string; amount: string }[]>(slip ? slip.deductions.map((l) => ({ label: l.label, amount: String(l.amount) })) : DEFAULT_D.map((label) => ({ label, amount: "" })));
  const [days, setDays] = useState(slip?.daysPaid !== null && slip?.daysPaid !== undefined ? String(slip.daysPaid) : "");
  const [note, setNote] = useState(slip?.note ?? "");
  const [busy, setBusy] = useState(false);
  const total = (l: { amount: string }[]) => l.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const uid = slip?.userId ?? userId!;
  const set = (list: typeof e, setter: typeof setE, i: number, k: "label" | "amount", v: string) => setter(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const block = (title: string, list: typeof e, setter: typeof setE) => (
    <div className="grid gap-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {list.map((x, i) => (
        <div key={i} className="flex gap-1.5"><Input value={x.label} onChange={(ev) => set(list, setter, i, "label", ev.target.value)} placeholder="Name" aria-label={`${title} name`} /><Input value={x.amount} inputMode="decimal" onChange={(ev) => set(list, setter, i, "amount", ev.target.value)} placeholder="0" className="w-28" aria-label={`${title} amount`} /></div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setter([...list, { label: "", amount: "" }])}><PlusIcon /> Add line</Button>
    </div>
  );
  async function save() {
    setBusy(true);
    const r = await call("saveSlip", { slipId: slip?.slipId, userId: uid, period: slip?.period ?? period, daysPaid: days, earnings: e, deductions: d, note });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success(slip ? "Slip updated" : "Saved as a draft — publish it when it is ready"); onClose(true);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{slip ? "Edit" : "Prepare"} salary slip · {userName(uid)} · {fmtMonth(slip?.period ?? period)}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">{block("Earnings", e, setE)}{block("Deductions", d, setD)}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Days paid"><Input value={days} inputMode="decimal" onChange={(ev) => setDays(ev.target.value)} placeholder="30" /></Field>
          <Field label="Gross">{<div className="h-9 rounded-md border bg-muted px-3 py-2 text-sm tabular-nums">{rupees(total(e))}</div>}</Field>
          <Field label="Net pay"><div className="h-9 rounded-md border bg-muted px-3 py-2 text-sm font-semibold tabular-nums">{rupees(total(e) - total(d))}</div></Field>
        </div>
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300} /></Field>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <Spinner />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** CSV columns: Employee ID, Month (2026-10), Days paid, then "E: Basic", "E: HRA" … for earnings and "D: PF" … for deductions. */
function ImportDialog({ period, onClose }: { period: string; onClose: (done?: boolean) => void }) {
  const { call } = useFlows();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ added: number; problems: string[] } | null>(null);
  const sample = `Employee ID,Month,Days paid,E: Basic,E: HRA,D: PF\nDE0007,${period},30,20000,8000,1800`;
  function rows() {
    const t = parseCsv(text.trim());
    if (t.length < 2) return [];
    const head = t[0].map((h) => h.trim());
    return t.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
      const get = (name: RegExp) => r[head.findIndex((h) => name.test(h))]?.trim() ?? "";
      const lines = (p: string) => head.map((h, i) => ({ h, i })).filter(({ h }) => new RegExp(`^${p}\\s*:`, "i").test(h)).map(({ h, i }) => ({ label: h.replace(/^[ED]\s*:\s*/i, "").trim(), amount: r[i]?.trim() ?? "" })).filter((l) => l.amount !== "");
      return { empCode: get(/^(employee\s*id|emp\s*code|id)$/i), period: get(/^(month|period)$/i) || period, daysPaid: get(/^days/i), earnings: lines("E"), deductions: lines("D") };
    });
  }
  async function go() {
    const list = rows();
    if (!list.length) { toast.error("Paste the CSV with its header row"); return; }
    setBusy(true);
    const r = await call<{ added: number; problems: string[] }>("importSlips", { rows: list });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Import failed"); return; }
    setRes(r.data!);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose(!!res)}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Import salary slips (as drafts)</DialogTitle></DialogHeader>
        {!res ? (<>
          <p className="text-xs text-muted-foreground">Paste a CSV from your sheet. Columns: Employee ID, Month, Days paid, then <b>E: Basic</b>, <b>E: HRA</b>… for earnings and <b>D: PF</b>… for deductions. Nothing is published until you publish it.</p>
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder={sample} />
          <button className="inline-flex items-center gap-1 text-xs text-primary" onClick={() => { const b = new Blob([sample + "\n"], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "salary-slips-sample.csv"; a.click(); }}><DownloadIcon className="size-3.5" /> Download a sample</button>
          <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button onClick={go} disabled={busy || !text.trim()}>{busy && <Spinner />} Import</Button></DialogFooter>
        </>) : (<>
          <p className="text-sm"><b>{res.added}</b> slip{res.added === 1 ? "" : "s"} prepared as drafts.</p>
          {res.problems.length > 0 && <ul className="list-disc pl-5 text-xs text-red-700">{res.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <DialogFooter><Button onClick={() => onClose(true)}>Done</Button></DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
