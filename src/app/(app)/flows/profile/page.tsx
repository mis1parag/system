"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, PageHeader, Section, Spinner } from "@/components/common";
import { ProfileEditor } from "@/components/people/profile-editor";
import { useFlows } from "@/lib/flow-store";
import { ROLE_LABEL, type Role } from "@/lib/types";

const CHANNELS = [
  { id: "app", label: "In the app (bell icon)" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
];

export default function ProfilePage() {
  const { data, call, userName } = useFlows();
  const me = data!.me;
  const [notify, setNotify] = useState<string[]>((me.notify || "app").split(",").filter(Boolean));
  const [email, setEmail] = useState(me.email ?? "");
  const [cur, setCur] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function saveAlerts() {
    setBusy("alerts"); setErr("");
    const r = await call("updateProfile", { notify: notify.join(",") || "app", email });
    setBusy("");
    if (!r.ok) setErr(r.error || "Could not save"); else toast.success("Saved");
  }
  async function changePin() {
    setErr("");
    if (pin !== pin2) { setErr("The two new PINs do not match"); return; }
    setBusy("pin");
    const r = await call("updateProfile", { currentPin: cur, newPin: pin });
    setBusy("");
    if (!r.ok) { setErr(r.error || "Could not change the PIN"); return; }
    setCur(""); setPin(""); setPin2("");
    toast.success("PIN changed");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My profile" subtitle={`${me.name}${(me as { empCode?: string }).empCode ? ` · ID ${(me as { empCode?: string }).empCode}` : ""} · ${ROLE_LABEL[me.role as Role]}${me.department ? ` · ${me.department}` : ""}${me.managerId ? ` · reporting manager ${userName(me.managerId)}` : ""}`} />
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="grid gap-4">
        <Section title="My photo and details" hint="Your picture shows next to your name everywhere. Your personal details are seen only by you and the people allowed to see employee details."><ProfileEditor userId={me.userId} /></Section>
        <Section title="How should we alert you?" hint="Reminders before a step is due, overdue alerts, approvals and backup assignments.">
          <div className="grid gap-1.5">
            {CHANNELS.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-input" checked={notify.includes(c.id)} onChange={(e) => setNotify(e.target.checked ? [...notify, c.id] : notify.filter((x) => x !== c.id))} /> {c.label}
              </label>
            ))}
          </div>
          <Field label="Email" hint="Needed for email alerts"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Email and WhatsApp only work after your admin has connected them (SMTP / WhatsApp webhook). The in-app bell always works.</p>
          <Button className="w-fit" onClick={saveAlerts} disabled={busy === "alerts"}>{busy === "alerts" ? <Spinner /> : "Save"}</Button>
        </Section>
        <Section title="Change my PIN" hint="4–8 digits. After 5 wrong attempts an account is locked for 15 minutes.">
          <Field label="Current PIN"><Input type="password" inputMode="numeric" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="New PIN"><Input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
          <Field label="New PIN again"><Input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value)} /></Field>
          <Button className="w-fit" onClick={changePin} disabled={busy === "pin" || !cur || !pin}>{busy === "pin" ? <Spinner /> : "Change PIN"}</Button>
        </Section>
      </div>
    </div>
  );
}
