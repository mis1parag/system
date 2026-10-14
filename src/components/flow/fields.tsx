"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/common";
import { itemData } from "@/lib/flow";
import type { Flow, FlowField, FlowItem, Priority } from "@/lib/flow-types";
import { cn } from "@/lib/utils";

/** One input per field type. datetime-local uses "yyyy-MM-ddTHH:mm"; we store "yyyy-MM-dd HH:mm". Checkbox stores "Yes" or "". */
export function FieldInput({ field, value, onChange, suggestions, className }: { field: FlowField; value: string; onChange: (v: string) => void; suggestions?: string[]; className?: string }) {
  if (field.type === "select") {
    return (
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        <option value="">Select…</option>
        {(field.options ?? []).map((o) => <option key={o}>{o}</option>)}
        {value && !(field.options ?? []).includes(value) && <option>{value}</option>}
      </NativeSelect>
    );
  }
  if (field.type === "checkbox") {
    return (
      <label className="flex h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 rounded border-input" checked={value === "Yes"} onChange={(e) => onChange(e.target.checked ? "Yes" : "")} /> Yes
      </label>
    );
  }
  if (field.type === "textarea") return <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
  if (field.type === "date") return <Input type="date" className={cn("h-10", className)} value={value.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "datetime") return <Input type="datetime-local" className={cn("h-10", className)} value={value ? value.replace(" ", "T") : ""} onChange={(e) => onChange(e.target.value.replace("T", " "))} />;
  if (field.type === "number") return <Input inputMode="decimal" className={cn("h-10", className)} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.\-]/g, ""))} />;
  if (field.type === "phone") return <Input type="tel" inputMode="tel" className={cn("h-10", className)} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d+\-\s()]/g, ""))} />;
  if (field.type === "url") return <Input type="url" className={cn("h-10", className)} placeholder="https://" value={value} onChange={(e) => onChange(e.target.value)} />;
  const list = suggestions && suggestions.length ? `dl-${field.key}` : undefined;
  return (
    <>
      <Input className={cn("h-10", className)} list={list} value={value} onChange={(e) => onChange(e.target.value)} />
      {list && <datalist id={list}>{suggestions!.map((s) => <option key={s} value={s} />)}</datalist>}
    </>
  );
}

/** Distinct previous values of a text field → type-ahead suggestions (e.g. delivery locations). */
export function useSuggestions(flow: Flow, items: FlowItem[]) {
  return useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of flow.fields.filter((x) => x.type === "text")) {
      const c = new Map<string, number>();
      for (const it of items) { const v = String(itemData(it)[f.key] ?? "").trim(); if (v) c.set(v, (c.get(v) ?? 0) + 1); }
      out[f.key] = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => k);
    }
    return out;
  }, [flow, items]);
}

/** Read-only display of a stored value. */
export function FieldValue({ field, value }: { field: FlowField; value: string | number | undefined }) {
  const v = value === undefined || value === null ? "" : String(value);
  if (!v) return <>—</>;
  if (field.type === "url") return <a href={v} target="_blank" rel="noreferrer" className="break-all text-primary underline">{v.replace(/^https?:\/\//, "").slice(0, 40)}</a>;
  if (field.type === "phone") return <a href={`tel:${v}`} className="text-primary underline">{v}</a>;
  return <>{v}</>;
}

const PRIORITY_TONE: Record<Priority, "red" | "amber" | "gray" | "blue"> = { Urgent: "red", High: "amber", Normal: "gray", Low: "blue" };
export function PriorityPill({ priority }: { priority: Priority }) {
  if (priority === "Normal") return null;
  return <Pill tone={PRIORITY_TONE[priority]}>{priority}</Pill>;
}

export function TagChips({ tags }: { tags: string }) {
  const list = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!list.length) return null;
  return <>{list.map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">#{t}</span>)}</>;
}
