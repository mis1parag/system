"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon, Columns3Icon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/lib/filters";
import { useFlows } from "@/lib/flow-store";
import type { ModuleId } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface Col<T> {
  id: string; label: string; render: (row: T) => ReactNode;
  /** makes the column sortable */ sort?: (row: T) => string | number;
  /** the value in an exported file (defaults to the sort value) */ csv?: (row: T) => string | number;
  /** hidden until the person turns it on */ hidden?: boolean; width?: number; align?: "right";
}
interface Prefs { order: string[]; hidden: string[]; widths: Record<string, number> }
const load = (key: string): Prefs | null => { try { const v = localStorage.getItem(`grid:${key}`); return v ? (JSON.parse(v) as Prefs) : null; } catch { return null; } };
const save = (key: string, p: Prefs) => { try { localStorage.setItem(`grid:${key}`, JSON.stringify(p)); } catch { /* storage blocked: the table still works */ } };

/**
 * A table people can shape: click a header to sort, choose and re-order the columns, drag a column edge to resize. The choice is remembered on that device.
 * The default view shows only the important columns. Export (when allowed) writes exactly what is on screen — and says so in the activity log.
 */
export function DataGrid<T>({ id, columns, rows, rowKey, onRowClick, exportAs, toolbar, empty }: {
  id: string; columns: Col<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void;
  exportAs?: { name: string; module: ModuleId }; toolbar?: ReactNode; empty?: ReactNode;
}) {
  const { allow, call } = useFlows();
  const [prefs, setPrefs] = useState<Prefs>(() => load(id) ?? { order: [], hidden: columns.filter((c) => c.hidden).map((c) => c.id), widths: {} });
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  const update = (p: Prefs) => { setPrefs(p); save(id, p); };

  const ordered = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const first = prefs.order.map((x) => byId.get(x)).filter((c): c is Col<T> => !!c);
    return [...first, ...columns.filter((c) => !prefs.order.includes(c.id))];
  }, [columns, prefs.order]);
  const visible = ordered.filter((c) => !prefs.hidden.includes(c.id));
  const sorted = useMemo(() => {
    const c = sort && columns.find((x) => x.id === sort.id);
    if (!c?.sort) return rows;
    const f = c.sort;
    return [...rows].sort((a, b) => { const x = f(a), y = f(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort!.dir; });
  }, [rows, sort, columns]);

  const move = (cid: string, by: -1 | 1) => {
    const ids = ordered.map((c) => c.id);
    const i = ids.indexOf(cid), j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    update({ ...prefs, order: ids });
  };
  const toggleCol = (cid: string) => update({ ...prefs, hidden: prefs.hidden.includes(cid) ? prefs.hidden.filter((x) => x !== cid) : [...prefs.hidden, cid] });

  function startResize(e: React.PointerEvent, cid: string, start: number) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX;
    let w = start;
    const onMove = (ev: PointerEvent) => { w = Math.max(60, Math.min(600, start + ev.clientX - x0)); setPrefs((p) => ({ ...p, widths: { ...p.widths, [cid]: w } })); };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); setPrefs((p) => { save(id, p); return p; }); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  async function exportNow() {
    if (!exportAs) return;
    const head = visible.map((c) => c.label);
    const body = sorted.map((r) => visible.map((c) => (c.csv ?? c.sort)?.(r) ?? ""));
    downloadCsv(`${exportAs.name}.csv`, toCsv(head, body));
    const r = await call("logExport", { module: exportAs.module, rows: sorted.length, what: exportAs.name });
    if (!r.ok) toast.error(r.error || "The export could not be recorded");
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2" ref={box}>
          {exportAs && allow(exportAs.module, "export") && <Button size="sm" variant="outline" onClick={exportNow}><DownloadIcon /> Export</Button>}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Columns3Icon /> Columns</Button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border bg-popover p-2 shadow-[0_8px_24px_rgba(26,31,54,0.16)]">
                <ul className="grid gap-0.5">
                  {ordered.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"><input type="checkbox" className="size-4" checked={!prefs.hidden.includes(c.id)} onChange={() => toggleCol(c.id)} /><span className="truncate">{c.label}</span></label>
                      <button aria-label={`Move ${c.label} up`} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-background disabled:opacity-30" onClick={() => move(c.id, -1)}><ArrowUpIcon className="size-3.5" /></button>
                      <button aria-label={`Move ${c.label} down`} disabled={i === ordered.length - 1} className="rounded p-1 text-muted-foreground hover:bg-background disabled:opacity-30" onClick={() => move(c.id, 1)}><ArrowDownIcon className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
                <button className="mt-1.5 w-full rounded-md px-2 py-1.5 text-left text-xs text-primary hover:bg-muted" onClick={() => update({ order: [], hidden: columns.filter((c) => c.hidden).map((c) => c.id), widths: {} })}>Back to the standard columns</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {sorted.length === 0 && empty ? empty : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
          <table className="w-full text-sm" style={{ tableLayout: Object.keys(prefs.widths).length ? "fixed" : "auto" }}>
            <thead className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {visible.map((c) => {
                  const active = sort?.id === c.id;
                  const w = prefs.widths[c.id] ?? c.width;
                  return (
                    <th key={c.id} style={w ? { width: w } : undefined} className={cn("relative select-none whitespace-nowrap px-3 py-2.5 font-semibold", c.align === "right" && "text-right")} aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}>
                      {c.sort ? (
                        <button className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground" onClick={() => setSort(active ? (sort!.dir === 1 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 })}>
                          {c.label}{active ? (sort!.dir === 1 ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />) : <ChevronsUpDownIcon className="size-3 opacity-40" />}
                        </button>
                      ) : c.label}
                      <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-primary/20" onPointerDown={(e) => startResize(e, c.id, (e.currentTarget.parentElement as HTMLElement).offsetWidth)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t">
              {sorted.map((r) => (
                <tr key={rowKey(r)} className={cn("hover:bg-[#f9fbfd]", onRowClick && "cursor-pointer")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {visible.map((c) => <td key={c.id} className={cn(c.align === "right" && "text-right tabular-nums")}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
