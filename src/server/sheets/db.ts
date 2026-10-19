/**
 * Table layer over the Sheets API: cached reads, and a small unit-of-work ("Tx") for writes.
 *
 * Safety rules (Google Sheets has no transactions):
 *  - rows are never deleted or re-ordered by this code (soft delete instead), so a row number stays valid;
 *  - before updating existing rows we re-read the id column and refuse to write if a row moved (someone edited the sheet by hand);
 *  - ids are time-based + random, so two people creating entries at the same moment cannot collide;
 *  - state guards (e.g. "only if the step is still not done") re-read the row just before writing.
 */
import { colLetter, quoteTab, type Cell, type SheetsClient } from "./client.ts";
import { DEFAULT_SETTINGS, TABLES, TABLE_ORDER, type TableDef } from "./schema.ts";

export type Rec = { [k: string]: string | number | null | undefined; _row?: number };

export class MidapError extends Error {
  code: string;
  extra: unknown;
  constructor(code: string, message: string, extra?: unknown) {
    super(message);
    this.code = code;
    this.extra = extra ?? null;
  }
}
export const fail = (code: string, message: string, extra?: unknown): never => { throw new MidapError(code, message, extra); };
/** Like require_, for permission checks: the answer is "access denied" (FORBIDDEN), not "invalid input". */
export function forbid(cond: unknown, message: string): asserts cond {
  if (!cond) throw new MidapError("FORBIDDEN", message);
}
export function require_(cond: unknown, message: string, extra?: unknown): asserts cond {
  if (!cond) throw new MidapError("VALIDATION", message, extra);
}

let idCounter = 0;
/** Short, sortable, collision-safe id: PREFIX-<time base36><counter><random>, e.g. FIT-1K3J9A2X4Q */
export function newId(prefix: string): string {
  const t = (Date.now() - 1735689600000).toString(36).toUpperCase().padStart(7, "0");
  const c = (idCounter++ % 36).toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `${prefix}-${t}${c}${r}`;
}

const lastCol = (def: TableDef) => colLetter(def.cols.length);

export function parseRows(def: TableDef, values: Cell[][]): Rec[] {
  const out: Rec[] = [];
  values.forEach((row, i) => {
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) return;
    out.push(parseRow(def, row, i + 2));
  });
  return out;
}
export function parseRow(def: TableDef, row: Cell[], rowNo: number): Rec {
  const rec: Rec = { _row: rowNo };
  def.cols.forEach(([key, , type], j) => {
    const v = row[j];
    if (type === "n") { const n = Number(v); rec[key] = v === "" || v === undefined || v === null || isNaN(n) ? 0 : n; }
    else if (type === "nn") { const n = Number(v); rec[key] = v === "" || v === undefined || v === null || isNaN(n) ? null : n; }
    else rec[key] = v === undefined || v === null ? "" : String(v);
  });
  return rec;
}
export const toRow = (def: TableDef, rec: Rec): Cell[] => def.cols.map(([key]) => { const v = rec[key]; return v === undefined || v === null ? "" : v; });

const SENSITIVE: Record<string, string[]> = { Users: ["pinHash", "failCount", "lockedUntil", "permsJson"], Vault_Items: ["secretEnc"] };
/** Record as sent to the browser (no row number, no secrets). */
export function pub(name: string, rec: Rec): Record<string, unknown> {
  const def = TABLES[name];
  const hide = SENSITIVE[name] ?? [];
  const o: Record<string, unknown> = {};
  for (const [key, , type] of def.cols) if (!hide.includes(key)) o[key] = rec[key] ?? (type === "nn" ? null : "");
  return o;
}

export interface CommitResult {
  changes: Record<string, Record<string, unknown>[]>;
  removed: Record<string, string[]>;
}

export class Db {
  client: SheetsClient;
  ttlMs: number;
  private cache = new Map<string, { at: number; rows: Rec[] }>();

  constructor(client: SheetsClient, opts: { ttlMs?: number } = {}) {
    this.client = client;
    this.ttlMs = opts.ttlMs ?? 4000;
  }

  /** Create missing tabs, write headers and default settings. Safe to run repeatedly. */
  async ensureSchema(): Promise<{ created: string[] }> {
    const tabs = await this.client.listTabs();
    const have = new Map(tabs.map((t) => [t.title, t.sheetId]));
    const missing = TABLE_ORDER.filter((n) => !have.has(n));
    await this.client.addTabs(missing);
    const after = missing.length ? await this.client.listTabs() : tabs;
    const ids = new Map(after.map((t) => [t.title, t.sheetId]));
    await this.client.batchUpdate(TABLE_ORDER.map((n) => ({ range: `${quoteTab(n)}!A1:${lastCol(TABLES[n])}1`, values: [TABLES[n].cols.map((c) => c[1])] })));
    for (const n of missing) await this.client.styleHeader(ids.get(n)!, TABLES[n].cols.length);
    this.invalidate();
    const tx = this.begin("system");
    const settings = await tx.rows("Settings");
    for (const [key, value, description] of DEFAULT_SETTINGS) {
      if (!settings.some((s) => s.key === key)) tx.insert("Settings", { key, value, description, group: "General" });
    }
    await tx.commit();
    return { created: missing };
  }

