"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, PageHeader, Section, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

export default function SettingsPage() {
  const { data, isSuper, call } = useFlows();
  const router = useRouter();
  const s = data?.settings ?? {};
  const [v, setV] = useState<Record<string, string>>(s);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (data && !isSuper) router.replace("/flows"); }, [data, isSuper, router]);
  if (!isSuper) return null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  async function save() {
    setBusy(true); setErr("");
    const r = await call("saveSettings", { settings: v });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Could not save"); else toast.success("Settings saved");
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Settings" subtitle="Company-wide rules. Only a Super Admin can change these." />
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="grid gap-4">
        <Section title="General">
          <Field label="Company name"><Input value={v.COMPANY_NAME ?? ""} onChange={set("COMPANY_NAME")} /></Field>
          <Field label="Time zone" hint="IANA name, e.g. Asia/Kolkata. Decides what “now” and “today” mean for planned and actual times."><Input value={v.TIMEZONE ?? ""} onChange={set("TIMEZONE")} /></Field>
        </Section>
        <Section title="Reminders & escalation" hint="Each step can override these in the FMS builder.">
          <Field label="Remind the doer before a step is due (minutes)"><Input inputMode="numeric" value={v.REMINDER_MINUTES ?? ""} onChange={set("REMINDER_MINUTES")} /></Field>
          <Field label="Tell the manager when a step is overdue by (minutes)" hint="0 turns escalation off"><Input inputMode="numeric" value={v.ESCALATE_AFTER_MINUTES ?? ""} onChange={set("ESCALATE_AFTER_MINUTES")} /></Field>
        </Section>
        <Section title="Morning summary" hint="One message per person with today's and overdue steps (email / WhatsApp / bell).">
          <Field label="Send it"><NativeSelect value={v.DIGEST_ENABLED ?? "N"} onChange={set("DIGEST_ENABLED")}><option value="N">No</option><option value="Y">Yes, every day</option></NativeSelect></Field>
          <Field label="At hour (0–23)"><Input inputMode="numeric" value={v.DIGEST_HOUR ?? ""} onChange={set("DIGEST_HOUR")} /></Field>
        </Section>
        <Section title="Checklist & scorecard">
          <Field label="Weekly-off days" hint="Day numbers, comma separated: 0 = Sunday … 6 = Saturday. Checklist tasks skip these days (and the holidays you add)."><Input value={v.WEEKLY_OFF ?? ""} onChange={set("WEEKLY_OFF")} placeholder="0" /></Field>
          <Field label="Remind people about pending checklist tasks at hour (0–23)" hint="24 = never"><Input inputMode="numeric" value={v.CHECKLIST_REMIND_HOUR ?? ""} onChange={set("CHECKLIST_REMIND_HOUR")} /></Field>
          <Field label="Scorecard benchmark (%)" hint="Up to this % of work not done / not done on time shows green; up to double shows amber; more is red."><Input inputMode="numeric" value={v.SCORE_BENCHMARK ?? ""} onChange={set("SCORE_BENCHMARK")} /></Field>
        </Section>
        <Section title="Attendance rules" hint="Used for late / early, full / half day and the monthly report.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Late if first check-in is after"><Input type="time" value={v.ATT_LATE_AFTER ?? ""} onChange={set("ATT_LATE_AFTER")} /></Field>
            <Field label="Early if last check-out is before"><Input type="time" value={v.ATT_EARLY_BEFORE ?? ""} onChange={set("ATT_EARLY_BEFORE")} /></Field>
            <Field label="Hours for a full day"><Input inputMode="decimal" value={v.ATT_FULL_HOURS ?? ""} onChange={set("ATT_FULL_HOURS")} /></Field>
            <Field label="Hours for a half day"><Input inputMode="decimal" value={v.ATT_HALF_HOURS ?? ""} onChange={set("ATT_HALF_HOURS")} /></Field>
            <Field label="Normal working hours per day" className="col-span-2"><Input inputMode="decimal" value={v.ATT_STD_HOURS ?? ""} onChange={set("ATT_STD_HOURS")} /></Field>
            <Field label="Who can check in / out" hint="“Only at the office kiosk” stops punching from personal phones and PCs (admins can still punch).">
              <NativeSelect value={v.ATT_SELF_PUNCH ?? "Y"} onChange={set("ATT_SELF_PUNCH")}><option value="Y">Anywhere (own phone or PC)</option><option value="N">Only at the office kiosk</option></NativeSelect>
            </Field>
            <Field label="Check-in screen" hint="What happens when someone opens the app on a working day without having checked in." className="col-span-2">
              <NativeSelect value={v.ATT_GATE ?? "required"} onChange={set("ATT_GATE")}><option value="required">Must check in first (cannot be skipped)</option><option value="prompt">Ask, but they can postpone 30 minutes</option><option value="off">Do not ask</option></NativeSelect>
            </Field>
            <Field label="Show it from"><Input type="time" value={v.ATT_GATE_FROM ?? ""} onChange={set("ATT_GATE_FROM")} /></Field>
            <Field label="Remind if not checked in by"><Input type="time" value={v.ATT_REMIND_CHECKIN ?? ""} onChange={set("ATT_REMIND_CHECKIN")} /></Field>
            <Field label="Remind to check out after" className="col-span-2"><Input type="time" value={v.ATT_REMIND_CHECKOUT ?? ""} onChange={set("ATT_REMIND_CHECKOUT")} /></Field>
            <Field label="Photo with every punch" hint="Compulsory means no check-in or check-out without a camera photo (the server refuses it).">
              <NativeSelect value={v.ATT_PHOTO ?? "N"} onChange={set("ATT_PHOTO")}><option value="N">No</option><option value="Y">Offered every time</option><option value="R">Compulsory (camera photo, except excused people)</option></NativeSelect>
            </Field>
            <Field label="Registered laptops only" hint="Y: people check in only from a laptop / phone the admin has approved (their first one registers itself). Excuses and approvals: Laptops & camera page.">
              <NativeSelect value={v.ATT_DEVICE_CHECK ?? "N"} onChange={set("ATT_DEVICE_CHECK")}><option value="N">Any laptop / phone</option><option value="Y">Registered laptops only</option></NativeSelect>
            </Field>
          </div>
        </Section>
        <Button className="w-fit" onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save settings"}</Button>
        <p className="text-xs text-muted-foreground">Reminders, escalations, repeating entries and the morning summary run when the scheduler calls <code>/api/cron/tick</code> (set up in Vercel / any cron service) and also whenever someone has the app open.</p>
      </div>
    </div>
  );
}
