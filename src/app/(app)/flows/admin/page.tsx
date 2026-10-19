"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, KeyRoundIcon, ZapIcon, CheckCircle2Icon, ClipboardCheckIcon, FileClockIcon, HistoryIcon, ScanFaceIcon, SettingsIcon, ShieldCheckIcon, TriangleAlertIcon, UsersIcon, WorkflowIcon, CalendarOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, PageHeader, Pill, Section, Spinner } from "@/components/common";
import { addDays } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";

interface Check { id: string; level: "warn" | "info"; text: string; href: string; action: string }

/** The Super Admin's one screen: what needs attention, the switches that matter most, and a door to every control. */
export default function ControlCenterPage() {
  const { data, isSuper, today, call } = useFlows();
  const [busy, setBusy] = useState("");

  const checks = useMemo<Check[]>(() => {
    if (!data) return [];
    const active = data.users.filter((u) => u.status === "Active");
    const out: Check[] = [];
    const noDept = active.filter((u) => !u.department);
    if (noDept.length) out.push({ id: "dept", level: "warn", text: `${noDept.length} ${noDept.length === 1 ? "person has" : "people have"} no department — they only see their own work`, href: "/flows/users", action: "Set departments" });
    const noBoss = active.filter((u) => !u.managerId && u.role !== "SUPER_ADMIN");
    if (noBoss.length) out.push({ id: "boss", level: "warn", text: `${noBoss.length} ${noBoss.length === 1 ? "person has" : "people have"} no reporting manager — nobody approves their leave or more-time requests except you`, href: "/flows/users", action: "Choose reporting managers" });
    const noId = active.filter((u) => !u.empCode);
    if (noId.length) out.push({ id: "empid", level: "info", text: `${noId.length} ${noId.length === 1 ? "person has" : "people have"} no Employee ID — they cannot use the kiosk or be matched with the attendance sheet`, href: "/flows/users", action: "Add Employee IDs" });
    const open = data.attendance.filter((a) => !a.checkOut && a.date < today && a.date >= addDays(today, -14));
    if (open.length) out.push({ id: "open", level: "warn", text: `${open.length} check-in${open.length === 1 ? "" : "s"} from earlier days never had a check-out (hours are unknown)`, href: "/flows/attendance?tab=today", action: "Open attendance" });
    const leaves = data.leaves.filter((l) => l.status === "Pending");
    if (leaves.length) out.push({ id: "leave", level: "info", text: `${leaves.length} leave request${leaves.length === 1 ? " is" : "s are"} waiting for a decision`, href: "/flows/attendance?tab=leave", action: "Decide" });
    const reqs = data.requests.filter((r) => r.status === "Pending");
    if (reqs.length) out.push({ id: "req", level: "info", text: `${reqs.length} request${reqs.length === 1 ? "" : "s"} for more time ${reqs.length === 1 ? "is" : "are"} waiting`, href: "/flows/approvals", action: "Decide" });
    const off = data.flows.filter((f) => f.status === "Archived");
    if (off.length) out.push({ id: "off", level: "info", text: `${off.length} FMS ${off.length === 1 ? "is" : "are"} switched off (hidden from employees): ${off.slice(0, 3).map((f) => f.name).join(", ")}${off.length > 3 ? "…" : ""}`, href: "/flows", action: "Review" });
    if (!data.holidays.some((h) => h.date >= today)) out.push({ id: "hol", level: "info", text: "No upcoming holidays are added — planned times and attendance will count every day as a working day", href: "/flows/team", action: "Add holidays" });
    return out;
  }, [data, today]);

  if (!data) return null;
  if (!isSuper) return <p className="py-10 text-center text-sm text-muted-foreground">Only the Super Admin can open this page.</p>;
  const s = data.settings;
  const active = data.users.filter((u) => u.status === "Active");
  const flowsOn = data.flows.filter((f) => f.status !== "Archived").length;

  async function setSetting(key: string, value: string, label: string) {
    setBusy(key);
    const r = await call("saveSettings", { settings: { [key]: value } });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Could not save"); else toast.success(`${label} saved`);
  }
  const sel = (key: string, label: string, hint: string, options: [string, string][]) => (
    <Field label={label} hint={hint}>
      <div className="relative"><NativeSelect value={s[key] ?? options[0][0]} disabled={busy === key} onChange={(e) => setSetting(key, e.target.value, label)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>{busy === key && <Spinner className="absolute right-8 top-2.5" />}</div>
    </Field>
  );

  const doors = [
    { href: "/flows/users", icon: UsersIcon, title: "People", text: `${active.length} active · departments, reporting managers, photos, details` },
    { href: "/flows/access", icon: ShieldCheckIcon, title: "Access & roles", text: "What a Manager and a User can do" },
    { href: "/flows", icon: WorkflowIcon, title: "FMS", text: `${flowsOn} on · switch off, choose departments` },
    { href: "/flows/settings", icon: SettingsIcon, title: "Settings", text: "Attendance rules, reminders, scorecard" },
    { href: "/flows/checklist", icon: ClipboardCheckIcon, title: "Checklist tasks", text: "Add, edit and move everyone's repeating work" },
    { href: "/flows/team", icon: CalendarOffIcon, title: "Holidays & absence", text: "Holidays and who covers whom" },
    { href: "/flows/kiosk", icon: ScanFaceIcon, title: "Attendance kiosk", text: "Reception check-in with ID or QR" },
    { href: "/flows/audit", icon: HistoryIcon, title: "Activity log", text: "Every change, who and when" },
    { href: "/flows/vault", icon: KeyRoundIcon, title: "Credential vault", text: "Encrypted shared logins, who can reveal them" },
    { href: "/flows/quick", icon: ZapIcon, title: "Quick access", text: "Company-wide shortcuts for everyone" },
  ];

  return (
    <>
      <PageHeader title="Control center" subtitle="You decide how everything works. Start with what needs your attention." />

      <Section title={checks.length ? `Needs your attention (${checks.length})` : "All set"} hint={checks.length ? "Fix these and the app runs smoothly for everyone." : undefined} className="mb-4">
        {checks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2Icon className="size-4" /> People, departments, reporting managers and attendance all look good.</p>
        ) : (
          <ul className="grid divide-y">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {c.level === "warn" ? <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" /> : <FileClockIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 text-sm">{c.text}</span>
                <Link href={c.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">{c.action} <ArrowRightIcon className="size-3.5" /></Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Section title="Attendance — make sure nobody forgets" hint="Changes apply at once.">
          <div className="grid gap-3 sm:grid-cols-2">
            {sel("ATT_GATE", "Check-in screen", "When someone opens the app on a working day without checking in.", [["required", "Must check in first"], ["prompt", "Ask, they can postpone"], ["off", "Do not ask"]])}
            {sel("ATT_SELF_PUNCH", "Where can people check in?", "Kiosk only = reception PC with the Employee ID.", [["Y", "From their own phone or PC"], ["N", "Only at the office kiosk"]])}
            {sel("ATT_PHOTO", "Camera photo with a check-in", "Compulsory = no check-in without a photo (excused people are listed under Laptops & camera).", [["N", "Not asked"], ["Y", "Offered every time"], ["R", "Compulsory"]])}
            {sel("ATT_DEVICE_CHECK", "Laptops / phones", "Registered only = a person checks in from a laptop the admin approved (their first one registers itself).", [["N", "Any device"], ["Y", "Registered devices only"]])}
            {sel("DIGEST_ENABLED", "Morning summary", "Each person gets their late and due steps by email / WhatsApp if connected.", [["N", "Off"], ["Y", "On, every morning"]])}
          </div>
          <p className="text-xs text-muted-foreground">Reminders: <b>{s.ATT_REMIND_CHECKIN}</b> “you have not checked in” · <b>{s.ATT_REMIND_CHECKOUT}</b> “still checked in”. The check-in screen starts at <b>{s.ATT_GATE_FROM}</b>. Change times in <Link href="/flows/settings" className="text-primary underline">Settings</Link>.</p>
        </Section>

        <Section title="Who sees what" hint="Each role's reach in FMS and attendance. Departments stay separate unless you allow more.">
          <ul className="grid gap-2 text-sm">
            {(data.roles ?? []).filter((r) => r.roleId !== "SUPER_ADMIN").slice(0, 5).map((r) => (
              <li key={r.roleId} className="flex items-center justify-between gap-2"><span>{r.name} <span className="text-xs text-muted-foreground">· {r.people} {r.people === 1 ? "person" : "people"}</span></span><span className="flex gap-1"><Pill tone={r.perms.fms?.s === "all" ? "amber" : "green"}>FMS: {r.perms.fms ? r.perms.fms.s : "none"}</Pill><Pill tone={r.perms.attendance?.s === "all" ? "amber" : "green"}>Attendance: {r.perms.attendance ? r.perms.attendance.s : "none"}</Pill></span></li>
            ))}
            <li className="flex items-center justify-between gap-2 border-t pt-2"><span>Departments in use</span><span className="text-muted-foreground">{data.departments.join(", ") || "none yet"}</span></li>
          </ul>
          <Link href="/flows/access" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Change access <ArrowRightIcon className="size-3.5" /></Link>
        </Section>
      </div>

      <Departments />

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Everything you control</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {doors.map((d) => (
          <Link key={d.href} href={d.href} className="group flex gap-3 rounded-lg border bg-card p-3.5 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)] transition-shadow hover:shadow-[0_2px_8px_rgba(60,66,87,0.14)]">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#efeeff] text-primary"><d.icon className="size-[1.1rem]" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold">{d.title}</span><span className="block text-xs text-muted-foreground">{d.text}</span></span>
          </Link>
        ))}
      </div>
    </>
  );
}

/** Departments in use: how many people, rename or merge. */
function Departments() {
  const { data, call } = useFlows();
  const [edit, setEdit] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = (data?.departments ?? []).map((d) => ({ d, n: data!.users.filter((u) => u.status === "Active" && u.department === d).length }));
  async function go() {
    if (!edit) return;
    setBusy(true);
    const r = await call<{ people: number }>("renameDepartment", edit);
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not rename"); return; }
    toast.success("Department renamed everywhere");
    setEdit(null);
    window.location.reload();
  }
  return (
    <Section title="Departments" hint="Each person belongs to one. People see their own department's work. Rename (or merge into another) here — people, FMS access and checklist tasks follow." className="mb-4">
      <div className="flex flex-wrap gap-2">
        {rows.length === 0 && <span className="text-sm text-muted-foreground">No departments yet — set one on each person.</span>}
        {rows.map(({ d, n }) => (
          <button key={d} onClick={() => setEdit({ from: d, to: d })} className="rounded-md border bg-card px-2.5 py-1.5 text-sm shadow-[0_1px_1px_rgba(26,31,54,0.05)] hover:bg-[#f6f9fc]" title="Rename or merge"><span className="font-medium">{d}</span> <span className="text-muted-foreground">{n}</span></button>
        ))}
      </div>
      {edit && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <Field label={`Rename "${edit.from}" to`} hint="An existing name merges the two."><Input value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} autoFocus /></Field>
          <Button type="submit" disabled={busy || !edit.to.trim() || edit.to === edit.from}>{busy ? <Spinner /> : "Rename"}</Button>
          <Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
        </form>
      )}
    </Section>
  );
}
