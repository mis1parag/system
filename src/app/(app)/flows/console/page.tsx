"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, MegaphoneIcon, PencilIcon, PlusIcon, RotateCcwIcon, SearchIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBox, Field, PageHeader, Pill, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/filters";
import { useFlows } from "@/lib/flow-store";

/** Super Admin console: fix any record by hand (logged), bring back deleted rows, download a table, see data problems, post announcements. */
export default function ConsolePage() {
  const { isSuper } = useFlows();
  const [jump, setJump] = useState("");
  const [tab, setTab] = useState("editor");
  if (!isSuper) return <EmptyState title="Only the Super Admin" hint="This console changes records directly." />;
  return (
    <>
      <PageHeader title="Super Admin console" subtitle="Correct anything by hand, bring back what was deleted, check the data, tell everyone something. Every change is written to the activity log with the old and the new value." />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="mb-3 overflow-x-auto"><TabsList><TabsTrigger value="editor">Data editor</TabsTrigger><TabsTrigger value="checks">Data checks</TabsTrigger><TabsTrigger value="news">Announcements</TabsTrigger></TabsList></div>
        <TabsContent value="editor"><Editor key={jump} jump={jump} /></TabsContent>
        <TabsContent value="checks"><Checks onOpen={(t) => { setJump(t); setTab("editor"); }} /></TabsContent>
        <TabsContent value="news"><News /></TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------- data editor
interface Column { key: string; header: string; type: string; readonly: boolean }
interface Listing { table: string; label: string; hint: string; total: number; offset: number; softDelete: boolean; columns: Column[]; rows: Record<string, unknown>[] }
interface TableInfo { table: string; label: string; rows: number; hint: string; softDelete: boolean }

function Editor({ jump }: { jump: string }) {
  const { call, refresh } = useFlows();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState(jump || "Users");
  const [q, setQ] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [limit, setLimit] = useState(100);

  useEffect(() => { call<{ tables: TableInfo[] }>("adminTables", {}).then((r) => r.ok && setTables(r.data!.tables)); }, [call]);

  const load = useCallback(async () => {
    const r = await call<Listing>("adminRows", { table, q, deleted, limit });
    if (r.ok) { setList(r.data!); setError(""); } else setError(r.error || "Could not load");
  }, [call, table, q, deleted, limit]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const idKey = list?.columns[0]?.key ?? "";
  const info = tables.find((t) => t.table === table);
  const shownCols = list?.columns.filter((c) => c.key !== "deleted").slice(0, 7) ?? [];

  async function download() {
    const r = await call<Listing>("adminExport", { table, q, deleted });
    if (!r.ok) { toast.error(r.error || "Could not download"); return; }
    downloadCsv(`${table}.csv`, toCsv(r.data!.columns.map((c) => c.header), r.data!.rows.map((row) => r.data!.columns.map((c) => row[c.key] as string | number | null))));
    toast.success(`${r.data!.rows.length} rows downloaded (written to the activity log)`);
  }
  async function restore(row: Record<string, unknown>, del: boolean) {
    const r = await call("adminSetDeleted", { table, id: String(row[idKey]), deleted: del });
    if (!r.ok) toast.error(r.error || "Failed"); else { toast.success(del ? "Hidden" : "Restored"); load(); refresh(); }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={table} onChange={(e) => { setTable(e.target.value); setQ(""); setLimit(100); }} className="w-56" aria-label="Table">
          {tables.map((t) => <option key={t.table} value={t.table}>{t.label} ({t.rows})</option>)}
        </NativeSelect>
        <div className="relative min-w-52 max-w-sm flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any value or ID…" aria-label="Search" /></div>
        {list?.softDelete && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={deleted} onChange={(e) => setDeleted(e.target.checked)} /> Show deleted</label>}
        <Button variant="outline" className="ml-auto" onClick={download}><DownloadIcon /> Download CSV</Button>
      </div>
      {info?.hint && <p className="flex items-start gap-1.5 rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground"><ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {info.hint}</p>}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!list && !error && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Loading…</p>}
      {list && (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground"><tr>{shownCols.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.header.split("(")[0]}</th>)}<th /></tr></thead>
              <tbody className="[&_td]:px-3 [&_td]:py-2 [&_tr]:border-t">
                {list.rows.map((r) => {
                  const gone = r.deleted === "Y";
                  return (
                    <tr key={String(r[idKey])} className={gone ? "opacity-50" : "hover:bg-[#f9fbfd]"}>
                      {shownCols.map((c) => <td key={c.key} className="max-w-56 truncate" title={String(r[c.key] ?? "")}>{String(r[c.key] ?? "") || <span className="text-muted-foreground">—</span>}</td>)}
                      <td className="whitespace-nowrap text-right">
                        {gone ? <Button size="sm" variant="outline" onClick={() => restore(r, false)}><RotateCcwIcon /> Restore</Button> : <>
                          <Button size="icon-sm" variant="ghost" onClick={() => setEdit(r)} aria-label="Edit this record"><PencilIcon /></Button>
                          {list.softDelete && table !== "Users" && <Button size="icon-sm" variant="ghost" className="text-red-700" onClick={() => restore(r, true)} aria-label="Hide this record"><Trash2Icon /></Button>}
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!list.rows.length && <p className="p-6 text-center text-sm text-muted-foreground">Nothing found.</p>}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{list.rows.length} of {list.total} shown (newest first)</span>
            {list.rows.length < list.total && <Button size="sm" variant="outline" onClick={() => setLimit(limit + 100)}>Show 100 more</Button>}
          </div>
        </>
      )}
      {edit && list && <RowDialog table={table} label={list.label} columns={list.columns} row={edit} onClose={(saved) => { setEdit(null); if (saved) { load(); refresh(); } }} />}
    </div>
  );
}

function RowDialog({ table, label, columns, row, onClose }: { table: string; label: string; columns: Column[]; row: Record<string, unknown>; onClose: (saved?: boolean) => void }) {
  const { call } = useFlows();
  const idKey = columns[0].key;
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(columns.map((c) => [c.key, row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key])])));
  const [busy, setBusy] = useState(false);
  const changed = columns.filter((c) => !c.readonly && v[c.key] !== (row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key])));
  async function save() {
    setBusy(true);
    const r = await call<{ effects: string[]; hint: string }>("adminEditRow", { table, id: String(row[idKey]), changes: Object.fromEntries(changed.map((c) => [c.key, v[c.key]])) });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success(`Saved — ${changed.length} field${changed.length === 1 ? "" : "s"} changed`);
    r.data?.effects?.forEach((e) => toast.message(e));
    onClose(true);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{label} · {String(row[idKey])}</DialogTitle><DialogDescription>Only the fields you change are saved, and the old values stay in the activity log.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {columns.filter((c) => c.key !== "deleted").map((c) => {
            const long = (v[c.key]?.length ?? 0) > 60 || /json|note|reason|text|remarks|body|message/i.test(c.key);
            return (
              <Field key={c.key} label={c.header} className={long ? "sm:col-span-2" : ""}>
                {long ? <Textarea rows={2} value={v[c.key]} disabled={c.readonly} onChange={(e) => setV({ ...v, [c.key]: e.target.value })} /> : <Input value={v[c.key]} disabled={c.readonly} inputMode={c.type !== "s" ? "decimal" : undefined} onChange={(e) => setV({ ...v, [c.key]: e.target.value })} />}
              </Field>
            );
          })}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || !changed.length}>{busy && <Spinner />} Save {changed.length ? `(${changed.length})` : ""}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- data checks
interface Check { id: string; level: "bad" | "warn" | "info"; title: string; count: number; examples: string[]; fix: string; table?: string }
function Checks({ onOpen }: { onOpen: (table: string) => void }) {
  const { call } = useFlows();
  const [res, setRes] = useState<{ checks: Check[]; checkedAt: string; people: number } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setRes(null); const r = await call<NonNullable<typeof res>>("adminChecks", {}); if (r.ok) setRes(r.data!); else setError(r.error || "Could not check"); }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!res) return <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Checking…</p>;
  const tone = { bad: "red", warn: "amber", info: "blue" } as const;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Checked {res.people} people and all their records at {res.checkedAt.slice(11, 16)}.</span><Button size="sm" variant="outline" onClick={load}>Check again</Button></div>
      {res.checks.length === 0 && <EmptyState title="Everything looks fine" hint="No orphaned work, duplicate IDs or stuck requests were found." />}
      {res.checks.map((c) => (
        <div key={c.id} className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={tone[c.level]}>{c.count}</Pill><span className="font-medium">{c.title}</span>{c.table && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(c.table!)}>Open in editor</Button>}</div>
          {c.examples.length > 0 && <p className="mt-1 text-xs text-muted-foreground">e.g. {c.examples.join(", ")}</p>}
          <p className="mt-1 text-xs">{c.fix}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- announcements
interface Ann { annId: string; title: string; body: string; audience: string; tone: string; startDate: string; endDate: string; createdAt: string }
function News() {
  const { call, data } = useFlows();
  const [rows, setRows] = useState<Ann[] | null>(null);
  const [edit, setEdit] = useState<Ann | "new" | null>(null);
  const load = useCallback(async () => { const r = await call<{ announcements: Ann[] }>("listAnnouncements", { manage: true }); if (r.ok) setRows(r.data!.announcements); }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  async function remove(a: Ann) {
    if (!window.confirm(`Remove “${a.title}”?`)) return;
    const r = await call("deleteAnnouncement", { annId: a.annId });
    if (!r.ok) toast.error(r.error || "Could not remove"); else { toast.success("Removed"); load(); }
  }
  const who = (a: string) => (a === "all" ? "Everyone" : a.startsWith("dept:") ? `Department ${a.slice(5)}` : `${a.slice(6).split(",").length} people`);
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">A notice appears on everyone&apos;s Home page and in their bell.</p><Button onClick={() => setEdit("new")}><PlusIcon /> New announcement</Button></div>
      {!rows && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Loading…</p>}
      {rows && !rows.length && <EmptyState title="No announcements yet" hint="Post holiday notices, new rules, a change of timing…" />}
      {rows?.map((a) => (
        <div key={a.annId} className="flex items-start gap-3 rounded-lg border bg-card p-3">
          <MegaphoneIcon className={`mt-0.5 size-4 shrink-0 ${a.tone === "important" ? "text-red-600" : "text-primary"}`} />
          <div className="min-w-0 flex-1"><div className="font-medium">{a.title} {a.tone === "important" && <Pill tone="red">Important</Pill>}</div><p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p><p className="mt-1 text-xs text-muted-foreground">{who(a.audience)}{a.startDate ? ` · from ${fmtDate(a.startDate, true)}` : ""}{a.endDate ? ` · until ${fmtDate(a.endDate, true)}` : ""}</p></div>
          <Button size="icon-sm" variant="ghost" onClick={() => setEdit(a)} aria-label="Edit"><PencilIcon /></Button><Button size="icon-sm" variant="ghost" className="text-red-700" onClick={() => remove(a)} aria-label="Remove"><Trash2Icon /></Button>
        </div>
      ))}
      {edit && <AnnDialog ann={edit === "new" ? undefined : edit} departments={data?.departments ?? []} onClose={(saved) => { setEdit(null); if (saved) load(); }} />}
    </div>
  );
}

function AnnDialog({ ann, departments, onClose }: { ann?: Ann; departments: string[]; onClose: (saved?: boolean) => void }) {
  const { call, data } = useFlows();
  const [title, setTitle] = useState(ann?.title ?? "");
  const [body, setBody] = useState(ann?.body ?? "");
  const [kind, setKind] = useState(ann?.audience.startsWith("dept:") ? "dept" : ann?.audience.startsWith("users:") ? "users" : "all");
  const [dept, setDept] = useState(ann?.audience.startsWith("dept:") ? ann.audience.slice(5) : departments[0] ?? "");
  const [people, setPeople] = useState<Set<string>>(new Set(ann?.audience.startsWith("users:") ? ann.audience.slice(6).split(",") : []));
  const [tone, setTone] = useState(ann?.tone ?? "info");
  const [start, setStart] = useState(ann?.startDate ?? "");
  const [end, setEnd] = useState(ann?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const audience = kind === "all" ? "all" : kind === "dept" ? `dept:${dept}` : `users:${[...people].join(",")}`;
  async function save() {
    setBusy(true);
    const r = await call("saveAnnouncement", { annId: ann?.annId, title, body, audience, tone, startDate: start, endDate: end });
    setBusy(false);
    if (!r.ok) toast.error(r.error || "Could not save"); else { toast.success(ann ? "Saved" : "Posted — people are notified"); onClose(true); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ann ? "Edit announcement" : "New announcement"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Title"><Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Office closed on Friday" /></Field>
          <Field label="Message"><Textarea rows={4} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who reads it"><NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">Everyone</option><option value="dept">One department</option><option value="users">Chosen people</option></NativeSelect></Field>
            <Field label="Kind"><NativeSelect value={tone} onChange={(e) => setTone(e.target.value)}><option value="info">Information</option><option value="important">Important</option></NativeSelect></Field>
          </div>
          {kind === "dept" && <Field label="Department"><NativeSelect value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map((d) => <option key={d}>{d}</option>)}</NativeSelect></Field>}
          {kind === "users" && <div className="max-h-40 overflow-y-auto rounded-md border p-1.5">{(data?.users ?? []).filter((u) => u.status === "Active").map((u) => <label key={u.userId} className="flex items-center gap-2 px-1.5 py-1 text-sm"><input type="checkbox" checked={people.has(u.userId)} onChange={() => setPeople((cur) => { const n = new Set(cur); if (n.has(u.userId)) n.delete(u.userId); else n.add(u.userId); return n; })} />{u.name}</label>)}</div>}
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Show from (optional)"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Show until (optional)"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || !title.trim()}>{busy && <Spinner />} {ann ? "Save" : "Post"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
