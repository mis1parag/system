"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BookmarkIcon, DownloadIcon, FilterIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { activeCount, EMPTY_FILTER, fromParams, needsValue, newCond, OP_LABEL, OPS, toParams, type Condition, type FieldDef, type FilterState } from "@/lib/filters";
import { useFlows } from "@/lib/flow-store";
import type { ModuleId } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** The filter state of a page. Starts from the person's default saved view for that page, if they set one. */
export function useFilters(page: string, defaultQuick = "all") {
  const { data, meId } = useFlows();
  const fromLink = useSearchParams().get("quick"); // a tap on a number elsewhere (…?quick=overdue) opens the list already filtered
  const [state, setState] = useState<FilterState>(() => {
    if (fromLink) return EMPTY_FILTER(fromLink);
    const d = data?.savedFilters.find((f) => f.page === page && f.userId === meId && f.isDefault === "Y");
    return d ? fromParams(d.paramsJson, defaultQuick) : EMPTY_FILTER(defaultQuick);
  });
  return [state, setState, () => setState(EMPTY_FILTER(defaultQuick))] as const;
}

export interface QuickDef { id: string; label: string; count?: number }

/**
 * The one filter bar for every list: quick filters (one click), search, "Filters" (conditions with operators), saved views, export.
 * Basic things are always visible; the conditions open on demand.
 */
