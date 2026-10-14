"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { InfoIcon, Loader2Icon, LightbulbIcon, XIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { pct1 } from "@/lib/format";

export function PageHeader({ title, subtitle, actions, help }: { title: string; subtitle?: ReactNode; actions?: ReactNode; help?: { id: string; title: string; text: ReactNode } }) {
  return (
    <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[1.45rem] font-semibold tracking-tight text-foreground md:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {help && <Tip id={help.id} title={help.title}>{help.text}</Tip>}
    </>
  );
}

export function Section({ title, hint, actions, children, className }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-3 p-4", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-[0.95rem] font-semibold text-foreground">{title}</h2>}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Card>
  );
}

type Tone = "gray" | "green" | "amber" | "red" | "blue" | "violet" | "teal";
const TONES: Record<Tone, string> = {
  gray: "bg-[#e3e8ee] text-[#3c4257]",
  green: "bg-[#cbf4c9] text-[#0e6245]",
  amber: "bg-[#fcedb9] text-[#983705]",
  red: "bg-[#ffd7da] text-[#a41c4e]",
  blue: "bg-[#d6ecff] text-[#0055bc]",
  violet: "bg-[#e4e0ff] text-[#4b3fd6]",
  teal: "bg-[#c4f0f0] text-[#0b6a6a]",
};
export function Pill({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-semibold", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  LISTED: "gray", VISITED: "gray", PROSPECT: "amber", CONVERTED: "green", REPEAT: "teal",
  Captured: "gray", Entered: "blue", Verified: "violet", Billed: "amber", Supplied: "green", Cancelled: "red",
  Pending: "amber", Rescheduled: "blue", Completed: "green", Converted: "teal", Lost: "red",
  Introduced: "gray", Interested: "amber", Ordered: "green", Repeat: "teal", "Not Introduced": "gray",
  Planned: "gray", Visited: "green", Skipped: "red",
  "Due Today": "amber", "Due Soon": "blue", Overdue: "red", "Repeat Received": "green", "On Track": "gray",
  High: "red", Medium: "amber", Low: "gray",
  Active: "green", Inactive: "gray",
};
export function StatusPill({ value }: { value: string }) {
  return <Pill tone={STATUS_TONE[value] ?? "gray"}>{value}</Pill>;
}

export function StatCard({ label, value, sub, tone, href, className, dense }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad"; href?: string; className?: string; dense?: boolean }) {
  const body = (
    <Card className={cn(dense ? "gap-0.5 p-3" : "gap-1 p-4", href && "transition-shadow hover:shadow-[0_2px_8px_rgba(60,66,87,0.12)]", className)}>
      <div className={cn("font-medium text-muted-foreground", dense ? "truncate text-[11px]" : "text-xs")}>{label}</div>
      <div className={cn("font-semibold tabular-nums leading-tight tracking-tight", dense ? "text-lg" : "text-2xl", tone === "good" && "text-[#0e6245]", tone === "warn" && "text-[#983705]", tone === "bad" && "text-[#a41c4e]")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: {
  value: T | ""; onChange: (v: T) => void; options: { value: T; label: ReactNode; sub?: string }[]; className?: string; size?: "md" | "lg";
}) {
  return (
    <div className={cn("grid gap-2", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border px-2 text-center text-sm font-medium transition-colors active:scale-[0.98]",
            size === "lg" ? "min-h-14 py-2" : "min-h-10 py-1.5",
            value === o.value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted",
          )}
        >
          <div>{o.label}</div>
          {o.sub && <div className={cn("text-[10px] font-normal", value === o.value ? "text-primary-foreground/80" : "text-muted-foreground")}>{o.sub}</div>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, tone }: { value: number | null; tone?: "auto" | "primary" }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = tone === "primary" ? "bg-primary" : v >= 100 ? "bg-emerald-500" : v >= 60 ? "bg-primary" : v >= 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function AchievementCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-24 items-center gap-2">
      <div className="w-14"><Progress value={pct} /></div>
      <span className="text-xs tabular-nums">{pct1(pct)}</span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2Icon className={cn("size-4 animate-spin", className)} />;
}

/** Grey placeholder shapes while data arrives — the page keeps its shape instead of jumping. */
export function PageLoading() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading">
      <div className="mb-5 h-7 w-48 rounded-md bg-muted-foreground/15" />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-muted-foreground/10" />)}</div>
      <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-xl bg-muted-foreground/10" />)}</div>
    </div>
  );
}

/** A small “i” that explains a term in plain words when tapped or hovered. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button type="button" aria-label="What does this mean?" aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} className="rounded-full text-muted-foreground/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><InfoIcon className="size-3.5" /></button>
      {open && <span role="tooltip" className="absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 rounded-lg border bg-popover p-2.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-popover-foreground shadow-lg">{children}</span>}
    </span>
  );
}

/** A friendly “what is this page?” note. Closes for good once dismissed (remembered on this device). */
export function Tip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const key = `tip-${id}`;
  const [shown, setShown] = useState(() => { try { return typeof window === "undefined" || localStorage.getItem(key) !== "1"; } catch { return true; } });
  if (!shown) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
      <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1"><div className="font-medium">{title}</div><div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div></div>
      <button type="button" aria-label="Got it, hide this tip" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* storage blocked */ } setShown(false); }} className="rounded p-1 text-muted-foreground hover:bg-primary/10"><XIcon className="size-4" /></button>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted-foreground">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="font-medium">Something went wrong</div>
      <div className="mt-1 break-words">{message}</div>
      {onRetry && <button onClick={onRetry} className="mt-2 text-xs font-medium underline">Try again</button>}
    </div>
  );
}

/** Horizontal bar list: label · bar · value. Lightweight replacement for a chart library. */
export function BarList({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="grid gap-2">
      {rows.length === 0 && <div className="text-xs text-muted-foreground">No data for this period</div>}
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs">
          <div className="truncate" title={r.label}>{r.label}</div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="tabular-nums text-muted-foreground">{format ? format(r.value) : r.value}{r.sub ? ` · ${r.sub}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

/** Tiny column chart (SVG). `points` are in chronological order. */
export function MiniColumns({ points, format }: { points: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / Math.max(points.length, 1);
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full">
        {points.map((p, i) => {
          const h = (p.value / max) * 36;
          return (
            <rect key={p.label} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={Math.max(h, p.value > 0 ? 0.8 : 0)} rx="0.6" className="fill-primary/80">
              <title>{`${p.label}: ${format ? format(p.value) : p.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0]?.label}</span><span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function DataTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border bg-card shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]", className)}>
      <table className="w-full text-sm">
        <thead className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:hover]:bg-[#f9fbfd]">{children}</tbody>
      </table>
    </div>
  );
}
