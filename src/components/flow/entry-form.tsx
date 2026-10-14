"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, Spinner } from "@/components/common";
import { FieldInput, useSuggestions } from "@/components/flow/fields";
import { itemData } from "@/lib/flow";
import { PRIORITIES, type Flow, type FlowItem } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";

export function EntryForm({ flow, item, onClose, onSaved }: { flow: Flow; item?: FlowItem; onClose: () => void; onSaved?: (id: string) => void }) {
  const { call, itemsOf, data, meId } = useFlows();
  const existing = item ? itemData(item) : {};
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(flow.fields.map((f) => [f.key, existing[f.key] === undefined ? "" : String(existing[f.key])])));
  const [priority, setPriority] = useState<string>(item?.priority ?? "Normal");
  const [tags, setTags] = useState(item?.tags ?? "");
  const [visibility, setVisibility] = useState(item?.visibility || "assigned");
  const [visibleTo, setVisibleTo] = useState<string[]>((item?.visibleTo ?? "").split(",").filter(Boolean));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const suggestions = useSuggestions(flow, itemsOf(flow.flowId));

  async function save() {
    setBusy(true); setErr("");
    const r = item
      ? await call<FlowItem>("updateEntry", { itemId: item.itemId, data: v, priority, tags, visibility, visibleTo: visibleTo.join(",") })
      : await call<FlowItem>("createEntry", { flowId: flow.flowId, data: v, priority, tags, visibility, visibleTo: visibleTo.join(",") });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(item ? "Entry updated" : "Entry added — all planned times are set");
    onSaved?.(r.data!.itemId);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{item ? "Edit entry" : `New entry · ${flow.name}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {flow.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}${f.key === flow.anchorField ? " · drives the schedule" : ""}`}>
              <FieldInput field={f} value={v[f.key] ?? ""} onChange={(x) => setV({ ...v, [f.key]: x })} suggestions={suggestions[f.key]} />
            </Field>
          ))}
          <Field label="Priority"><NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field>
          <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">More options</summary>
            <div className="mt-3 grid gap-3">
              <Field label="Tags" hint="comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, cold-chain" /></Field>
              <Field label="Who can see this entry" hint="The people who work on it and their managers always can. Add more only if needed.">
                <NativeSelect value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="assigned">Only the people working on it (and their managers)</option><option value="department">Everyone in my department</option><option value="users">Selected people…</option><option value="management">Managers and admins</option>
                </NativeSelect>
              </Field>
              {visibility === "users" && (
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border bg-card p-2">
                  {(data?.users ?? []).filter((u) => u.status === "Active" && u.userId !== meId).map((u) => <label key={u.userId} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={visibleTo.includes(u.userId)} onChange={(e) => setVisibleTo(e.target.checked ? [...visibleTo, u.userId] : visibleTo.filter((x) => x !== u.userId))} />{u.name}<span className="text-xs text-muted-foreground">{u.department}</span></label>)}
                </div>
              )}
            </div>
          </details>
          {item && flow.anchorField && <p className="text-xs text-muted-foreground">Changing the date that drives the schedule re-plans the steps that are not done yet. Use <b>Postpone</b> if the appointment moved, so the reason is recorded.</p>}
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : item ? "Save" : "Add entry"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
