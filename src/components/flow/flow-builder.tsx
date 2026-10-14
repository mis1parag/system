"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CopyIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, PageHeader, Section, Spinner } from "@/components/common";
import { makeFieldKey } from "@/lib/flow";
import type { Flow, FlowField, FieldType, RuleBase, StepCondition } from "@/lib/flow-types";
import { WEEKDAYS } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { ASSIGNEE_FALLBACK, TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";

interface FRow { uid: string; key: string; label: string; type: FieldType; required: boolean; unique: boolean; options: string }
interface SRow {
  uid: string; stepId: string; name: string; assigneeId: string; backupId: string; how: string; whenText: string;
  base: RuleBase; fieldUid: string; offsetDays: string; offsetHours: string; timeOfDay: string; sequential: boolean; autoDone: boolean;
  assignType: "fixed" | "field" | "pool"; assignFieldUid: string; assignMap: { value: string; userId: string }[]; pool: string[]; poolMode: "round_robin" | "least_load";
  condOn: boolean; condFieldUid: string; condOp: StepCondition["op"]; condValue: string;
  completion: FRow[]; reminder: string; escalateAfter: string; escalateTo: string;
}
interface Def {
  name: string; description: string; status: "Active" | "Archived"; openLabel: string; doneLabel: string; weeklyOff: number[]; workStart: string; workEnd: string; slaDays: string;
  fields: FRow[]; steps: SRow[]; anchorUid: string; titleUids: string[]; groupUid: string;
  rc: { enabled: boolean; freq: "daily" | "weekly" | "monthly"; time: string; weekdays: number[]; monthDay: string; skipOffDays: boolean; data: Record<string, string> };
}

let uidN = 0;
const uid = () => `u${++uidN}`;
const BASES: { v: RuleBase; label: string }[] = [
  { v: "none", label: "No planned time (e.g. done when the entry is added)" },
  { v: "anchor", label: "Working days from the schedule date ★" },
  { v: "field", label: "Working days from another date field" },
  { v: "created", label: "Working days from the time the entry is added" },
  { v: "prev_actual", label: "Working days after the previous step is done" },
];
const OPS: { v: StepCondition["op"]; label: string }[] = [
  { v: "eq", label: "is" }, { v: "neq", label: "is not" }, { v: "in", label: "is one of (a, b)" }, { v: "gt", label: "is more than" }, { v: "lt", label: "is less than" },
  { v: "filled", label: "is filled / ticked" }, { v: "empty", label: "is empty / not ticked" },
];
const TYPES: { v: FieldType; label: string }[] = [
  { v: "text", label: "Text" }, { v: "textarea", label: "Long text" }, { v: "number", label: "Number" }, { v: "date", label: "Date" }, { v: "datetime", label: "Date & time" },
  { v: "select", label: "Dropdown" }, { v: "checkbox", label: "Tick box" }, { v: "url", label: "Link" }, { v: "phone", label: "Phone" },
];

const toFRow = (f: FlowField): FRow => ({ uid: uid(), key: f.key, label: f.label, type: f.type, required: !!f.required, unique: !!f.unique, options: (f.options ?? []).join(", ") });
const blankField = (label = "", type: FieldType = "text"): FRow => ({ uid: uid(), key: "", label, type, required: false, unique: false, options: "" });
const blankStep = (): SRow => ({
  uid: uid(), stepId: "", name: "", assigneeId: "", backupId: "", how: "", whenText: "", base: "anchor", fieldUid: "", offsetDays: "0", offsetHours: "", timeOfDay: "", sequential: false, autoDone: false,
  assignType: "fixed", assignFieldUid: "", assignMap: [], pool: [], poolMode: "round_robin", condOn: false, condFieldUid: "", condOp: "eq", condValue: "", completion: [], reminder: "", escalateAfter: "", escalateTo: "",
});

type StepSrc = Flow["steps"][number] & { assigneeName?: string };
function stepRow(s: StepSrc, byKey: (k: string) => string, who: (s: StepSrc) => string): SRow {
  return {
    ...blankStep(), stepId: s.stepId, name: s.name, assigneeId: who(s), backupId: s.backupId ?? "", how: s.how, whenText: s.whenText, base: s.rule.base, fieldUid: byKey(s.rule.field ?? ""),
    offsetDays: String(s.rule.offsetDays ?? 0), offsetHours: s.rule.offsetHours ? String(s.rule.offsetHours) : "", timeOfDay: s.rule.timeOfDay ?? "", sequential: !!s.sequential, autoDone: !!s.autoDone,
    assignType: s.assign?.type ?? "fixed", assignFieldUid: byKey(s.assign?.field ?? ""), assignMap: Object.entries(s.assign?.map ?? {}).map(([value, userId]) => ({ value, userId })),
    pool: s.assign?.pool ?? [], poolMode: s.assign?.poolMode ?? "round_robin",
    condOn: !!s.condition, condFieldUid: byKey(s.condition?.field ?? ""), condOp: s.condition?.op ?? "eq", condValue: s.condition?.value ?? "",
    completion: (s.completionFields ?? []).map(toFRow), reminder: s.reminderMinutes ? String(s.reminderMinutes) : "", escalateAfter: s.escalateAfterMinutes ? String(s.escalateAfterMinutes) : "", escalateTo: s.escalateToId ?? "",
  };
}

function fromFlow(f: Flow): Def {
  const fields = f.fields.map(toFRow);
  const byKey = (k: string) => fields.find((x) => x.key === k)?.uid ?? "";
  const rc = f.recurrence;
  return {
    name: f.name, description: f.description, status: f.archived ? "Archived" : "Active", openLabel: f.openLabel, doneLabel: f.doneLabel, weeklyOff: f.weeklyOff,
    workStart: f.workStart, workEnd: f.workEnd, slaDays: f.slaDays ? String(f.slaDays) : "", fields, anchorUid: byKey(f.anchorField), titleUids: f.titleFields.map(byKey).filter(Boolean), groupUid: byKey(f.groupField),
    steps: f.steps.map((s) => stepRow(s, byKey, (x) => x.assigneeId)),
    rc: { enabled: !!rc, freq: rc?.freq ?? "daily", time: rc?.time ?? "08:00", weekdays: rc?.weekdays ?? [1], monthDay: String(rc?.monthDay || 1), skipOffDays: !!rc?.skipOffDays, data: Object.fromEntries(Object.entries(rc?.data ?? {}).map(([k, v]) => [byKey(k), v])) },
  };
}

function fromTemplate(tpl: (typeof TEMPLATES)[number]["data"], users: { userId: string; name: string }[]): Def {
  const t = tpl as unknown as { name: string; description: string; openLabel: string; doneLabel: string; weeklyOff: string; workStart: string; workEnd: string; slaDays?: number; anchorField: string; titleFields: string[]; groupField: string; fields: FlowField[]; steps: StepSrc[] };
  const fields = t.fields.map(toFRow);
  const byKey = (k: string) => fields.find((x) => x.key === k)?.uid ?? "";
  const match = (n?: string) => users.find((u) => u.name.toLowerCase() === String(n ?? "").toLowerCase())?.userId ?? users.find((u) => u.name.toLowerCase() === String(ASSIGNEE_FALLBACK[n ?? ""] ?? "").toLowerCase())?.userId ?? "";
  return {
    name: t.name, description: t.description, status: "Active", openLabel: t.openLabel, doneLabel: t.doneLabel, weeklyOff: t.weeklyOff.split(",").filter(Boolean).map(Number),
    workStart: t.workStart, workEnd: t.workEnd, slaDays: t.slaDays ? String(t.slaDays) : "", fields, anchorUid: byKey(t.anchorField), titleUids: t.titleFields.map(byKey), groupUid: byKey(t.groupField),
    steps: t.steps.map((s) => ({ ...stepRow({ ...s, backupId: "", sequential: !!s.sequential, autoDone: !!s.autoDone }, byKey, (x) => match(x.assigneeName)), stepId: "" })),
    rc: { enabled: false, freq: "daily", time: "08:00", weekdays: [1], monthDay: "1", skipOffDays: false, data: {} },
  };
}

const blank = (): Def => {
  const ref = blankField("Reference"), due = blankField("Due date", "datetime");
  ref.required = due.required = true;
  return {
    name: "", description: "", status: "Active", openLabel: "In progress", doneLabel: "Completed", weeklyOff: [0], workStart: "09:30", workEnd: "18:00", slaDays: "",
    fields: [ref, due], anchorUid: due.uid, titleUids: [ref.uid], groupUid: "", steps: [blankStep()],
    rc: { enabled: false, freq: "daily", time: "08:00", weekdays: [1], monthDay: "1", skipOffDays: false, data: {} },
  };
};

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

const cb = "h-4 w-4 rounded border-input";

/** Small editor for a list of fields (used for completion fields of a step). */
function MiniFields({ rows, onChange }: { rows: FRow[]; onChange: (r: FRow[]) => void }) {
  return (
    <div className="grid gap-2">
      {rows.map((f, i) => (
        <div key={f.uid} className="grid gap-2 rounded-lg border bg-muted/30 p-2 md:grid-cols-[1fr_9rem_auto]">
          <Input value={f.label} onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Docket no." aria-label="Field name" />
          <NativeSelect value={f.type} onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, type: e.target.value as FieldType } : x)))} aria-label="Type">{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</NativeSelect>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={f.required} onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)))} /> Required</label>
            <Button size="icon-sm" variant="ghost" className="text-red-700" aria-label="Remove field" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2Icon /></Button>
          </div>
          {f.type === "select" && <Input className="md:col-span-3" value={f.options} onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, options: e.target.value } : x)))} placeholder="Options, comma separated" aria-label="Options" />}
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => onChange([...rows, blankField()])}><PlusIcon /> Add a field to fill when done</Button>
    </div>
  );
}

