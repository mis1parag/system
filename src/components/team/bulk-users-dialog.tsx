"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

type Layout = "doer" | "full";
const LAYOUTS: Record<Layout, { label: string; cols: string[] }> = {
  doer: { label: "Name · Department · Email  (same as your Drive “Doer List”)", cols: ["name", "department", "email"] },
  full: { label: "Name · Department · Email · Mobile · Role (STAFF / ADMIN)", cols: ["name", "department", "email", "mobile", "role"] },
};
interface Result { created: number; updated: number; skipped: { row: number; name: string; reason: string }[]; credentials: { name: string; login: string; pin: string; role: string; department: string }[] }

/** Paste the team from a sheet. Everyone gets a random PIN, shown once; they sign in with their email (or mobile) and the PIN. */
export function BulkUsersDialog({ onClose }: { onClose: () => void }) {
  const { call, isSuper } = useFlows();
  const [layout, setLayout] = useState<Layout>("doer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);

  const rows = useMemo(() => {
    const cols = LAYOUTS[layout].cols;
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
      const cells = line.split(sep).map((c) => c.trim());
      return Object.fromEntries(cols.map((k, i) => [k, cells[i] ?? ""]));
    }).filter((r) => String(r.name).toLowerCase() !== "name");
  }, [text, layout]);

  async function save() {
    setBusy(true); setErr("");
    const r = await call<Result>("bulkSaveUsers", { rows });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not add"); return; }
    setRes(r.data!);
    toast.success(`${r.data!.created} added, ${r.data!.updated} updated`);
  }

  function download() {
    const csv = [["Name", "Department", "Role", "Sign in with", "PIN"], ...res!.credentials.map((c) => [c.name, c.department, c.role, c.login, c.pin])]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "team-sign-in-details.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add many people</DialogTitle></DialogHeader>
        {!res ? (
          <div className="grid gap-3">
            <Field label="Column order of what you paste"><NativeSelect value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>{(Object.keys(LAYOUTS) as Layout[]).map((k) => <option key={k} value={k}>{LAYOUTS[k].label}</option>)}</NativeSelect></Field>
            <Field label="Paste rows" hint="Copy the cells from Google Sheets / Excel and paste. People who already exist (same email or name) are updated, not duplicated. Everyone is added as Staff unless you use the Role column (Super Admin only).">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder={"Asha\tSales\tasha@example.com\nRavi\tAccounts\travi@example.com"} />
            </Field>
            <p className="text-xs text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"} read. People sign in with their <b>email</b> (or mobile) and a PIN — you get the PINs on the next screen.{!isSuper && layout === "full" ? " Only a Super Admin can create admins." : ""}</p>
            {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <p><b>{res.created}</b> added · <b>{res.updated}</b> updated · <b>{res.skipped.length}</b> skipped.</p>
            {res.credentials.length > 0 && (
              <>
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">These PINs are shown <b>only now</b>. Download the list and give each person their own PIN (they can change it in My profile).</p>
                <Button variant="outline" className="w-fit" onClick={download}><DownloadIcon /> Download sign-in details (CSV)</Button>
                <div className="max-h-56 overflow-auto rounded-lg border">
                  <table className="w-full text-xs"><thead className="bg-muted/60 text-left"><tr><th className="p-1.5">Name</th><th className="p-1.5">Sign in with</th><th className="p-1.5">PIN</th></tr></thead>
                    <tbody>{res.credentials.map((c) => <tr key={c.login + c.name} className="border-t"><td className="p-1.5">{c.name}</td><td className="p-1.5">{c.login}</td><td className="p-1.5 font-mono">{c.pin}</td></tr>)}</tbody></table>
                </div>
              </>
            )}
            {res.skipped.length > 0 && <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">{res.skipped.map((s) => <li key={s.row}>Row {s.row}{s.name ? ` (${s.name})` : ""}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{res ? "Close" : "Cancel"}</Button>
          {!res && <Button onClick={save} disabled={busy || rows.length === 0}>{busy ? <Spinner /> : `Add ${rows.length} ${rows.length === 1 ? "person" : "people"}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