export function FilterBar<T>({ page, module, fields, quick, state, onChange, shown, total, placeholder = "Search…", onExport, children }: {
  page: string; module: ModuleId; fields: FieldDef<T>[]; quick: QuickDef[]; state: FilterState; onChange: (s: FilterState) => void; shown: number; total: number;
  placeholder?: string; onExport?: () => void; children?: ReactNode;
}) {
  const { allow } = useFlows();
  const [open, setOpen] = useState(() => activeCount(state) > 0);
  const n = activeCount(state);
  const filtered = n > 0 || !!state.q || state.quick !== quick[0]?.id;
  const set = (patch: Partial<FilterState>) => onChange({ ...state, ...patch });
  const upd = (id: string, patch: Partial<Condition>) => set({ conds: state.conds.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <div className="mb-3 rounded-lg border bg-card p-2.5 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        {quick.map((q) => (
          <button key={q.id} onClick={() => set({ quick: q.id })} aria-pressed={state.quick === q.id}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors", state.quick === q.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {q.label}{q.count !== undefined && <span className={cn("ml-1.5 tabular-nums", state.quick === q.id ? "text-primary-foreground/80" : "text-muted-foreground/70")}>{q.count}</span>}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{shown === total ? `${total}` : `${shown} of ${total}`}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder={placeholder} value={state.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" /></div>
        <Button variant={open || n ? "default" : "outline"} onClick={() => setOpen((o) => !o)} aria-expanded={open}><FilterIcon /> Filters{n ? ` · ${n}` : ""}</Button>
        <SavedViews page={page} module={module} state={state} onApply={onChange} />
        {children}
        {onExport && allow(module, "export") && <Button variant="outline" onClick={onExport}><DownloadIcon /> Export</Button>}
        {filtered && <Button variant="ghost" onClick={() => onChange(EMPTY_FILTER(quick[0]?.id ?? "all"))}><XIcon /> Clear</Button>}
      </div>
      {open && (
        <div className="mt-2.5 grid gap-2 border-t pt-2.5">
          {state.conds.length === 0 && <p className="text-xs text-muted-foreground">Add a condition, for example <b>Status is Pending</b> and <b>Due date is between</b> two dates. All conditions must hold.</p>}
          {state.conds.map((c) => {
            const f = fields.find((x) => x.key === c.field) ?? fields[0];
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <NativeSelect className="w-40" value={c.field} aria-label="Field" onChange={(e) => { const nf = fields.find((x) => x.key === e.target.value)!; upd(c.id, { field: nf.key, op: OPS[nf.type][0], value: "", value2: undefined }); }}>{fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</NativeSelect>
                <NativeSelect className="w-40" value={c.op} aria-label="Operator" onChange={(e) => upd(c.id, { op: e.target.value as Condition["op"] })}>{OPS[f.type].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</NativeSelect>
                {needsValue(c.op) && (f.type === "select" || f.type === "user") ? (
                  <NativeSelect className="w-48" value={c.value} aria-label="Value" onChange={(e) => upd(c.id, { value: e.target.value })}><option value="">Choose…</option>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
                ) : needsValue(c.op) && f.type === "date" ? (
                  <><Input type="date" className="w-40" value={c.value} aria-label="Date" onChange={(e) => upd(c.id, { value: e.target.value })} />{c.op === "between" && <><span className="text-xs text-muted-foreground">and</span><Input type="date" className="w-40" value={c.value2 ?? ""} min={c.value} aria-label="Until" onChange={(e) => upd(c.id, { value2: e.target.value })} /></>}</>
                ) : needsValue(c.op) ? (
                  <Input className="w-48" value={c.value} aria-label="Value" onChange={(e) => upd(c.id, { value: e.target.value })} placeholder="Type…" />
                ) : null}
                <button aria-label="Remove this condition" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-red-700" onClick={() => set({ conds: state.conds.filter((x) => x.id !== c.id) })}><Trash2Icon className="size-4" /></button>
              </div>
            );
          })}
          <div><Button size="sm" variant="outline" onClick={() => set({ conds: [...state.conds, newCond(fields)] })}><PlusIcon /> Add condition</Button></div>
        </div>
      )}
    </div>
  );
}

/** Saved views of one page: apply, make default, share (if allowed), delete — and save the current filter under a name. */
function SavedViews({ page, module, state, onApply }: { page: string; module: ModuleId; state: FilterState; onApply: (s: FilterState) => void }) {
  const { data, meId, call, allow } = useFlows();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const mine = (data?.savedFilters ?? []).filter((f) => f.page === page).sort((a, b) => (a.userId === meId ? 0 : 1) - (b.userId === meId ? 0 : 1) || a.name.localeCompare(b.name));

  async function save() {
    const r = await call("saveFilter", { page, name, params: toParams(state), shared });
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success("View saved"); setName(""); setShared(false);
  }
  async function makeDefault(id: string, on: boolean) {
    const f = mine.find((x) => x.filterId === id)!;
    const r = await call("saveFilter", { filterId: id, page, name: f.name, params: JSON.parse(f.paramsJson || "{}"), shared: f.shared === "Y", isDefault: on });
    if (!r.ok) toast.error(r.error || "Could not change");
  }
  async function remove(id: string) {
    const r = await call("deleteFilter", { filterId: id });
    if (!r.ok) toast.error(r.error || "Could not delete");
  }
  async function rename(id: string) {
    const f = mine.find((x) => x.filterId === id)!;
    const next = window.prompt("New name", f.name);
    if (!next || next === f.name) return;
    const r = await call("saveFilter", { filterId: id, page, name: next, params: JSON.parse(f.paramsJson || "{}"), shared: f.shared === "Y", isDefault: f.isDefault === "Y" });
    if (!r.ok) toast.error(r.error || "Could not rename");
  }
  return (
    <div className="relative" ref={box}>
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}><BookmarkIcon /> Views{mine.length ? ` · ${mine.length}` : ""}</Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 max-w-[90vw] rounded-lg border bg-popover p-2 shadow-[0_8px_24px_rgba(26,31,54,0.16)]">
          {mine.length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">No saved views yet. Set up a filter, then save it below.</p>}
          <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
            {mine.map((f) => (
              <li key={f.filterId} className="group flex items-center gap-1 rounded-md hover:bg-muted">
                <button className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm" onClick={() => { onApply(fromParams(f.paramsJson)); setOpen(false); }}>{f.name}{f.shared === "Y" && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">shared</span>}</button>
                {f.userId === meId ? (
                  <>
                    <button aria-label={f.isDefault === "Y" ? "Not the default any more" : "Make this the default"} title={f.isDefault === "Y" ? "Default view" : "Make default"} className="rounded p-1.5 hover:bg-background" onClick={() => makeDefault(f.filterId, f.isDefault !== "Y")}><StarIcon className={cn("size-3.5", f.isDefault === "Y" ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} /></button>
                    <button aria-label="Rename" className="rounded px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100" onClick={() => rename(f.filterId)}>rename</button>
                    <button aria-label="Delete this view" className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-red-700" onClick={() => remove(f.filterId)}><Trash2Icon className="size-3.5" /></button>
                  </>
                ) : <span className="px-2 text-[10px] text-muted-foreground">by a colleague</span>}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid gap-1.5 border-t pt-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view (e.g. Overdue for Rahul)" aria-label="Name of the view" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }} />
            {allow(module, "manage") && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="size-3.5" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone who can open this page</label>}
            <Button size="sm" disabled={!name.trim()} onClick={save}>Save current view</Button>
          </div>
        </div>
      )}
    </div>
  );
}
