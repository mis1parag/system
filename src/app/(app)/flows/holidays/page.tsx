"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, Field, PageHeader, Pill, Section, Spinner } from "@/components/common";
import { fmtDate, fmtMonth, weekdayName } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import type { Holiday } from "@/lib/flow-types";

type H = Holiday & { published?: string; note?: string };
/** Days that are the same every year: a safe name for a holiday that was imported without one. */
const FIXED: Record<string, string> = { "01-26": "Republic Day", "08-15": "Independence Day", "10-02": "Gandhi Jayanti", "12-25": "Christmas" };
const unnamed = (h: H) => !h.label || /^imported/i.test(h.label);
const nameOf = (h: H) => (unnamed(h) ? FIXED[h.date.slice(5)] ?? "" : h.label);

/** The company's holidays, year by year. Everyone sees the published list; the people who manage holidays prepare drafts, edit and publish. */
export default function HolidaysPage() {
  const { data, today, isSuper, allow, call } = useFlows();
  const manage = isSuper || allow("attendance", "configure");
  const [year, setYear] = useState(today.slice(0, 4));
  const [edit, setEdit] = useState<H | "new" | null>(null);
  const [many, setMany] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => ((data?.holidays ?? []) as H[]).filter((h) => !h.flowId), [data?.holidays]);
  const rows = all.filter((h) => h.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
  const drafts = rows.filter((h) => h.published === "N");
  const years = [...new Set([year, today.slice(0, 4), ...all.map((h) => h.date.slice(0, 4))])].sort();
  const months = [...new Set(rows.map((h) => h.date.slice(0, 7)))];
  const next = all.filter((h) => h.date >= today && h.published !== "N").sort((a, b) => a.date.localeCompare(b.date))[0];

  async function publishYear() {
    if (!window.confirm(`Publish ${drafts.length} draft holiday${drafts.length === 1 ? "" : "s"} for ${year}? Everyone will see them and planned dates will skip them.`)) return;
    setBusy(true);
    const r = await call<{ changed: number }>("publishHolidays", { year, publish: true });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success(`${r.data!.changed} published`);
  }
  async function remove(h: H) {
    if (!window.confirm(`Delete ${h.label || h.date}? Planned dates are re-worked.`)) return;
    const r = await call("deleteHoliday", { holidayId: h.holidayId });
    if (!r.ok) toast.error(r.error || "Could not delete"); else toast.success("Deleted");
  }

  return (
    <>
      <PageHeader
        title="Company holidays"
        subtitle="Holidays are not working days: planned dates, attendance and leave all skip them."
        actions={manage && <div className="flex gap-2"><Button variant="outline" onClick={() => setMany(true)}>Add many dates</Button><Button onClick={() => setEdit("new")}><CalendarPlusIcon /> Add a holiday</Button></div>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
          <Button size="icon-sm" variant="ghost" onClick={() => setYear(String(Number(year) - 1))} aria-label="Previous year"><ChevronLeftIcon /></Button>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-transparent text-sm font-semibold tabular-nums" aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>
          <Button size="icon-sm" variant="ghost" onClick={() => setYear(String(Number(year) + 1))} aria-label="Next year"><ChevronRightIcon /></Button>
        </div>
        <span className="text-xs text-muted-foreground">{rows.filter((h) => h.published !== "N").length} holidays in {year}{next && ` · next: ${nameOf(next) || "Holiday"}, ${fmtDate(next.date, true)}`}</span>
        {manage && drafts.length > 0 && <Button size="sm" className="ml-auto" disabled={busy} onClick={publishYear}>{busy && <Spinner />} Publish {drafts.length} draft{drafts.length === 1 ? "" : "s"}</Button>}
      </div>
      {!rows.length && <EmptyState title={`No holidays for ${year}`} hint={manage ? "Add the festival and company holidays, then publish them." : "The company has not published any holiday for this year yet."} />}
      <div className="grid gap-3">
        {months.map((m) => (
          <Section key={m} title={fmtMonth(m)}>
            <div className="grid gap-1.5">
              {rows.filter((h) => h.date.startsWith(m)).map((h) => (
                <div key={h.holidayId} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <div className="w-16 shrink-0 text-center"><div className="text-lg font-semibold leading-none tabular-nums">{h.date.slice(8)}</div><div className="text-[10px] uppercase text-muted-foreground">{weekdayName(h.date).slice(0, 3)}</div></div>
                  <div className="min-w-0 flex-1"><div className="font-medium">{nameOf(h) || <span className="text-muted-foreground">Holiday — no name yet</span>}</div>{h.note && <div className="text-xs text-muted-foreground">{h.note}</div>}</div>
                  {h.published === "N" ? <Pill tone="amber">Draft</Pill> : manage ? <Pill tone="green">Published</Pill> : null}
                  {manage && <><Button size="icon-sm" variant="ghost" onClick={() => setEdit(h)} aria-label={`Edit ${h.label}`}><PencilIcon /></Button><Button size="icon-sm" variant="ghost" className="text-red-700" onClick={() => remove(h)} aria-label={`Delete ${h.label}`}><Trash2Icon /></Button></>}
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>
      {edit && <HolidayDialog h={edit === "new" ? undefined : edit} year={year} onClose={() => setEdit(null)} />}
      {many && <ManyDialog year={year} onClose={() => setMany(false)} />}
    </>
  );
}

function HolidayDialog({ h, year, onClose }: { h?: H; year: string; onClose: () => void }) {
  const { call } = useFlows();
  const [date, setDate] = useState(h?.date ?? `${year}-01-01`);
  const [label, setLabel] = useState(h ? nameOf(h) : "");
  const [note, setNote] = useState(h?.note ?? "");
  const [published, setPublished] = useState(h ? h.published !== "N" : true);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await call("saveHoliday", { holidayId: h?.holidayId, date, label, note, published });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not save"); else { toast.success(h ? "Holiday updated" : published ? "Holiday added" : "Saved as a draft"); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{h ? "Edit holiday" : "Add a holiday"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Name"><Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Diwali" /></Field>
          <Field label="Note (optional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Publish now (everyone sees it; draft = only holiday managers see it)</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !label.trim()}>{busy && <Spinner />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManyDialog({ year, onClose }: { year: string; onClose: () => void }) {
  const { call } = useFlows();
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    const dates = text.split(/[\s,;]+/).filter(Boolean);
    setBusy(true);
    const r = await call<{ added: number; skipped: number }>("addHolidays", { dates, label, published });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not add"); else { toast.success(`${r.data!.added} added${r.data!.skipped ? `, ${r.data!.skipped} were already there` : ""}`); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add many holidays</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Dates" hint={`One per line or separated by commas, like ${year}-10-20`}><textarea className="min-h-28 rounded-md border bg-background p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Name (same for all)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Festival holiday" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Publish now (otherwise they stay drafts until you publish the year)</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !text.trim()}>{busy && <Spinner />} Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
