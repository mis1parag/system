"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BellRingIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useAttendance } from "@/components/attendance/use-attendance";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, PageHeader, Pill, Progress, StatCard } from "@/components/common";
import { STATUS_LABEL, type DayStatus } from "@/lib/attendance";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { checklistToday, fmsProgress } from "@/lib/progress";

const dayLabel = (d: { status: DayStatus; firstIn: string; lastOut: string; missingOut: boolean }) => (d.status === "leave" ? "On leave" : d.firstIn ? (d.lastOut && !d.missingOut ? "Checked out" : "In") : STATUS_LABEL[d.status] || "—");
const TONE: Record<DayStatus, "green" | "amber" | "red" | "violet" | "gray" | "blue"> = { present: "green", half: "amber", absent: "red", leave: "violet", off: "gray", holiday: "blue", pending: "amber", future: "gray" };

/**
 * The reporting manager's view: the people who report to me (or that the Super Admin gave me), and only what their role lets me see —
 * attendance today, FMS and checklist progress, leave. Salary, notes and vault are never part of this page.
 */
export default function MyTeamPage() {
  const { data, meId, peopleFor, allow, isSuper, userName, today, now } = useFlows();
  const att = useAttendance();
  const [q, setQ] = useState("");
  const me = data?.users.find((u) => u.userId === meId);
  const people = useMemo(() => {
    const ids = new Set([...peopleFor("attendance"), ...peopleFor("fms"), ...peopleFor("checklist")].filter((u) => u.userId !== meId).map((u) => u.userId));
    return [...ids].map((id) => data!.users.find((u) => u.userId === id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [data, peopleFor, meId]);
  const rows = useMemo(() => people.map((u) => {
    const day = att.days(u.userId, today, today)[0];
    return {
      u, day,
      fms: fmsProgress(data?.tasks ?? [], data?.items ?? [], u.userId, now()),
      cl: checklistToday(data?.checklistLog ?? [], u.userId, today),
      leavesWaiting: (data?.leaves ?? []).filter((l) => l.userId === u.userId && l.status === "Pending").length,
    };
  }), [people, att, data, today, now]);
  const shown = rows.filter((r) => !q || `${r.u.name} ${r.u.department}`.toLowerCase().includes(q.toLowerCase()));
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const workingDay = !rows.length || rows.some((r) => r.day && r.day.status !== "off" && r.day.status !== "holiday");
  const canRemind = isSuper || allow("reminders", "create");
  const canSeeAtt = isSuper || allow("attendance", "view");

  if (!data) return null;
  if (!people.length) return <><PageHeader title="My team" subtitle="People who report to you." /><EmptyState title="Nobody reports to you yet" hint="The Super Admin sets each person's reporting manager under Team & profiles. Then they appear here." /></>;
  return (
    <>
      <PageHeader title="My team" subtitle={`${people.length} ${people.length === 1 ? "person" : "people"} you look after${me ? ` — ${me.name}` : ""}`} actions={canRemind && <Link href="/flows/reminders"><Button variant="outline"><BellRingIcon /> Send a reminder</Button></Link>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        <StatCard dense label="In today" value={count((r) => r.day?.firstIn !== "" && !!r.day?.firstIn)} sub={workingDay ? `of ${rows.length}` : "not a working day"} tone="good" href="/flows/attendance?tab=today" />
        <StatCard dense label="Not in yet" value={workingDay ? count((r) => !r.day?.firstIn && r.day?.status !== "leave" && r.day?.status !== "off" && r.day?.status !== "holiday") : 0} tone={count((r) => !r.day?.firstIn && r.day?.status === "pending") ? "warn" : undefined} />
        <StatCard dense label="On leave" value={count((r) => r.day?.status === "leave")} />
        <StatCard dense label="Overdue steps" value={rows.reduce((a, r) => a + r.fms.overdue, 0)} tone={rows.some((r) => r.fms.overdue) ? "bad" : "good"} href="/flows/tasks" />
        <StatCard dense label="Late checklist" value={rows.reduce((a, r) => a + r.cl.late, 0)} tone={rows.some((r) => r.cl.late) ? "warn" : "good"} href="/flows/checklist" />
        <StatCard dense label="Leave to decide" value={rows.reduce((a, r) => a + r.leavesWaiting, 0)} tone={rows.some((r) => r.leavesWaiting) ? "warn" : undefined} href="/flows/attendance?tab=leave" />
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" aria-label="Search" className="mb-3 h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm" />
      <DataTable head={["Person", ...(canSeeAtt ? ["Today"] : []), "FMS work", "Checklist", "Leave", ""]}>
        {shown.map((r) => (
          <tr key={r.u.userId}>
            <td><div className="flex items-center gap-2"><Avatar userId={r.u.userId} size={28} /><div className="min-w-0"><div className="font-medium">{r.u.name}</div><div className="text-[11px] text-muted-foreground">{r.u.department}{r.u.managerId && r.u.managerId !== meId ? ` · via ${userName(r.u.managerId)}` : ""}</div></div></div></td>
            {canSeeAtt && <td>{r.day ? <div className="flex flex-col gap-0.5"><Pill tone={r.day.firstIn && r.day.status !== "leave" ? "green" : TONE[r.day.status]}>{dayLabel(r.day)}</Pill>{r.day.firstIn && <span className="text-[11px] tabular-nums text-muted-foreground">{r.day.firstIn.slice(11, 16) || r.day.firstIn}{r.day.lastOut ? ` – ${r.day.lastOut.slice(11, 16) || r.day.lastOut}` : ""}</span>}</div> : "—"}</td>}
            <td className="min-w-40">{r.fms.state === "none" ? <span className="text-xs text-muted-foreground">No FMS assigned</span> : (
              <div className="grid gap-1"><div className="flex items-center justify-between text-xs"><span>{r.fms.done}/{r.fms.assigned} done</span>{r.fms.overdue > 0 ? <Pill tone="red">{r.fms.overdue} overdue</Pill> : <span className="text-muted-foreground">{r.fms.open} open</span>}</div><Progress value={r.fms.pct} /></div>
            )}</td>
            <td className="text-xs">{r.cl.due === 0 ? <span className="text-muted-foreground">Nothing due</span> : <span>{r.cl.done}/{r.cl.due} done{r.cl.late ? <Pill tone="amber" className="ml-1.5">{r.cl.late} late</Pill> : null}</span>}</td>
            <td className="text-xs">{r.day?.status === "leave" ? <Pill tone="violet">{r.day.leaveType ?? "On leave"}</Pill> : r.leavesWaiting ? <Link href="/flows/attendance?tab=leave" className="text-primary underline">{r.leavesWaiting} to decide</Link> : <span className="text-muted-foreground">—</span>}</td>
            <td className="text-right whitespace-nowrap">
              {canRemind && <Link href={`/flows/reminders?to=${r.u.userId}`} className="mr-2 text-xs text-primary hover:underline">Remind</Link>}
              {canSeeAtt && <Link href={`/flows/attendance?tab=me&person=${r.u.userId}`} className="text-xs text-primary hover:underline">Attendance</Link>}
            </td>
          </tr>
        ))}
      </DataTable>
      <p className="mt-3 text-xs text-muted-foreground">As of {fmtDate(today, true)}. You see the people who report to you, directly or through someone below you{isSuper ? "" : ", or people the Super Admin has added to your access"}.</p>
    </>
  );
}
