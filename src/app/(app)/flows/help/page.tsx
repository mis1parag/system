"use client";

import Link from "next/link";
import { CalendarCheck2Icon, CheckCircle2Icon, ClipboardCheckIcon, ListChecksIcon, WorkflowIcon } from "lucide-react";
import { PageHeader, Section } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

const TERMS: [string, string][] = [
  ["FMS", "A process with fixed steps, for example “PO dispatch”, “CRM order” or “Hiring”. You define the steps once; every new PO / order / candidate follows them."],
  ["Entry", "One real case inside an FMS — one PO, one order, one candidate."],
  ["Step", "One job inside an entry (for example “Confirm delivery”). Each step has a person, a way (call / mail …) and a planned time."],
  ["Planned vs Actual", "Planned is when the step should be done. Actual is when it was really marked done. The difference is the delay."],
  ["Overdue", "The planned time has passed and the step is not done yet."],
  ["Due today", "The planned time is today and it is not done yet."],
  ["Working days", "Planned times skip weekly-off days (like Sunday) and holidays. “2 days after” means 2 working days."],
  ["Checklist", "Work you repeat — daily, weekly, monthly, yearly or once. The app creates each day's tasks for you; you tick them off."],
  ["Buddy / Backup", "When someone is on leave, their buddy (or backup) gets their work automatically, and it goes back when the leave ends."],
  ["Scorecard", "A weekly report per person: “% work not done” and “% work not done on time”. Lower is better. Green means within the target."],
  ["Approval", "If you need more time for a step you can ask. Your manager or an admin approves or rejects it."],
  ["SLA", "The number of working days an entry should be finished in."],
];

export default function HelpPage() {
  const { isSuper, can } = useFlows();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="How it works" subtitle="Two minutes. Read this once and you know the whole app." />

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        {[
          { icon: CalendarCheck2Icon, title: "1 · Attendance", text: "Check in when you start, check out when you leave. The app asks you, so you cannot forget.", href: "/flows/attendance" },
          { icon: ClipboardCheckIcon, title: "2 · Checklist", text: "Daily, weekly and one-time jobs appear on their own. Tick them when done.", href: "/flows/checklist" },
          { icon: WorkflowIcon, title: "3 · FMS", text: "A process with steps. Each step knows who does it and by when.", href: "/flows" },
        ].map((c) => (
          <Link key={c.title} href={c.href} className="rounded-xl border bg-card p-3 transition-colors hover:border-primary/40">
            <c.icon className="mb-1.5 size-5 text-primary" />
            <div className="text-sm font-semibold">{c.title}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.text}</p>
          </Link>
        ))}
      </div>

      <Section title="Your day, step by step" className="mb-4">
        <ol className="grid gap-2.5 text-sm">
          {[
            ["Check in.", "When you open the app in the morning it asks you to check in — one tap (a photo is optional). Before you leave, check out. The bar at the top always shows where you stand."],
            ["Open Home.", "The red “Overdue” and amber “Due today” lists show what to do first."],
            ["Do the step, then tap Done.", "You can add a short note or the details the step asks for (docket no., invoice no. …). The next person is told automatically."],
            ["Tick your Checklist.", "Go to Checklist. One tap per task. If a task needs proof, paste a link or a note."],
            ["Need more time? Ask.", "Open My Tasks → “More time”. Pick a new time and a reason. Your manager approves it."],
            ["Going on leave?", "Attendance → Apply for leave. Choose a backup and your work moves to them and comes back after."],
            ["Forgot to check out?", "Next time you open the app it asks when you left. You enter the time and it is saved."],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span><span><b>{t}</b> <span className="text-muted-foreground">{d}</span></span></li>
          ))}
        </ol>
      </Section>

      {(isSuper || can("manageTeam")) && (
        <Section title={isSuper ? "For you as Super Admin" : "For you as Manager"} hint="One-time setup, then the app runs itself." className="mb-4">
          <ul className="grid gap-2 text-sm">
            {[
              ["Add your team", "Team & profiles → Add many. Give each person a department and a reporting manager — people see their own department's work.", "/flows/users"],
              ["Add your processes", "FMS → Add ready-made FMS, or Create FMS. As Super Admin you can switch an FMS off, or show it to some departments only.", "/flows"],
              ["Add the repeating work", "Checklist → type a task at the top, or Paste many. Daily, weekly, monthly — the app creates the dates, skipping Sundays and holidays.", "/flows/checklist"],
              ["Add holidays", "Absence & Holidays → Holidays. All planned times shift automatically.", "/flows/team"],
              ["Watch the week", "Home shows what is late. Scorecard shows who is on time. Approvals shows what needs your decision.", "/flows/panel"],
              ...(isSuper ? [["Control center", "One page that lists what needs fixing (people without a manager, forgotten check-outs…) and the switches that matter: check-in screen, kiosk, photos. Access & roles decides what Managers and Users can do.", "/flows/admin"]] : []),
            ].map(([t, d, h]) => (
              <li key={t} className="flex gap-2"><CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span><Link href={h} className="font-medium text-primary underline">{t}</Link> <span className="text-muted-foreground">— {d}</span></span></li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Words used in the app" className="mb-4">
        <dl className="grid gap-2.5 text-sm">
          {TERMS.map(([k, v]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-xs leading-relaxed text-muted-foreground">{v}</dd></div>)}
        </dl>
      </Section>

      <Section title="Tips & fixes">
        <ul className="grid gap-2 text-sm text-muted-foreground">
          <li><ListChecksIcon className="mr-1.5 inline size-4 text-primary" /><b className="text-foreground">Quick jump:</b> press <kbd className="rounded border px-1 text-xs">Ctrl</kbd> + <kbd className="rounded border px-1 text-xs">K</kbd> (or tap the search icon) to open any page, FMS, person or entry.</li>
          <li><b className="text-foreground">I cannot see a task.</b> It may belong to someone else, or it is waiting for an earlier step. Use the “Anyone” / person filters.</li>
          <li><b className="text-foreground">The planned time looks wrong.</b> Check the holidays and the FMS rule (Edit FMS). An admin can use “Re-plan”.</li>
          <li><b className="text-foreground">I ticked by mistake.</b> In Checklist, tap Undo within 30 minutes. After that ask an admin.</li>
          <li><b className="text-foreground">Forgot PIN.</b> Ask your manager or the Super Admin to set a new one in Team & profiles. You can change it in My profile.</li>
          <li><b className="text-foreground">Phone:</b> add the app to your home screen from the browser menu for a full-screen app.</li>
        </ul>
      </Section>
    </div>
  );
}