  private schemaChecked = false;
  /** Once per process: if tabs were added in a newer version of the app, create them (an already set-up Sheet keeps working). */
  async ensureReadyOnce(): Promise<void> {
    if (this.schemaChecked) return;
    const tabs = await this.client.listTabs();
    if (!tabs.some((t) => t.title === "Users")) return; // first-time setup has not happened yet
    if (TABLE_ORDER.some((n) => !tabs.some((t) => t.title === n))) await this.ensureSchema();
    else await this.client.batchUpdate(TABLE_ORDER.map((n) => ({ range: `${quoteTab(n)}!A1:${lastCol(TABLES[n])}1`, values: [TABLES[n].cols.map((c) => c[1])] }))); // picks up columns added by a newer version
    this.schemaChecked = true;
  }

  invalidate(names?: string[]) {
    if (!names) this.cache.clear();
    else names.forEach((n) => this.cache.delete(n));
  }

  /** Read tables (cached for a few seconds; all stale ones in a single API call). Returned arrays are shared — do not mutate. */
  async load(names: string[], opts: { fresh?: boolean } = {}): Promise<Record<string, Rec[]>> {
    const now = Date.now();
    const stale = [...new Set(names)].filter((n) => opts.fresh || !this.cache.has(n) || now - this.cache.get(n)!.at > this.ttlMs);
    if (stale.length) {
      const got = await this.client.batchGet(stale.map((n) => `${quoteTab(n)}!A2:${lastCol(TABLES[n])}`));
      stale.forEach((n, i) => this.cache.set(n, { at: Date.now(), rows: parseRows(TABLES[n], got[i]) }));
    }
    return Object.fromEntries(names.map((n) => [n, this.cache.get(n)!.rows]));
  }

  begin(actorId: string): Tx { return new Tx(this, actorId); }
}

/** which module an audit entry belongs to (for the activity-log filter) */
const MODULE_OF_ENTITY: Record<string, string> = { Flows: "fms", Flow_Items: "fms", Flow_Tasks: "fms", Requests: "fms", Comments: "fms", Checklist_Tasks: "checklist", Checklist_Log: "checklist", Attendance: "attendance", Leaves: "attendance", Absences: "attendance", Holidays: "attendance", Leave_Policy: "attendance", Leave_Adjust: "attendance", Salary_Slips: "payroll", Slip_Requests: "payroll", Salary_Structure: "payroll", Pay_Waivers: "payroll", Reminders: "reminders", Announcements: "settings", Users: "employees", Employee_Details: "employees", Profile_Photos: "employees", Roles: "employees", Settings: "settings", Vault_Items: "vault", Vault_Access: "vault", Quick_Links: "quick_access", Saved_Filters: "" };

interface Work { rows: Rec[]; orig: Map<Rec, string>; inserted: Rec[]; loaded: boolean }

export class Tx {
  db: Db;
  actorId: string;
  stamp = "";
  /** who is calling (set by the server for every request): written into the audit log */
  meta: { ip?: string; device?: string } = {};
  private work = new Map<string, Work>();
  private audits: Rec[] = [];

  constructor(db: Db, actorId: string) { this.db = db; this.actorId = actorId; }

  private attach(n: string, data: Rec[]) {
    const orig = new Map<Rec, string>();
    const rows = data.map((r) => { const c = { ...r }; orig.set(c, JSON.stringify(toRow(TABLES[n], c))); return c; });
    const w = this.work.get(n);
    if (w) { w.rows = [...rows, ...w.inserted]; w.orig = orig; w.loaded = true; } // keep rows inserted before the table was read
    else this.work.set(n, { rows, orig, inserted: [], loaded: true });
  }

  /** Load several tables in one API call. */
  async load(...names: string[]): Promise<void> {
    const need = names.filter((n) => !this.work.get(n)?.loaded);
    if (!need.length) return;
    const data = await this.db.load(need);
    for (const n of need) this.attach(n, data[n]);
  }

  /** Working copies (mutate freely; changes are detected and written on commit). Includes rows inserted in this Tx. */
  async rows(name: string): Promise<Rec[]> {
    await this.load(name);
    return this.work.get(name)!.rows;
  }

