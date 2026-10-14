"use client";

import { cn } from "@/lib/utils";

/** Small, dependency-free SVG / CSS charts for the dashboard. Colours come from the theme so everything matches. */
export const C = { good: "#0e9f6e", warn: "#f5a623", bad: "#df1b41", info: "#635bff", violet: "#a39bff", mute: "#d5dbe3", ink: "#1a1f36" };

export interface Seg { label: string; value: number; color: string }

export function Donut({ segs, center, sub, size = 132 }: { segs: Seg[]; center: string; sub?: string; size?: number }) {
  const total = segs.reduce((a, s) => a + s.value, 0);
  const r = 46, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={segs.map((s) => `${s.label} ${s.value}`).join(", ")}>
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="14" className="text-muted" />
          {total > 0 && segs.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.label} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />;
            off += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><div className="text-xl font-semibold leading-none tabular-nums">{center}</div>{sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}</div>
      </div>
      <ul className="grid min-w-0 gap-1 text-xs">
        {segs.map((s) => <li key={s.label} className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} /><span className="min-w-0 truncate text-muted-foreground">{s.label}</span><span className="ml-auto pl-2 font-medium tabular-nums">{s.value}</span></li>)}
      </ul>
    </div>
  );
}

/** Two stacked values per day (for example finished on time + finished late). */
export function StackedBars({ points, a, b, height = 120 }: { points: { label: string; a: number; b: number }[]; a: { name: string; color: string }; b: { name: string; color: string }; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.a + p.b));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={`${a.name} and ${b.name} per day`}>
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${p.label}: ${p.a} ${a.name}, ${p.b} ${b.name}`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(p.b / max) * 100}%`, background: b.color }} />
            <div className={cn("w-full", p.b === 0 && "rounded-t-sm")} style={{ height: `${(p.a / max) * 100}%`, background: a.color }} />
            {p.a + p.b === 0 && <div className="h-0.5 w-full rounded bg-muted" />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[9px] text-muted-foreground">{points.map((p, i) => <span key={p.label} className="min-w-0 flex-1 truncate text-center">{i % 2 === 0 ? p.label : ""}</span>)}</div>
      <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: a.color }} />{a.name}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: b.color }} />{b.name}</span></div>
    </div>
  );
}

/** Horizontal bars: a "main" length with a highlighted part (for example open steps, of which overdue). */
export function HBars({ rows, main, hot }: { rows: { label: string; total: number; hot: number }[]; main: string; hot: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="grid gap-2">
      {rows.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nothing open.</p>}
      {rows.map((r) => (
        <div key={r.label} className="text-xs">
          <div className="mb-0.5 flex justify-between gap-2"><span className="truncate font-medium">{r.label}</span><span className="tabular-nums text-muted-foreground">{r.total}{r.hot ? <span className="ml-1 font-medium" style={{ color: hot }}>· {r.hot} late</span> : null}</span></div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" style={{ width: "100%" }}>
            <div style={{ width: `${(r.hot / max) * 100}%`, background: hot }} />
            <div style={{ width: `${((r.total - r.hot) / max) * 100}%`, background: main }} />
          </div>
        </div>
      ))}
    </div>
  );
}