export function FlowBuilder({ flow }: { flow?: Flow }) {
  const router = useRouter();
  const { data, call, itemsOf } = useFlows();
  const people = (data?.users ?? []).filter((u) => u.status === "Active");
  const [d, setD] = useState<Def>(() => (flow ? fromFlow(flow) : blank()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const hasItems = flow ? itemsOf(flow.flowId).length > 0 : false;
  const dateFields = d.fields.filter((f) => f.label.trim() && (f.type === "date" || f.type === "datetime"));
  const namedFields = d.fields.filter((f) => f.label.trim());
  const set = (p: Partial<Def>) => setD((cur) => ({ ...cur, ...p }));
  const setField = (i: number, p: Partial<FRow>) => set({ fields: d.fields.map((f, k) => (k === i ? { ...f, ...p } : f)) });
  const setStep = (i: number, p: Partial<SRow>) => set({ steps: d.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const anchorLabel = d.fields.find((f) => f.uid === d.anchorUid)?.label || "schedule date";
  const personName = (id: string) => people.find((u) => u.userId === id)?.name ?? "";

  const preview = (s: SRow): string => {
    const n = Number(s.offsetDays) || 0;
    const abs = Math.abs(n);
    const dir = n === 0 ? "on the same day as" : `${abs} working day${abs > 1 ? "s" : ""} ${n < 0 ? "before" : "after"}`;
    const from = s.base === "anchor" ? anchorLabel : s.base === "field" ? d.fields.find((f) => f.uid === s.fieldUid)?.label || "the date" : s.base === "created" ? "the entry being added" : "the previous step being done";
    return s.base === "none" ? "No planned time" : `${dir} ${from}${s.timeOfDay ? ` at ${s.timeOfDay}` : ""}`;
  };

  async function save() {
    setBusy(true); setErr("");
    const used = new Set(d.fields.filter((f) => f.key).map((f) => f.key));
    const keyOf = new Map<string, string>();
    const fields = d.fields.filter((f) => f.label.trim()).map((f) => {
      const key = f.key || makeFieldKey(f.label, used);
      used.add(key);
      keyOf.set(f.uid, key);
      return { key, label: f.label.trim(), type: f.type, required: f.required, unique: f.unique, options: f.type === "select" ? f.options.split(",").map((x) => x.trim()).filter(Boolean) : undefined };
    });
    const miniFields = (rows: FRow[]) => {
      const u = new Set(rows.filter((r) => r.key).map((r) => r.key));
      return rows.filter((r) => r.label.trim()).map((r) => { const key = r.key || makeFieldKey(r.label, u); u.add(key); return { key, label: r.label.trim(), type: r.type, required: r.required, options: r.type === "select" ? r.options.split(",").map((x) => x.trim()).filter(Boolean) : undefined }; });
    };
    const payload = {
      flowId: flow?.flowId, name: d.name, description: d.description, status: d.status, openLabel: d.openLabel, doneLabel: d.doneLabel, weeklyOff: d.weeklyOff.join(","),
      workStart: d.workStart, workEnd: d.workEnd, slaDays: Number(d.slaDays) || 0, fields, anchorField: keyOf.get(d.anchorUid) ?? "", titleFields: d.titleUids.map((u) => keyOf.get(u)).filter(Boolean),
      groupField: keyOf.get(d.groupUid) ?? "",
      recurrence: d.rc.enabled ? { enabled: true, freq: d.rc.freq, time: d.rc.time, weekdays: d.rc.weekdays, monthDay: Number(d.rc.monthDay) || 1, skipOffDays: d.rc.skipOffDays, data: Object.fromEntries(Object.entries(d.rc.data).map(([u, v]) => [keyOf.get(u), v]).filter(([k, v]) => k && v)) } : null,
      steps: d.steps.map((s) => ({
        stepId: s.stepId, name: s.name, assigneeId: s.assigneeId, backupId: s.backupId, how: s.how, whenText: s.whenText || preview(s), sequential: s.sequential, autoDone: s.autoDone,
        rule: s.base === "none" ? { base: "none" } : { base: s.base, field: s.base === "field" ? keyOf.get(s.fieldUid) : undefined, offsetDays: Number(s.offsetDays) || 0, offsetHours: Number(s.offsetHours) || 0, timeOfDay: s.timeOfDay || undefined },
        assign: s.assignType === "fixed" ? null : s.assignType === "field" ? { type: "field", field: keyOf.get(s.assignFieldUid), map: Object.fromEntries(s.assignMap.filter((m) => m.value.trim() && m.userId).map((m) => [m.value.trim(), m.userId])) } : { type: "pool", pool: s.pool, poolMode: s.poolMode },
        condition: s.condOn && s.condFieldUid ? { field: keyOf.get(s.condFieldUid), op: s.condOp, value: s.condValue } : null,
        completionFields: miniFields(s.completion), reminderMinutes: Number(s.reminder) || 0, escalateAfterMinutes: Number(s.escalateAfter) || 0, escalateToId: s.escalateTo,
      })),
    };
    const r = await call<{ flowId: string }>(flow ? "updateFlow" : "createFlow", payload);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    toast.success(flow ? "FMS updated" : "FMS created");
    router.replace(`/flows/${r.data!.flowId}`);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const intakeUrl = flow ? `${origin}/api/intake/${flow.flowId}` : "";
  const snippet = flow ? `function onFormSubmit(e) {\n  var data = {};\n  e.response.getItemResponses().forEach(function (r) { data[r.getItem().getTitle()] = r.getResponse(); });\n  UrlFetchApp.fetch("${intakeUrl}", {\n    method: "post", contentType: "application/json",\n    headers: { "x-intake-token": "${flow.intakeToken}" },\n    payload: JSON.stringify(data)\n  });\n}` : "";
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success("Copied"));
  const mapFieldOptions = (uidv: string) => d.fields.find((f) => f.uid === uidv)?.options.split(",").map((x) => x.trim()).filter(Boolean) ?? [];

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <PageHeader title={flow ? `Edit · ${flow.name}` : "Create FMS"} subtitle="Define the entry form and the steps once. Planned times for every entry are then calculated automatically." />
      {err && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
      {!flow && (
        <div className="mb-4 rounded-xl border border-dashed bg-card p-3 text-sm">
          <div className="mb-2 text-muted-foreground">Start from a ready-made FMS, or from blank:</div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => <Button key={t.id} size="sm" variant="outline" onClick={() => setD(fromTemplate(t.data, people))}>{t.data.name}</Button>)}
            <Button size="sm" variant="ghost" onClick={() => setD(blank())}>Blank</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4">
        <Section title="1 · Basics">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="FMS name *"><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Instamart & Blinkit PO dispatch" /></Field>
            <Field label="Status"><NativeSelect value={d.status} onChange={(e) => set({ status: e.target.value as Def["status"] })}><option value="Active">Active</option><option value="Archived">Archived (no new entries)</option></NativeSelect></Field>
            <Field label="Description" className="md:col-span-2"><Textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Label while in progress"><Input value={d.openLabel} onChange={(e) => set({ openLabel: e.target.value })} placeholder="Pending" /></Field>
            <Field label="Label when all steps are done"><Input value={d.doneLabel} onChange={(e) => set({ doneLabel: e.target.value })} placeholder="Delivered" /></Field>
            <Field label="SLA: finish within (working days)" hint="Optional. Shows an SLA badge on entries; 0 = none"><Input inputMode="numeric" value={d.slaDays} onChange={(e) => set({ slaDays: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
        </Section>

        <Section title="2 · Working calendar" hint="Planned times skip the weekly-off days and the holidays you add under “Absence & Holidays”.">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {WEEKDAYS.map((w, i) => (
              <label key={w} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className={cb} checked={d.weeklyOff.includes(i)} onChange={(e) => set({ weeklyOff: e.target.checked ? [...d.weeklyOff, i] : d.weeklyOff.filter((x) => x !== i) })} /> {w.slice(0, 3)} off</label>
            ))}
          </div>
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <Field label="Day starts"><Input type="time" value={d.workStart} onChange={(e) => set({ workStart: e.target.value })} /></Field>
            <Field label="Day ends" hint="Default time for a step when the date has no time"><Input type="time" value={d.workEnd} onChange={(e) => set({ workEnd: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="3 · Entry form (what you fill for each PO / case)" hint="★ the schedule date drives the steps · Title = shown as the entry name · Group = used for the location / segment breakdown">
          <div className="grid gap-2">
            {d.fields.map((f, i) => (
              <div key={f.uid} className="rounded-xl border p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_9rem_auto]">
                  <Input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Field name, e.g. PO number" aria-label="Field name" />
                  <NativeSelect value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })} aria-label="Type">{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</NativeSelect>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => set({ fields: move(d.fields, i, -1) })} disabled={i === 0} aria-label="Move up"><ArrowUpIcon /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => set({ fields: move(d.fields, i, 1) })} disabled={i === d.fields.length - 1} aria-label="Move down"><ArrowDownIcon /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-red-700" onClick={() => set({ fields: d.fields.filter((_, k) => k !== i) })} aria-label="Remove field"><Trash2Icon /></Button>
                  </div>
                </div>
                {f.type === "select" && <Input className="mt-2" value={f.options} onChange={(e) => setField(i, { options: e.target.value })} placeholder="Options, comma separated: Blinkit, Instamart" aria-label="Options" />}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={f.unique} onChange={(e) => setField(i, { unique: e.target.checked })} /> No duplicates</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={d.titleUids.includes(f.uid)} onChange={(e) => set({ titleUids: e.target.checked ? [...d.titleUids, f.uid] : d.titleUids.filter((x) => x !== f.uid) })} /> Title</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="group" checked={d.groupUid === f.uid} onChange={() => set({ groupUid: f.uid })} /> Group by</label>
                  {(f.type === "date" || f.type === "datetime") && <label className="flex items-center gap-1.5 font-medium text-primary"><input type="radio" name="anchor" checked={d.anchorUid === f.uid} onChange={() => set({ anchorUid: f.uid })} /> ★ Schedule date</label>}
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-fit" onClick={() => set({ fields: [...d.fields, blankField()] })}><PlusIcon /> Add field</Button>
            {d.groupUid && <button className="w-fit text-xs text-muted-foreground underline" onClick={() => set({ groupUid: "" })}>Clear group-by</button>}
          </div>
        </Section>

        <Section title="4 · Steps (who does what, and when)" hint="Planned time of each step is calculated from a date, skipping weekly-off days and holidays. Negative days = before.">
          <div className="grid gap-3">
            {d.steps.map((s, i) => {
              const locked = hasItems && !!s.stepId;
              const adv = open[s.uid];
              return (
                <div key={s.uid} className="rounded-xl border p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                      <Input className="md:col-span-2" value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} placeholder="Step name, e.g. Take dispatch confirmation & docket copy" aria-label="Step name" />
                      <Field label={s.assignType === "fixed" ? "Who is responsible *" : "Default person (fallback) *"}><NativeSelect value={s.assigneeId} onChange={(e) => setStep(i, { assigneeId: e.target.value })}><option value="">Select…</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
                      <Field label="Default backup (optional)"><NativeSelect value={s.backupId} onChange={(e) => setStep(i, { backupId: e.target.value })}><option value="">—</option>{people.filter((u) => u.userId !== s.assigneeId).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
                      <Field label="How (call / mail / checklist…)"><Input value={s.how} onChange={(e) => setStep(i, { how: e.target.value })} /></Field>
                      <Field label="When (shown to the team)" hint={`Auto: ${preview(s)}`}><Input value={s.whenText} onChange={(e) => setStep(i, { whenText: e.target.value })} placeholder={preview(s)} /></Field>
                      <Field label="Planned time is" className="md:col-span-2">
                        <div className="grid gap-2 md:grid-cols-[1fr_6rem_7rem_6rem]">
                          <NativeSelect value={s.base} onChange={(e) => setStep(i, { base: e.target.value as RuleBase })}>{BASES.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}</NativeSelect>
                          {s.base !== "none" && <Input inputMode="numeric" value={s.offsetDays} onChange={(e) => setStep(i, { offsetDays: e.target.value.replace(/[^\d-]/g, "") })} aria-label="Working days (negative = before)" placeholder="days" />}
                          {s.base !== "none" && <Input type="time" value={s.timeOfDay} onChange={(e) => setStep(i, { timeOfDay: e.target.value })} aria-label="Fixed time of day (optional)" />}
                          {s.base !== "none" && <Input inputMode="decimal" value={s.offsetHours} onChange={(e) => setStep(i, { offsetHours: e.target.value.replace(/[^\d.-]/g, "") })} aria-label="Extra hours" placeholder="+ hours" />}
                        </div>
                        {s.base === "field" && <NativeSelect className="mt-2" value={s.fieldUid} onChange={(e) => setStep(i, { fieldUid: e.target.value })}><option value="">Which date field?</option>{dateFields.map((f) => <option key={f.uid} value={f.uid}>{f.label}</option>)}</NativeSelect>}
                      </Field>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs md:col-span-2">
                        <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={s.autoDone} onChange={(e) => setStep(i, { autoDone: e.target.checked })} /> Mark done automatically when the entry is added</label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={s.sequential} onChange={(e) => setStep(i, { sequential: e.target.checked })} /> Only after the previous step is done</label>
                      </div>

                      <button type="button" onClick={() => setOpen({ ...open, [s.uid]: !adv })} className="flex items-center gap-1 text-xs font-medium text-primary md:col-span-2">
                        <ChevronDownIcon className={cn("size-4 transition-transform", adv && "rotate-180")} /> Advanced: auto-assign, conditions, data to capture, reminders
                        {(s.assignType !== "fixed" || s.condOn || s.completion.length > 0 || s.reminder || s.escalateAfter) && <span className="ml-1 rounded bg-primary/10 px-1.5 text-[10px]">in use</span>}
                      </button>
                      {adv && (
                        <div className="grid gap-3 rounded-lg bg-muted/40 p-3 md:col-span-2">
                          <Field label="Who gets this step">
                            <NativeSelect value={s.assignType} onChange={(e) => setStep(i, { assignType: e.target.value as SRow["assignType"] })}>
                              <option value="fixed">Always the person above</option>
                              <option value="field">Decided by a field (e.g. location → person)</option>
                              <option value="pool">Shared by a team (round robin / least loaded)</option>
                            </NativeSelect>
                          </Field>
                          {s.assignType === "field" && (
                            <div className="grid gap-2">
                              <NativeSelect value={s.assignFieldUid} onChange={(e) => setStep(i, { assignFieldUid: e.target.value })}><option value="">Which field decides?</option>{namedFields.map((f) => <option key={f.uid} value={f.uid}>{f.label}</option>)}</NativeSelect>
                              {s.assignMap.map((m, k) => (
                                <div key={k} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                                  {mapFieldOptions(s.assignFieldUid).length > 0 ? (
                                    <NativeSelect value={m.value} onChange={(e) => setStep(i, { assignMap: s.assignMap.map((x, y) => (y === k ? { ...x, value: e.target.value } : x)) })}><option value="">When it is…</option>{mapFieldOptions(s.assignFieldUid).map((o) => <option key={o}>{o}</option>)}</NativeSelect>
                                  ) : <Input value={m.value} placeholder="When it is… (e.g. Pune P2)" onChange={(e) => setStep(i, { assignMap: s.assignMap.map((x, y) => (y === k ? { ...x, value: e.target.value } : x)) })} />}
                                  <NativeSelect value={m.userId} onChange={(e) => setStep(i, { assignMap: s.assignMap.map((x, y) => (y === k ? { ...x, userId: e.target.value } : x)) })}><option value="">→ person</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect>
                                  <Button size="icon-sm" variant="ghost" className="text-red-700" aria-label="Remove rule" onClick={() => setStep(i, { assignMap: s.assignMap.filter((_, y) => y !== k) })}><Trash2Icon /></Button>
                                </div>
                              ))}
                              <Button size="sm" variant="outline" className="w-fit" onClick={() => setStep(i, { assignMap: [...s.assignMap, { value: "", userId: "" }] })}><PlusIcon /> Add a rule</Button>
                              <p className="text-xs text-muted-foreground">Anything not listed goes to the person above.</p>
                            </div>
                          )}
                          {s.assignType === "pool" && (
                            <div className="grid gap-2">
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">{people.map((u) => <label key={u.userId} className="flex items-center gap-1.5"><input type="checkbox" className={cb} checked={s.pool.includes(u.userId)} onChange={(e) => setStep(i, { pool: e.target.checked ? [...s.pool, u.userId] : s.pool.filter((x) => x !== u.userId) })} /> {u.name}</label>)}</div>
                              <NativeSelect value={s.poolMode} onChange={(e) => setStep(i, { poolMode: e.target.value as SRow["poolMode"] })}><option value="round_robin">Take turns (round robin)</option><option value="least_load">Give to whoever has the fewest open steps</option></NativeSelect>
                            </div>
                          )}

                          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className={cb} checked={s.condOn} onChange={(e) => setStep(i, { condOn: e.target.checked })} /> Only needed in some cases (otherwise it is skipped as “not applicable”)</label>
                          {s.condOn && (
                            <div className="grid gap-2 md:grid-cols-3">
                              <NativeSelect value={s.condFieldUid} onChange={(e) => setStep(i, { condFieldUid: e.target.value })}><option value="">When the field…</option>{namedFields.map((f) => <option key={f.uid} value={f.uid}>{f.label}</option>)}</NativeSelect>
                              <NativeSelect value={s.condOp} onChange={(e) => setStep(i, { condOp: e.target.value as StepCondition["op"] })}>{OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</NativeSelect>
                              {s.condOp !== "filled" && s.condOp !== "empty" && <Input value={s.condValue} onChange={(e) => setStep(i, { condValue: e.target.value })} placeholder="value" />}
                            </div>
                          )}

                          <Field label="Data the doer enters when finishing this step"><MiniFields rows={s.completion} onChange={(completion) => setStep(i, { completion })} /></Field>

                          <div className="grid gap-2 md:grid-cols-3">
                            <Field label="Remind before due (minutes)" hint="blank = Settings default"><Input inputMode="numeric" value={s.reminder} onChange={(e) => setStep(i, { reminder: e.target.value.replace(/\D/g, "") })} /></Field>
                            <Field label="Escalate after overdue (minutes)" hint="blank = Settings default"><Input inputMode="numeric" value={s.escalateAfter} onChange={(e) => setStep(i, { escalateAfter: e.target.value.replace(/\D/g, "") })} /></Field>
                            <Field label="Escalate to" hint="blank = the doer's manager, else admins"><NativeSelect value={s.escalateTo} onChange={(e) => setStep(i, { escalateTo: e.target.value })}><option value="">—</option>{people.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect></Field>
                          </div>
                          {s.assignType === "fixed" && s.assigneeId && <p className="text-xs text-muted-foreground">Always {personName(s.assigneeId)} (their backup takes over automatically when they are marked absent).</p>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="icon-sm" variant="ghost" onClick={() => set({ steps: move(d.steps, i, -1) })} disabled={i === 0 || locked} aria-label="Move up"><ArrowUpIcon /></Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => set({ steps: move(d.steps, i, 1) })} disabled={i === d.steps.length - 1 || locked} aria-label="Move down"><ArrowDownIcon /></Button>
                      <Button size="icon-sm" variant="ghost" className="text-red-700" disabled={locked} title={locked ? "This step already has entries, so it cannot be removed" : "Remove"} onClick={() => set({ steps: d.steps.filter((_, k) => k !== i) })} aria-label="Remove step"><Trash2Icon /></Button>
                    </div>
                  </div>
                </div>
              );
            })}
            <Button variant="outline" className="w-fit" onClick={() => set({ steps: [...d.steps, blankStep()] })}><PlusIcon /> Add step</Button>
            {hasItems && <p className="text-xs text-muted-foreground">This FMS already has entries: existing steps cannot be removed or re-ordered. New steps are added to every existing entry. Changing a timing rule re-plans steps that are not done yet.</p>}
          </div>
        </Section>

        <Section title="5 · Repeating entries (optional)" hint="For routine work: the app adds an entry on its own — a daily cash count, a weekly stock check, a monthly GST filing.">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className={cb} checked={d.rc.enabled} onChange={(e) => set({ rc: { ...d.rc, enabled: e.target.checked } })} /> Create entries automatically</label>
          {d.rc.enabled && (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Repeat"><NativeSelect value={d.rc.freq} onChange={(e) => set({ rc: { ...d.rc, freq: e.target.value as Def["rc"]["freq"] } })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></NativeSelect></Field>
                <Field label="At"><Input type="time" value={d.rc.time} onChange={(e) => set({ rc: { ...d.rc, time: e.target.value } })} /></Field>
                {d.rc.freq === "monthly" && <Field label="Day of the month"><Input inputMode="numeric" value={d.rc.monthDay} onChange={(e) => set({ rc: { ...d.rc, monthDay: e.target.value.replace(/\D/g, "") } })} /></Field>}
              </div>
              {d.rc.freq === "weekly" && <div className="flex flex-wrap gap-x-4 gap-y-1.5">{WEEKDAYS.map((w, k) => <label key={w} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className={cb} checked={d.rc.weekdays.includes(k)} onChange={(e) => set({ rc: { ...d.rc, weekdays: e.target.checked ? [...d.rc.weekdays, k] : d.rc.weekdays.filter((x) => x !== k) } })} /> {w.slice(0, 3)}</label>)}</div>}
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className={cb} checked={d.rc.skipOffDays} onChange={(e) => set({ rc: { ...d.rc, skipOffDays: e.target.checked } })} /> Skip weekly-off days and holidays</label>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Values to fill in automatically (the schedule date defaults to the moment it is created)</div>
                <div className="grid gap-2 md:grid-cols-2">{namedFields.filter((f) => f.uid !== d.anchorUid).map((f) => <Field key={f.uid} label={f.label}><Input value={d.rc.data[f.uid] ?? ""} onChange={(e) => set({ rc: { ...d.rc, data: { ...d.rc.data, [f.uid]: e.target.value } } })} /></Field>)}</div>
              </div>
            </div>
          )}
        </Section>

        {flow && (
          <Section title="6 · Google Form / other systems" hint="Send answers straight into this FMS: every submission becomes an entry with all its steps planned.">
            <div className="grid gap-2 text-xs">
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5">{intakeUrl}</code><Button size="icon-sm" variant="outline" aria-label="Copy URL" onClick={() => copy(intakeUrl)}><CopyIcon /></Button></div>
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5">token: {flow.intakeToken}</code><Button size="icon-sm" variant="outline" aria-label="Copy token" onClick={() => copy(flow.intakeToken)}><CopyIcon /></Button>
                <Button size="sm" variant="outline" onClick={async () => { if (window.confirm("Make a new token? The old one stops working.")) { const r = await call("rotateIntakeToken", { flowId: flow.flowId }); if (r.ok) toast.success("New token created"); else toast.error(r.error || "Failed"); } }}><RefreshCwIcon /> New token</Button></div>
              <p className="text-muted-foreground">In your Google Form: <b>⋮ → Script editor</b>, paste this, then <b>Triggers → Add trigger → onFormSubmit → From form → On form submit</b>. Question titles must match the field names above.</p>
              <div className="relative"><pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2.5 text-[11px] leading-snug">{snippet}</pre><Button size="icon-sm" variant="outline" className="absolute right-1.5 top-1.5" aria-label="Copy script" onClick={() => copy(snippet)}><CopyIcon /></Button></div>
            </div>
          </Section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={() => router.back()}>Cancel</Button>
          <Button className="h-11 px-6" onClick={save} disabled={busy}>{busy ? <Spinner /> : flow ? "Save changes" : "Create FMS"}</Button>
        </div>
      </div>
    </div>
  );
}
