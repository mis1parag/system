"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/common";
import { ASSIGNEE_FALLBACK, DRIVE_TEMPLATE_IDS, TEMPLATES } from "@/lib/templates";
import { useFlows } from "@/lib/flow-store";

type Tpl = (typeof TEMPLATES)[number]["data"] & { steps: { assigneeName?: string }[] };

/** Create many ready-made FMS in one go. People are matched by the name used in the template (or the usual stand-in for a role). */
export function AddTemplatesDialog({ onClose }: { onClose: () => void }) {
  const { data, flows, call, meId } = useFlows();
  const people = useMemo(() => (data?.users ?? []).filter((u) => u.status === "Active"), [data]);
  const have = useMemo(() => new Set(flows.map((f) => f.name.toLowerCase())), [flows]);
  const idOf = (name: string | undefined) => {
    const n = String(name ?? "").toLowerCase();
    return people.find((u) => u.name.toLowerCase() === n)?.userId ?? people.find((u) => u.name.toLowerCase() === String(ASSIGNEE_FALLBACK[name ?? ""] ?? "").toLowerCase())?.userId ?? "";
  };
  const list = TEMPLATES.map((t) => ({ id: t.id as string, t: t.data as unknown as Tpl, drive: (DRIVE_TEMPLATE_IDS as readonly string[]).includes(t.id) }));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(list.filter((x) => x.drive && !have.has(x.t.name.toLowerCase())).map((x) => x.id)));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ name: string; ok: boolean; note: string }[] | null>(null);

  async function run() {
    setBusy(true);
    const out: { name: string; ok: boolean; note: string }[] = [];
    for (const x of list.filter((y) => picked.has(y.id))) {
      const missing = new Set<string>();
      const payload = { ...x.t, steps: x.t.steps.map((s) => { const id = idOf(s.assigneeName) || meId; if (!idOf(s.assigneeName)) missing.add(String(s.assigneeName)); return { ...s, assigneeId: id }; }) };
      const r = await call("createFlow", payload);
      out.push({ name: x.t.name, ok: r.ok, note: r.ok ? (missing.size ? `${[...missing].join(", ")} not found — given to you, change in Edit FMS` : "created") : r.error || "failed" });
    }
    setBusy(false);
    setLog(out);
    toast.success(`${out.filter((o) => o.ok).length} FMS created`);
  }

  const row = (x: (typeof list)[number]) => {
    const exists = have.has(x.t.name.toLowerCase());
    return (
      <label key={x.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 rounded border-input" disabled={exists} checked={picked.has(x.id) && !exists} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} />
        <span className="min-w-0"><span className="font-medium">{x.t.name}</span> <span className="text-xs text-muted-foreground">{x.t.steps.length} steps{exists ? " · already added" : ""}</span><span className="line-clamp-2 block text-xs text-muted-foreground">{x.t.description}</span></span>
      </label>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add ready-made FMS</DialogTitle></DialogHeader>
        {!log ? (
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">The first group is made from the FMS sheets in your Google Drive. Doers are matched by name (Riya, Kunal, Sapna…); role names like “Purchase Assistant” go to the usual person. You can change anyone in Edit FMS.</p>
            <div className="grid gap-1.5"><h3 className="text-xs font-semibold uppercase text-muted-foreground">From your Drive</h3>{list.filter((x) => x.drive).map(row)}</div>
            <div className="grid gap-1.5"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Other examples</h3>{list.filter((x) => !x.drive).map(row)}</div>
          </div>
        ) : (
          <ul className="grid gap-1.5 text-sm">{log.map((o) => <li key={o.name} className="flex items-start gap-2">{o.ok ? <CheckIcon className="mt-0.5 size-4 text-emerald-600" /> : <span className="text-red-700">✗</span>}<span><b>{o.name}</b> <span className="text-xs text-muted-foreground">{o.note}</span></span></li>)}</ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{log ? "Close" : "Cancel"}</Button>
          {!log && <Button onClick={run} disabled={busy || picked.size === 0}>{busy ? <Spinner /> : `Create ${picked.size} FMS`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
