type Row = Record<string, unknown>;
const idOf = (row: Row, id: string | string[]) => (Array.isArray(id) ? id.map((k) => row[k]).join("|") : String(row[id]));

export type TableMap<B> = Record<string, { key: keyof B; id: string | string[] }>;

/** Apply the row deltas that every write returns (upsert by id) and removals to a data bundle. */
export function mergeTables<B extends object>(b: B, tables: TableMap<B>, changes?: Record<string, Row[]>, removed?: Record<string, string[]>): B {
  const next: B = { ...b };
  const bag = next as unknown as Record<string, Row[]>;
  for (const [sheet, rows] of Object.entries(changes ?? {})) {
    const t = tables[sheet];
    if (!t) continue;
    const list = [...(bag[t.key as string] ?? [])];
    const index = new Map(list.map((r, i) => [idOf(r, t.id), i]));
    for (const row of rows) {
      const key = idOf(row, t.id);
      const at = index.get(key);
      if (at === undefined) { index.set(key, list.length); list.push(row); } else list[at] = row;
    }
    bag[t.key as string] = list;
  }
  for (const [sheet, ids] of Object.entries(removed ?? {})) {
    const t = tables[sheet];
    if (!t || !ids.length) continue;
    const drop = new Set(ids);
    bag[t.key as string] = (bag[t.key as string] ?? []).filter((r) => !drop.has(idOf(r, t.id)));
  }
  return next;
}
