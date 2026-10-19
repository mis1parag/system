"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MailIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, ErrorBox, Pill, Spinner } from "@/components/common";
import { fmtMonth } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

interface MailRow { mailId: string; name: string; period: string; toEmail: string; status: "Pending" | "Sending" | "Sent" | "Failed" | "Cancelled"; attempts: number; maxAttempts: number; lastError: string; nextTry: string; createdAt: string; sentAt: string }
const TONE = { Pending: "amber", Sending: "blue", Sent: "green", Failed: "red", Cancelled: "gray" } as const;

/** Every salary-slip e-mail: waiting, sent, or failed (with the reason). Failed ones are tried again by themselves; Retry does it now. */
export function MailLog() {
  const { call, allow, isSuper } = useFlows();
  const [rows, setRows] = useState<MailRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canRetry = isSuper || allow("payroll", "approve");
  const load = useCallback(async () => {
    const r = await call<{ mails: MailRow[]; counts: Record<string, number> }>("listMailLog", status ? { status } : {});
    if (r.ok) { setRows(r.data!.mails); setCounts(r.data!.counts); setError(""); } else setError(r.error || "Could not load the e-mail log");
  }, [call, status]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  async function retry(ids: string[]) {
    setBusy(true);
    const r = await call("retryMails", { mailIds: ids });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not retry"); return; }
    for (const w of r.warnings ?? []) toast.message(w);
    void load();
  }
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!rows) return <Spinner />;
  const open = rows.filter((m) => m.status === "Failed" || m.status === "Pending");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <MailIcon className="size-4 text-muted-foreground" />
        {(["", "Pending", "Sent", "Failed", "Cancelled"] as const).map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-full border px-3 py-1 font-medium ${status === s ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-muted-foreground hover:bg-muted"}`}>{s || "All"}{s && counts[s] ? ` (${counts[s]})` : ""}</button>
        ))}
        <span className="flex-1" />
        {canRetry && open.length > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => retry(open.map((m) => m.mailId))}><RefreshCwIcon className="size-3.5" /> Retry {open.length} now</Button>}
      </div>
      <p className="text-xs text-muted-foreground">A slip is e-mailed once when it is published. A failed e-mail is tried again after 15 min, 1 h, 4 h, 12 h and 24 h; after {rows[0]?.maxAttempts ?? 5} tries it waits here for you to press Retry. Amounts are never kept in this log.</p>
      {rows.length === 0 ? <EmptyState title="No e-mails yet" hint="They appear here when a salary slip is published." /> : (
        <DataTable head={["Employee", "Month", "Sent to", "Status", "Tries", "When / reason", ""]}>
          {rows.map((m) => (
            <tr key={m.mailId} className="border-t align-top">
              <td className="px-3 py-2 font-medium">{m.name}</td>
              <td className="px-3 py-2">{m.period ? fmtMonth(m.period) : "—"}</td>
              <td className="px-3 py-2">{m.toEmail || "—"}</td>
              <td className="px-3 py-2"><Pill tone={TONE[m.status]}>{m.status}</Pill></td>
              <td className="px-3 py-2 tabular-nums">{m.attempts}</td>
              <td className="max-w-[320px] px-3 py-2 text-xs text-muted-foreground">{m.status === "Sent" ? `Sent ${m.sentAt.slice(0, 16)}` : m.lastError ? <span className="text-red-700">{m.lastError}</span> : `Queued ${m.createdAt.slice(0, 16)}`}{m.status === "Failed" && m.nextTry ? ` · next try ${m.nextTry}` : ""}</td>
              <td className="px-3 py-2 text-right">{canRetry && (m.status === "Failed" || m.status === "Pending") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => retry([m.mailId])}>Retry</Button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