  /** Add a row. The table does not need to be loaded (cheap for logs / notifications). */
  insert(name: string, rec: Rec): Rec {
    let w = this.work.get(name);
    if (!w) { w = { rows: [], orig: new Map(), inserted: [], loaded: false }; this.work.set(name, w); }
    w.rows.push(rec);
    w.inserted.push(rec);
    return rec;
  }

  audit(action: string, entity: string, recordId: string, oldV?: unknown, newV?: unknown) {
    const clip = (v: unknown) => { if (v === undefined || v === null) return ""; const s = JSON.stringify(v); return s.length > 2000 ? s.slice(0, 1997) + "..." : s; };
    this.audits.push({ timestamp: this.stamp, user: this.actorId, action, entity, recordId, oldValue: clip(oldV), newValue: clip(newV), module: MODULE_OF_ENTITY[entity] ?? (["fms", "checklist", "attendance", "scorecard", "quick_access", "vault", "employees", "reports", "settings", "audit", "payroll", "reminders"].includes(entity) ? entity : ""), ip: this.meta.ip ?? "", device: this.meta.device ?? "" });
  }

  /** The row as it is in the sheet right now (bypasses the cache). */
  async freshRow(name: string, rec: Rec): Promise<Rec | null> {
    const def = TABLES[name];
    if (!rec._row) return null;
    const [vals] = await this.db.client.batchGet([`${quoteTab(name)}!A${rec._row}:${lastCol(def)}${rec._row}`]);
    const row = vals[0];
    if (!row) return null;
    const r = parseRow(def, row, rec._row);
    return def.idKey && r[def.idKey] !== rec[def.idKey] ? null : r;
  }

  async commit(): Promise<CommitResult> {
    const client = this.db.client;
    const touched = new Set<string>();
    const dirty: { name: string; rec: Rec }[] = [];
    for (const [name, w] of this.work) {
      const ins = new Set(w.inserted);
      for (const rec of w.rows) {
        if (ins.has(rec)) continue;
        if (w.orig.get(rec) !== JSON.stringify(toRow(TABLES[name], rec))) dirty.push({ name, rec });
      }
      if (w.inserted.length) touched.add(name);
    }
    dirty.forEach((d) => touched.add(d.name));

    // 1. row positions must still hold the records we read (nobody inserted / deleted / sorted rows by hand meanwhile)
    const byTable = new Map<string, Rec[]>();
    dirty.forEach((d) => (byTable.get(d.name) ?? byTable.set(d.name, []).get(d.name)!).push(d.rec));
    if (byTable.size) {
      const names = [...byTable.keys()];
      const idCols = await client.batchGet(names.map((n) => `${quoteTab(n)}!A2:A${Math.max(...byTable.get(n)!.map((r) => r._row!))}`));
      names.forEach((n, i) => {
        const idKey = TABLES[n].idKey!;
        for (const rec of byTable.get(n)!) {
          const there = idCols[i][rec._row! - 2]?.[0];
          if (String(there ?? "") !== String(rec[idKey])) {
            this.db.invalidate(names);
            throw new MidapError("CONFLICT", "The sheet changed while you were working (a row moved or was edited by hand). Refresh and try again.");
          }
        }
      });
    }

    // 2. updates, 3. inserts, 4. audit
    await client.batchUpdate(dirty.map((d) => ({ range: `${quoteTab(d.name)}!A${d.rec._row}:${lastCol(TABLES[d.name])}${d.rec._row}`, values: [toRow(TABLES[d.name], d.rec)] })));
    const inserts = [...this.work].filter(([, w]) => w.inserted.length);
    await Promise.all(inserts.map(async ([name, w]) => {
      const first = await client.append(`${quoteTab(name)}!A:${lastCol(TABLES[name])}`, w.inserted.map((r) => toRow(TABLES[name], r)));
      w.inserted.forEach((r, i) => { r._row = first + i; });
    }));
    if (this.audits.length) await client.append(`${quoteTab("Audit_Log")}!A:${lastCol(TABLES.Audit_Log)}`, this.audits.map((a) => toRow(TABLES.Audit_Log, a)));

    this.db.invalidate([...touched]);

    const result: CommitResult = { changes: {}, removed: {} };
    for (const name of touched) {
      const def = TABLES[name];
      const w = this.work.get(name)!;
      const recs = [...dirty.filter((d) => d.name === name).map((d) => d.rec), ...w.inserted];
      for (const rec of recs) {
        if (def.softDelete && rec.deleted === "Y") (result.removed[name] ??= []).push(String(rec[def.idKey!]));
        else (result.changes[name] ??= []).push(pub(name, rec));
      }
    }
    return result;
  }
}
