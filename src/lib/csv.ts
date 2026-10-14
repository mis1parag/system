/** Minimal RFC-4180-ish CSV/TSV parser (handles quotes, commas, tabs, CRLF). Pasting from Excel gives tab-separated text. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const first = t.split("\n", 1)[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Turn rows into records using header aliases: { key: ["alias1", "alias2"] }. Unknown columns are ignored. */
export function toRecords(rows: string[][], aliases: Record<string, string[]>): { records: Record<string, string>[]; unknown: string[]; missing: string[] } {
  if (rows.length < 2) return { records: [], unknown: [], missing: Object.keys(aliases) };
  const header = rows[0].map(norm);
  const colFor = new Map<string, number>();
  for (const [key, names] of Object.entries(aliases)) {
    const idx = header.findIndex((h) => h === norm(key) || names.map(norm).includes(h));
    if (idx >= 0) colFor.set(key, idx);
  }
  const used = new Set(colFor.values());
  const unknown = rows[0].filter((_, i) => !used.has(i)).filter(Boolean);
  const records = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    colFor.forEach((idx, key) => { o[key] = (r[idx] ?? "").trim(); });
    return o;
  });
  return { records, unknown, missing: Object.keys(aliases).filter((k) => !colFor.has(k)) };
}
