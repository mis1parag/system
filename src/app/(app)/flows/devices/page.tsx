"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BanIcon, CameraIcon, CheckIcon, LaptopIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DataTable, EmptyState, ErrorBox, Field, PageHeader, Pill, Section, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

interface Dev { deviceId: string; userId: string; name: string; label: string; status: "Approved" | "Pending" | "Blocked"; via: string; createdAt: string; lastUsedAt: string; lastIp: string }
interface Exempt { userId: string; name: string; device: boolean; camera: boolean; reason: string }
interface Listing { devices: Dev[]; exempt: Exempt[]; deviceCheck: boolean; photoMode: string }
const TONE = { Approved: "green", Pending: "amber", Blocked: "red" } as const;

/** Laptops & camera: which laptops / phones people check in from, and who is excused from the rules. */
export default function DevicesPage() {
  const { call, data, allow, isSuper } = useFlows();
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [excuse, setExcuse] = useState(false);
  const can = isSuper || allow("attendance", "configure");
  const load = useCallback(async () => {
    const r = await call<Listing>("listDevices", {});
    if (r.ok) { setList(r.data!); setError(""); } else setError(r.error || "Could not load");
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (can) load(); }, [can, load]);

  async function decide(d: Dev, decision: "approve" | "block") {
    setBusy(d.deviceId);
    const r = await call("decideDevice", { deviceId: d.deviceId, decision });
    setBusy("");
    if (r.ok) { toast.success(decision === "approve" ? `${d.name}'s laptop approved` : `${d.name}'s laptop blocked`); load(); } else toast.error(r.error || "Could not save");
  }
  async function unexcuse(e: Exempt) {
    const r = await call("saveAttExempt", { userId: e.userId, device: false, camera: false });
    if (r.ok) { toast.success(`${e.name} follows the rules again`); load(); } else toast.error(r.error || "Could not save");
  }
  const pending = useMemo(() => (list?.devices ?? []).filter((d) => d.status === "Pending"), [list]);
  if (!can) return <EmptyState title="No access" hint="Only people who manage attendance settings can open this page." />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!list) return <Spinner />;
  return (
    <>
      <PageHeader title="Laptops & camera" subtitle="Which laptops and phones people check in from, and who is excused from the rules." />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Pill tone={list.deviceCheck ? "green" : "gray"}><LaptopIcon className="mr-1 size-3" />Registered laptops: {list.deviceCheck ? "required" : "not required"}</Pill>
        <Pill tone={list.photoMode === "R" ? "green" : "gray"}><CameraIcon className="mr-1 size-3" />Camera photo: {list.photoMode === "R" ? "compulsory" : list.photoMode === "Y" ? "offered" : "off"}</Pill>
        {isSuper && <span className="text-muted-foreground">Change these in Settings → Attendance.</span>}
      </div>

      {pending.length > 0 && (
        <Section title={`Waiting for your approval (${pending.length})`} hint="Someone is trying to check in from a new laptop or phone." className="mb-4 border-amber-300">
          <ul className="grid gap-2">
            {pending.map((d) => (
              <li key={d.deviceId} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <b>{d.name}</b><span className="text-muted-foreground">{d.label}</span><span className="text-xs text-muted-foreground">asked {fmtDate(d.createdAt.slice(0, 10), true)}</span>
                <span className="flex-1" />
                <Button size="sm" disabled={busy === d.deviceId} onClick={() => decide(d, "approve")}><CheckIcon /> Approve</Button>
                <Button size="sm" variant="outline" disabled={busy === d.deviceId} onClick={() => decide(d, "block")}><BanIcon /> Block</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="All laptops and phones" hint="A person's first device is registered at once; the next ones wait for approval. A blocked device cannot check in." className="mb-4">
        {list.devices.length === 0 ? <EmptyState title="Nothing registered yet" hint="Devices appear here the first time a person checks in (once registered laptops are switched on in Settings)." /> : (
          <DataTable head={["Person", "Laptop / phone", "Status", "Added", "Last used", ""]}>
            {list.devices.map((d) => (
              <tr key={d.deviceId} className="border-t">
                <td className="px-3 py-2 font-medium">{d.name}</td>
                <td className="px-3 py-2">{d.label}<div className="text-[11px] text-muted-foreground">{d.via}</div></td>
                <td className="px-3 py-2"><Pill tone={TONE[d.status]}>{d.status}</Pill></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.createdAt.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.lastUsedAt ? d.lastUsedAt.slice(0, 16) : "never"}{d.lastIp ? ` · ${d.lastIp}` : ""}</td>
                <td className="px-3 py-2 text-right">
                  {d.status !== "Approved" && <Button size="sm" variant="ghost" disabled={busy === d.deviceId} onClick={() => decide(d, "approve")}>Approve</Button>}
                  {d.status !== "Blocked" && <Button size="sm" variant="ghost" disabled={busy === d.deviceId} onClick={() => decide(d, "block")}>Block</Button>}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Excused from the rules" hint="These people may check in from any laptop or phone, and / or without the camera photo. Everybody else follows the rules." actions={<Button size="sm" onClick={() => setExcuse(true)}><PlusIcon /> Excuse someone</Button>}>
        {list.exempt.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is excused — everyone follows the rules.</p> : (
          <DataTable head={["Person", "Any laptop is fine", "No camera needed", "Reason", ""]}>
            {list.exempt.map((e) => (
              <tr key={e.userId} className="border-t">
                <td className="px-3 py-2 font-medium">{e.name}</td>
                <td className="px-3 py-2">{e.device ? <Pill tone="blue">Yes</Pill> : "—"}</td>
                <td className="px-3 py-2">{e.camera ? <Pill tone="blue">Yes</Pill> : "—"}</td>
                <td className="px-3 py-2 text-sm text-muted-foreground">{e.reason}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => unexcuse(e)}><XIcon /> Remove</Button></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      {excuse && <ExcuseDialog people={(data?.users ?? []).filter((u) => u.status === "Active" && u.deleted !== "Y")} current={list.exempt} onClose={() => setExcuse(false)} onSaved={() => { setExcuse(false); load(); }} />}
    </>
  );
}

function ExcuseDialog({ people, current, onClose, onSaved }: { people: { userId: string; name: string }[]; current: Exempt[]; onClose: () => void; onSaved: () => void }) {
  const { call } = useFlows();
  const [userId, setUserId] = useState("");
  const [what, setWhat] = useState<"both" | "device" | "camera">("camera");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await call("saveAttExempt", { userId, device: what !== "camera", camera: what !== "device", reason });
    setBusy(false);
    if (r.ok) { toast.success("Saved"); onSaved(); } else toast.error(r.error || "Could not save");
  }
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Excuse someone</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Person">
            <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {sorted.map((u) => <option key={u.userId} value={u.userId}>{u.name}{current.some((c) => c.userId === u.userId) ? " (already excused — this replaces it)" : ""}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Excused from">
            <NativeSelect value={what} onChange={(e) => setWhat(e.target.value as typeof what)}>
              <option value="camera">The camera photo only</option>
              <option value="device">Registered laptops only (any laptop / phone is fine)</option>
              <option value="both">Both</option>
            </NativeSelect>
          </Field>
          <Field label="Reason" hint="Kept in the activity log."><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Field staff, camera broken, shared PC…" /></Field>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !userId || !reason.trim()}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
