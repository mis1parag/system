"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Spinner } from "@/components/common";
import { DataGrid, type Col } from "@/components/data-grid";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { fmtDT } from "@/lib/dates";
import { applyFilters, type FieldDef } from "@/lib/filters";
import { useFlows, useRequireCap } from "@/lib/flow-store";
import { MODULES } from "@/lib/permissions";

interface Row { timestamp: string; user: string; action: string; entity: string; recordId: string; oldValue: string; newValue: string; module: string; ip: string; device: string }

/** Who did what, and when. Search, filter, sort, choose columns, export — the same tools as everywhere else. */
export default function ActivityLogPage() {
  const ok = useRequireCap("viewAudit");
  const { call, userName, data, today } = useFlows();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [state, setState] = useFilters("audit:log", "all");

  // load once (the newest records); filtering happens on this screen
  useEffect(() => {
    if (!ok) return;
    let live = true;
    call<{ rows: Row[]; total: number }>("auditLog", {}).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.error || "Could not load"); return; }
      setErr(""); setRows(r.data!.rows); setTotal(r.data!.total);
    });
    return () => { live = false; };
  }, [ok, call]);

  const weekAgo = new Date(Date.parse(today + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
  const fields = useMemo<FieldDef<Row>[]>(() => [
    { key: "user", label: "Who", type: "user", options: (data?.users ?? []).map((u) => ({ value: u.userId, label: u.name })), get: (r) => r.user },
    { key: "module", label: "Module", type: "select", options: MODULES.map((m) => ({ value: m.id, label: m.label })), get: (r) => r.module },
    { key: "action", label: "Action", type: "text", get: (r) => r.action },
    { key: "entity", label: "Record type", type: "text", get: (r) => r.entity },
    { key: "recordId", label: "Record", type: "text", get: (r) => r.recordId },
    { key: "date", label: "Date", type: "date", get: (r) => r.timestamp.slice(0, 10) },
    { key: "ip", label: "IP", type: "text", get: (r) => r.ip },
  ], [data?.users]);
  const quickFns = useMemo<Record<string, (r: Row) => boolean>>(() => ({
    all: () => true,
    today: (r) => r.timestamp.slice(0, 10) === today,
    week: (r) => r.timestamp.slice(0, 10) >= weekAgo,
    logins: (r) => /^(Login|Logout)/.test(r.action),
    access: (r) => /(Access|Role|User created|User edited)/i.test(r.action),
    vault: (r) => r.module === "vault",
    exports: (r) => r.action === "Data export",
    deletes: (r) => /(removed|deleted|cancel)/i.test(r.action),
  }), [today, weekAgo]);
  const quick: QuickDef[] = [{ id: "all", label: "All" }, { id: "today", label: "Today" }, { id: "week", label: "This week" }, { id: "logins", label: "Sign-ins" }, { id: "access", label: "Access changes" }, { id: "vault", label: "Credentials" }, { id: "exports", label: "Exports" }, { id: "deletes", label: "Deletes" }];
  const shown = useMemo(() => applyFilters(rows ?? [], fields, state, { quick: quickFns, text: (r) => `${r.action} ${r.entity} ${r.recordId} ${userName(r.user)} ${r.newValue} ${r.oldValue} ${r.ip}` }), [rows, fields, state, quickFns, userName]);

  const cols: Col<Row>[] = [
    { id: "when", label: "When", render: (r) => <span className="whitespace-nowrap text-xs">{fmtDT(r.timestamp)}</span>, sort: (r) => r.timestamp },
    { id: "who", label: "Who", render: (r) => <span className="whitespace-nowrap">{userName(r.user)}</span>, sort: (r) => userName(r.user) },
    { id: "action", label: "Action", render: (r) => <span className="font-medium">{r.action}</span>, sort: (r) => r.action },
    { id: "module", label: "Module", render: (r) => <span className="text-xs text-muted-foreground">{MODULES.find((m) => m.id === r.module)?.label ?? ""}</span>, sort: (r) => r.module },
    { id: "record", label: "Record", render: (r) => <span className="text-xs text-muted-foreground">{r.entity}<br />{r.recordId}</span>, sort: (r) => r.recordId, csv: (r) => `${r.entity} ${r.recordId}` },
    { id: "details", label: "Details", render: (r) => <span className="block max-w-md truncate text-xs text-muted-foreground" title={`${r.oldValue} → ${r.newValue}`}>{r.newValue || r.oldValue}</span>, csv: (r) => `${r.oldValue} → ${r.newValue}` },
    { id: "ip", label: "IP", hidden: true, render: (r) => <span className="text-xs">{r.ip}</span>, sort: (r) => r.ip },
    { id: "device", label: "Device", hidden: true, render: (r) => <span className="text-xs">{r.device}</span>, sort: (r) => r.device },
  ];
  if (!ok) return null;

  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change: who did what, and when. Newest first." />
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}
      {!rows && !err && <div className="flex justify-center py-10"><Spinner /></div>}
      {rows && (
        <>
          <FilterBar page="audit:log" module="audit" fields={fields} quick={quick} state={state} onChange={setState} shown={shown.length} total={rows.length} placeholder="Search action, person, record…" />
          <DataGrid id="audit" columns={cols} rows={shown} rowKey={(r) => `${r.timestamp}|${r.user}|${r.action}|${r.recordId}`} exportAs={{ name: "activity-log", module: "audit" }} empty={<EmptyState title="No matching records" hint="Change or clear the filters." />} />
          <p className="mt-2 text-xs text-muted-foreground">{total} records in the log for you; the newest are loaded.</p>
        </>
      )}
    </>
  );
}
