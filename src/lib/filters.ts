// One filter model for every list in the app: a search box, one "quick filter", and any number of conditions (field · operator · value), all joined by AND.
export type FieldType = "text" | "select" | "date" | "user" | "tags";
export type Op = "is" | "isnot" | "contains" | "notcontains" | "before" | "after" | "between" | "empty" | "notempty";

export interface FieldDef<T> {
  key: string; label: string; type: FieldType;
  /** choices for select fields */ options?: { value: string; label: string }[];
  /** the value(s) of this field in a row (a date as yyyy-MM-dd; a person as a user id) */ get: (row: T) => string | string[] | null | undefined;
}
export interface Condition { id: string; field: string; op: Op; value: string; value2?: string }
export interface FilterState { q: string; quick: string; conds: Condition[] }
export const EMPTY_FILTER = (quick = "all"): FilterState => ({ q: "", quick, conds: [] });

export const OPS: Record<FieldType, Op[]> = {
  text: ["contains", "notcontains", "is", "isnot", "empty", "notempty"],
  select: ["is", "isnot", "empty", "notempty"],
  user: ["is", "isnot", "empty", "notempty"],
  tags: ["contains", "notcontains", "empty", "notempty"],
  date: ["is", "before", "after", "between", "empty", "notempty"],
};
export const OP_LABEL: Record<Op, string> = { is: "is", isnot: "is not", contains: "contains", notcontains: "does not contain", before: "is before", after: "is after", between: "is between", empty: "is empty", notempty: "is not empty" };
export const needsValue = (op: Op) => op !== "empty" && op !== "notempty";

const vals = (v: string | string[] | null | undefined): string[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [String(v)]).map((x) => String(x));

/** Does one condition hold for a row? A condition without a value is ignored (so half-typed filters do not hide everything). */
export function matches<T>(row: T, f: FieldDef<T>, c: Condition): boolean {
  const have = vals(f.get(row));
  if (c.op === "empty") return have.length === 0;
  if (c.op === "notempty") return have.length > 0;
  if (!c.value) return true;
  const want = c.value.toLowerCase();
  const lower = have.map((x) => x.toLowerCase());
  switch (c.op) {
    case "is": return lower.some((x) => x === want);
    case "isnot": return !lower.some((x) => x === want);
    case "contains": return lower.some((x) => x.includes(want));
    case "notcontains": return !lower.some((x) => x.includes(want));
    case "before": return have.some((x) => x.slice(0, 10) < c.value);
    case "after": return have.some((x) => x.slice(0, 10) > c.value);
    case "between": return !c.value2 ? true : have.some((x) => x.slice(0, 10) >= c.value && x.slice(0, 10) <= c.value2!);
  }
  return true;
}

export function applyFilters<T>(rows: T[], fields: FieldDef<T>[], st: FilterState, opts: { quick?: Record<string, (row: T) => boolean>; text: (row: T) => string }): T[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const q = st.q.trim().toLowerCase();
  const quick = opts.quick?.[st.quick];
  const conds = st.conds.filter((c) => byKey.has(c.field));
  return rows.filter((r) => (!quick || quick(r)) && (!q || opts.text(r).toLowerCase().includes(q)) && conds.every((c) => matches(r, byKey.get(c.field)!, c)));
}

export const activeCount = (st: FilterState) => st.conds.filter((c) => !needsValue(c.op) || c.value).length;
export const newCond = <T,>(fields: FieldDef<T>[]): Condition => ({ id: Math.random().toString(36).slice(2, 8), field: fields[0]?.key ?? "", op: OPS[fields[0]?.type ?? "text"][0], value: "" });

/** The saved form of a filter (what is stored in the sheet). */
export const toParams = (st: FilterState) => ({ q: st.q, quick: st.quick, conds: st.conds.map(({ field, op, value, value2 }) => ({ field, op, value, value2 })) });
export function fromParams(json: string, fallbackQuick = "all"): FilterState {
  try {
    const p = JSON.parse(json || "{}") as Partial<{ q: string; quick: string; conds: Omit<Condition, "id">[] }>;
    return { q: String(p.q ?? ""), quick: String(p.quick ?? fallbackQuick), conds: (Array.isArray(p.conds) ? p.conds : []).map((c) => ({ id: Math.random().toString(36).slice(2, 8), field: String(c.field), op: c.op, value: String(c.value ?? ""), value2: c.value2 ? String(c.value2) : undefined })) };
  } catch { return EMPTY_FILTER(fallbackQuick); }
}

/** CSV with a UTF-8 marker so Excel opens it correctly. Every cell is quoted; cells starting with = + - @ are neutralised (spreadsheet formula injection). */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
export function downloadCsv(filename: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
