"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/common";
import { parseCsv, toRecords } from "@/lib/csv";
import type { Flow } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";

/** "05/11/2024 14:30", "5-11-2024", "2024-11-05T14:30" → "2024-11-05 14:30" (day first, as used in India). */
function toDT(v: string, dateOnly: boolean): string {
  const s = v.trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  let y: string, mo: string, d: string, h: string | undefined, mi: string | undefined;
  if (m) [, y, mo, d, h, mi] = m;
  else {
    m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
    if (!m) return s;
    [, d, mo, y, h, mi] = m;
    if (y.length === 2) y = "20" + y;
  }
  const p = (x: string) => x.padStart(2, "0");
  const date = `${y}-${p(mo)}-${p(d)}`;
  return dateOnly ? date : `${date}${h ? ` ${p(h)}:${mi}` : ""}`;
}

export function FlowImportDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const { call } = useFlows();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: { row: number; reason: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const aliases = useMemo(() => ({ ...Object.fromEntries(flow.fields.map((f) => [f.key, [f.label]])), __priority: ["Priority"], __tags: ["Tags"] }), [flow]);
  const parsed = useMemo(() => toRecords(parseCsv(text), aliases), [text, aliases]);
  const missingReq = text.trim() ? flow.fields.filter((f) => f.required && parsed.missing.includes(f.key)).map((f) => f.label) : [];

  async function run() {
    setBusy(true); setErr("");
    const rows = parsed.records.map((r) => ({
      data: Object.fromEntries(flow.fields.map((f) => [f.key, f.type === "date" || f.type === "datetime" ? toDT(r[f.key] ?? "", f.type === "date") : r[f.key] ?? ""])),
      priority: r.__priority || undefined, tags: r.__tags || undefined,
    }));
    let added = 0; const skipped: { row: number; reason: string }[] = [];
    for (let i = 0; i < rows.length; i += 150) {
      const res = await call<{ added: number; skipped: { row: number; reason: string }[] }>("importEntries", { flowId: flow.flowId, rows: rows.slice(i, i + 150) });
      if (!res.ok) { setErr(res.error || "Import failed"); setBusy(false); return; }
      added += res.data!.added;
      res.data!.skipped.forEach((s) => skipped.push({ row: i + s.row, reason: s.reason }));
    }
    setBusy(false);
    setResult({ added, skipped });
    toast.success(`${added} entries imported`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Import entries · {flow.name}</DialogTitle></DialogHeader>
        {!result ? (
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">Paste rows copied from Excel / Google Sheets with a header row, or choose a CSV file. Column names must match the field names: <b>{flow.fields.map((f) => f.label).join(", ")}</b> (optional: Priority, Tags). Dates can be dd/mm/yyyy. Planned times are calculated for every row.</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><UploadIcon /> Choose CSV file</Button>
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here…" className="font-mono text-xs" />
            {text.trim() && (
              <div className="rounded-lg bg-muted p-2 text-xs">
                <b>{parsed.records.length}</b> rows detected.{parsed.unknown.length > 0 && <> Ignored columns: {parsed.unknown.join(", ")}.</>}
                {missingReq.length > 0 && <span className="text-red-700"> Missing required column(s): {missingReq.join(", ")}.</span>}
              </div>
            )}
            {err && <p className="text-sm text-red-700">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <div>✅ {result.added} entries added, {result.skipped.length} skipped.</div>
            {result.skipped.length > 0 && <ul className="max-h-48 overflow-y-auto rounded-lg border p-2 text-xs">{result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{result ? "Done" : "Cancel"}</Button>
          {!result && <Button onClick={run} disabled={busy || !parsed.records.length || missingReq.length > 0}>{busy ? <Spinner /> : `Import ${parsed.records.length || ""} rows`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
