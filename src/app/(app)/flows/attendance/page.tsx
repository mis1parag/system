"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlusIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/avatar";
import { DataTable, EmptyState, Hint, PageHeader, Pill, Section, StatCard } from "@/components/common";
import { DataGrid, type Col } from "@/components/data-grid";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { applyFilters, type FieldDef } from "@/lib/filters";
import { DayDialog, LeaveDialog } from "@/components/attendance/attendance-dialogs";
import { MarkTab } from "@/components/attendance/mark-tab";
import { useAttendance } from "@/components/attendance/use-attendance";
import { fmtHours, STATUS_LABEL, type DayStatus } from "@/lib/attendance";
import { BalanceLine, LeaveYearPanel, useYearBalance } from "@/components/attendance/leave-year";
import { SalaryPanel } from "@/components/payroll/salary-panel";
import { addMonths, fmtDate, fmtMonth, monthEnd, monthStart } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { pct1 } from "@/lib/format";
import { cn } from "@/lib/utils";

const CELL: Record<DayStatus, string> = {
  present: "bg-emerald-100 text-emerald-800 border-emerald-200", half: "bg-amber-100 text-amber-800 border-amber-200", absent: "bg-red-100 text-red-800 border-red-200",
  leave: "bg-violet-100 text-violet-800 border-violet-200", off: "bg-muted text-muted-foreground/70 border-transparent", holiday: "bg-sky-100 text-sky-800 border-sky-200",
  pending: "bg-card text-muted-foreground border-dashed", future: "bg-transparent text-muted-foreground/40 border-transparent",
};
const LEAVE_TONE = { Pending: "amber", Approved: "green", Rejected: "red", Cancelled: "gray" } as const;

export default function AttendancePage() {
  const { meId, peopleFor, has, userById } = useFlows();
  const empCode = userById(meId)?.empCode ?? "";
  const people = peopleFor("attendance");
  const sp = useSearchParams();
  const [tabPick, setTab] = useState<string | null>(null);
  const [person, setPerson] = useState(sp.get("person") ?? "");
  const tab = tabPick ?? sp.get("tab") ?? "mark";
  const sees = people.length > 1; // somebody else is in reach (a manager's team, a department)
  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Mark your attendance, see your month, apply for leave.${empCode ? ` Your Employee ID: ${empCode}` : ""}`}
        help={{ id: "attendance", title: "How attendance is counted", text: "6 hours or more = a full day, 4 hours or more = a half day, less = absent. Check-in after 09:30 is late, check-out before 17:00 is early. Sundays and holidays are not working days (Sunday work of 4 hours+ counts as overtime). All of this can be changed in Settings." }}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="mb-3 overflow-x-auto"><TabsList>
          <TabsTrigger value="mark">Mark attendance</TabsTrigger>
          <TabsTrigger value="me">{person && person !== meId ? "Their month" : "My month"}</TabsTrigger>
          {sees && <TabsTrigger value="today">Team today</TabsTrigger>}
          {sees && <TabsTrigger value="report">Monthly report</TabsTrigger>}
          <TabsTrigger value="leave">Leave</TabsTrigger>
          {has("payroll") && <TabsTrigger value="salary">Salary slip</TabsTrigger>}
        </TabsList></div>
        <TabsContent value="mark"><MarkTab /></TabsContent>
        <TabsContent value="me"><MyMonth person={person || meId} onPerson={setPerson} /></TabsContent>
        {sees && <TabsContent value="today"><Today onOpen={(id) => { setPerson(id); setTab("me"); }} /></TabsContent>}
        {sees && <TabsContent value="report"><Report onOpen={(id) => { setPerson(id); setTab("me"); }} /></TabsContent>}
        <TabsContent value="leave"><Leave /></TabsContent>
        {has("payroll") && <TabsContent value="salary"><SalaryPanel /></TabsContent>}
      </Tabs>
    </>
  );
}

function MonthNav({ month, onChange, max }: { month: string; onChange: (m: string) => void; max: string }) {
  return (
    <div className="inline-flex items-center rounded-lg border bg-card">
      <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))}><ChevronLeftIcon /></Button>
      <span className="min-w-28 px-2 text-center text-sm font-medium">{fmtMonth(month)}</span>
      <Button size="icon-sm" variant="ghost" aria-label="Next month" disabled={month >= max} onClick={() => onChange(addMonths(month, 1))}><ChevronRightIcon /></Button>
    </div>
  );
}

function MyMonth({ person, onPerson }: { person: string; onPerson: (id: string) => void }) {
  const { data, meId, peopleFor, today, userName, holidayName } = useFlows();
  const people = peopleFor("attendance");
  const att = useAttendance();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState("");
  const from = monthStart(month), to = monthEnd(month);
  const rep = useMemo(() => att.person(person, from, to), [att, person, from, to]);
  const lead = (new Date(from + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday first
  const u = data?.users.find((x) => x.userId === person);
  const bal = useYearBalance(person, month.slice(0, 4));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MonthNav month={month} onChange={setMonth} max={today.slice(0, 7)} />
        {people.length > 1 && <NativeSelect className="w-44" value={person} onChange={(e) => onPerson(e.target.value === meId ? "" : e.target.value)} aria-label="Whose attendance">{people.map((x) => <option key={x.userId} value={x.userId}>{x.userId === meId ? "Me" : x.name}</option>)}</NativeSelect>}
        {u?.empCode && <span className="text-xs text-muted-foreground">ID {u.empCode}</span>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <StatCard dense label={<>Attendance <Hint>(full days + ½ × half days) ÷ working days.</Hint></>} value={rep.workingDays ? pct1(rep.attendancePct) : "—"} tone={rep.workingDays ? (rep.attendancePct >= 95 ? "good" : rep.attendancePct >= 85 ? "warn" : "bad") : undefined} />
        <StatCard dense label="Present" value={rep.present} sub={`${rep.half} half · ${rep.workingDays} working`} />
        <StatCard dense label="Absent" value={rep.absent} tone={rep.absent ? "bad" : "good"} />
        <StatCard dense label="On leave" value={rep.leave} />
        <StatCard dense label={<>Late <Hint>First check-in after {att.set.lateAfter}.</Hint></>} value={rep.late} tone={rep.late > 2 ? "warn" : undefined} />
        <StatCard dense label={<>Early out <Hint>Last check-out before {att.set.earlyBefore}.</Hint></>} value={rep.early} />
        <StatCard dense label={<>On-time arrival <Hint>Days present without being late.</Hint></>} value={rep.present + rep.half ? pct1(rep.onTimePct) : "—"} />
        <StatCard dense label="Hours worked" value={fmtHours(rep.totalHours)} sub={rep.overtime ? `${rep.overtime} overtime day${rep.overtime > 1 ? "s" : ""}` : `${pct1(rep.hoursPct)} of normal`} />
      </div>
      <Section title={`${userName(person)} · ${fmtMonth(month)}`} hint="Tap a day to see the punches. Admins can correct them there.">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
          {rep.days.map((d) => (
            <button key={d.date} onClick={() => d.status !== "future" && setDay(d.date)} disabled={d.status === "future"} title={`${fmtDate(d.date, true)} — ${d.status === "holiday" ? holidayName(d.date) : STATUS_LABEL[d.status]}${d.hours ? ` · ${fmtHours(d.hours)}` : ""}${d.firstIn ? ` · ${d.firstIn.slice(11)}–${d.lastOut ? d.lastOut.slice(11) : "…"}` : ""}`}
              className={cn("flex min-h-14 flex-col items-center justify-start gap-0.5 rounded-lg border p-1 text-xs", CELL[d.status], d.date === today && "ring-2 ring-primary")}>
              <span className="font-semibold">{Number(d.date.slice(8))}</span>
              {d.status === "holiday" && <span className="line-clamp-2 text-[9px] font-medium leading-tight">{holidayName(d.date)}</span>}
              {d.status !== "future" && d.status !== "off" && d.status !== "holiday" && <span className="text-[10px] leading-tight">{d.hours ? fmtHours(d.hours).replace(" ", "") : STATUS_LABEL[d.status]}</span>}
              <span className="flex gap-0.5 text-[9px] leading-none">{d.late && "L"}{d.early && "E"}{d.overtime && "OT"}{d.missingOut && "?"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          {(["present", "half", "absent", "leave", "holiday", "off", "pending"] as DayStatus[]).map((s) => <span key={s} className="flex items-center gap-1"><span className={cn("size-3 rounded border", CELL[s])} />{STATUS_LABEL[s]}</span>)}
          <span>L = late · E = early out · OT = overtime · ? = no check-out</span>
        </div>
      </Section>
      <div className="mt-3"><BalanceLine b={bal} year={month.slice(0, 4)} /></div>
      {day && <DayDialog userId={person} date={day} onClose={() => setDay("")} />}
    </>
  );
}

function Today({ onOpen }: { onOpen: (id: string) => void }) {
  const { today, peopleFor, allow, userById } = useFlows();
  const att = useAttendance();
  const [fix, setFix] = useState("");
  const [fstate, setFstate] = useFilters("attendance:today", "all");
  const people = peopleFor("attendance");
  const rows = useMemo(() => people.map((u) => {
    const d = att.days(u.userId, today, today)[0];
    const punches = att.rows.filter((r) => r.userId === u.userId && r.date === today);
    const open = punches.find((r) => !r.checkOut);
    const state = open ? "in" : d.status === "present" || d.status === "half" ? "out" : d.status === "leave" ? "leave" : d.status === "holiday" || d.status === "off" ? "off" : d.status === "absent" ? "absent" : "notyet";
    return { u, d, open, state };
  }), [people, att, today]);
  type R = (typeof rows)[number];
  const fields: FieldDef<R>[] = [
    { key: "dept", label: "Department", type: "select", options: [...new Set(rows.map((r) => r.u.department).filter(Boolean))].sort().map((d) => ({ value: String(d), label: String(d) })), get: (r) => r.u.department },
    { key: "state", label: "Status", type: "select", options: [{ value: "in", label: "Working now" }, { value: "out", label: "Done for the day" }, { value: "notyet", label: "Not in yet" }, { value: "absent", label: "Absent" }, { value: "leave", label: "On leave" }, { value: "off", label: "Off today" }], get: (r) => r.state },
    { key: "late", label: "Late today", type: "select", options: [{ value: "yes", label: "Yes" }], get: (r) => (r.d.late ? "yes" : "") },
    { key: "person", label: "Person", type: "user", options: rows.map((r) => ({ value: r.u.userId, label: r.u.name })), get: (r) => r.u.userId },
  ];
  const quickFns: Record<string, (r: R) => boolean> = { all: () => true, in: (r) => r.state === "in", notyet: (r) => r.state === "notyet", late: (r) => r.d.late, absent: (r) => r.state === "absent", leave: (r) => r.state === "leave" };
  const count = (id: string) => rows.filter(quickFns[id]).length;
  const quick: QuickDef[] = [{ id: "all", label: "Today", count: rows.length }, { id: "in", label: "Working now", count: count("in") }, { id: "notyet", label: "Not in yet", count: count("notyet") }, { id: "late", label: "Late", count: count("late") }, { id: "absent", label: "Absent", count: count("absent") }, { id: "leave", label: "On leave", count: count("leave") }];
  const shown = applyFilters(rows, fields, fstate, { quick: quickFns, text: (r) => `${r.u.name} ${r.u.department ?? ""} ${r.u.empCode ?? ""}` });
  const order = { in: 0, out: 1, notyet: 2, absent: 3, leave: 4, off: 5 } as Record<string, number>;
  const label = (s: string) => (s === "in" ? "Working" : s === "out" ? "Done for the day" : s === "absent" ? "Absent" : s === "notyet" ? "Not in yet" : s === "leave" ? "On leave" : "Off today");
  const cols: Col<R>[] = [
    { id: "person", label: "Person", sort: (r) => r.u.name, render: (r) => <button className="flex items-center gap-2 text-left font-medium hover:text-primary" onClick={() => onOpen(r.u.userId)}><Avatar userId={r.u.userId} size={24} />{r.u.name}</button>, csv: (r) => r.u.name },
    { id: "dept", label: "Department", sort: (r) => r.u.department ?? "", render: (r) => <span className="text-muted-foreground">{r.u.department || "—"}</span> },
    { id: "status", label: "Status", sort: (r) => order[r.state], render: (r) => <><Pill tone={r.state === "in" ? "green" : r.state === "out" ? "blue" : r.state === "absent" ? "red" : r.state === "notyet" ? "amber" : r.state === "leave" ? "violet" : "gray"}>{label(r.state)}</Pill>{r.d.late && <Pill tone="amber" className="ml-1">late</Pill>}</>, csv: (r) => label(r.state) },
    { id: "in", label: "In", sort: (r) => r.d.firstIn, render: (r) => <span className="tabular-nums">{r.d.firstIn ? r.d.firstIn.slice(11) : "—"}</span>, csv: (r) => r.d.firstIn.slice(11) },
    { id: "out", label: "Out", sort: (r) => r.d.lastOut, render: (r) => <span className="tabular-nums">{r.open ? "…" : r.d.lastOut ? r.d.lastOut.slice(11) : "—"}</span>, csv: (r) => r.d.lastOut.slice(11) },
    { id: "hours", label: "Hours", sort: (r) => r.d.hours, render: (r) => <span className="tabular-nums">{r.d.hours ? fmtHours(r.d.hours) : "—"}</span>, csv: (r) => r.d.hours },
    { id: "empCode", label: "Employee ID", hidden: true, sort: (r) => r.u.empCode ?? "", render: (r) => <span className="text-xs">{r.u.empCode || "—"}</span> },
    { id: "act", label: "", render: (r) => <button className="text-xs text-primary underline" onClick={() => setFix(r.u.userId)}>{allow("attendance", "edit") && userById(r.u.userId) ? (r.state === "absent" || r.state === "notyet" ? "add punch" : "edit") : "view"}</button> },
  ];
  return (
    <>
      <FilterBar page="attendance:today" module="attendance" fields={fields} quick={quick} state={fstate} onChange={setFstate} shown={shown.length} total={rows.length} placeholder="Search person or department…" />
      <DataGrid id="att-today" columns={cols} rows={[...shown].sort((a, b) => order[a.state] - order[b.state] || a.u.name.localeCompare(b.u.name))} rowKey={(r) => r.u.userId} exportAs={{ name: `attendance-${today}`, module: "attendance" }} empty={<EmptyState title="Nobody matches" hint="Change or clear the filters." />} />
      <p className="mt-2 text-xs text-muted-foreground">Showing {shown.length} of {rows.length} active people for {fmtDate(today, true)}. “Not in yet” becomes “absent” after 6:30 PM.</p>
      {fix && <DayDialog userId={fix} date={today} onClose={() => setFix("")} />}
    </>
  );
}

function Report({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, today, inReach } = useFlows();
  const att = useAttendance();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [fstate, setFstate] = useFilters("attendance:report", "all");
  const people = (data?.users ?? []).filter((u) => inReach(u.userId, "attendance") && (u.status === "Active" || att.rows.some((r) => r.userId === u.userId && r.date.startsWith(month))));
  const from = monthStart(month), to = monthEnd(month);
  const reps = useMemo(() => att.team(people.map((u) => u.userId), from, to).map((r) => ({ r, u: people.find((p) => p.userId === r.userId)! })).filter(({ r }) => r.workingDays > 0 || r.totalHours > 0), [att, people, from, to]);
  type R = (typeof reps)[number];
  const fields: FieldDef<R>[] = [
    { key: "dept", label: "Department", type: "select", options: [...new Set(reps.map((x) => x.u.department).filter(Boolean))].sort().map((d) => ({ value: String(d), label: String(d) })), get: (x) => x.u.department },
    { key: "person", label: "Person", type: "user", options: reps.map((x) => ({ value: x.u.userId, label: x.u.name })), get: (x) => x.u.userId },
    { key: "manager", label: "Reporting manager", type: "user", options: (data?.users ?? []).map((u) => ({ value: u.userId, label: u.name })), get: (x) => x.u.managerId },
  ];
  const quickFns: Record<string, (x: R) => boolean> = { all: () => true, low: (x) => x.r.workingDays > 0 && x.r.attendancePct < 85, late: (x) => x.r.late >= 3, absent: (x) => x.r.absent > 0, leave: (x) => x.r.leave > 0 };
  const quick: QuickDef[] = [{ id: "all", label: "Everyone", count: reps.length }, { id: "low", label: "Attendance below 85%", count: reps.filter(quickFns.low).length }, { id: "late", label: "Late 3+ days", count: reps.filter(quickFns.late).length }, { id: "absent", label: "Any absent", count: reps.filter(quickFns.absent).length }, { id: "leave", label: "On leave this month", count: reps.filter(quickFns.leave).length }];
  const shown = applyFilters(reps, fields, fstate, { quick: quickFns, text: (x) => `${x.u.name} ${x.u.department ?? ""} ${x.u.empCode ?? ""}` });
  const avg = shown.length ? shown.reduce((a, x) => a + x.r.attendancePct, 0) / shown.length : 0;
  const cols: Col<R>[] = [
    { id: "name", label: "Name", sort: (x) => x.u.name, render: (x) => <button className="flex items-center gap-2 text-left font-medium hover:text-primary" onClick={() => onOpen(x.u.userId)}><Avatar userId={x.u.userId} size={24} />{x.u.name}</button>, csv: (x) => x.u.name },
    { id: "empCode", label: "ID", sort: (x) => x.u.empCode ?? "", render: (x) => <span className="text-xs text-muted-foreground">{x.u.empCode || "—"}</span> },
    { id: "dept", label: "Department", hidden: true, sort: (x) => x.u.department ?? "", render: (x) => <span className="text-muted-foreground">{x.u.department || "—"}</span> },
    { id: "pct", label: "Attendance", sort: (x) => x.r.attendancePct, render: (x) => <span className={cn("font-semibold tabular-nums", x.r.attendancePct >= 95 ? "text-emerald-700" : x.r.attendancePct >= 85 ? "text-amber-700" : "text-red-700")}>{pct1(x.r.attendancePct)}</span>, csv: (x) => x.r.attendancePct },
    { id: "present", label: "Present", sort: (x) => x.r.present, render: (x) => <span className="tabular-nums">{x.r.present}</span>, csv: (x) => x.r.present, align: "right" },
    { id: "half", label: "Half", sort: (x) => x.r.half, render: (x) => <span className="tabular-nums">{x.r.half}</span>, csv: (x) => x.r.half, align: "right" },
    { id: "absent", label: "Absent", sort: (x) => x.r.absent, render: (x) => <span className={cn("tabular-nums", x.r.absent && "font-medium text-red-700")}>{x.r.absent}</span>, csv: (x) => x.r.absent, align: "right" },
    { id: "leave", label: "Leave", sort: (x) => x.r.leave, render: (x) => <span className="tabular-nums">{x.r.leave}</span>, csv: (x) => x.r.leave, align: "right" },
    { id: "late", label: "Late", sort: (x) => x.r.late, render: (x) => <span className="tabular-nums">{x.r.late}</span>, csv: (x) => x.r.late, align: "right" },
    { id: "early", label: "Early", hidden: true, sort: (x) => x.r.early, render: (x) => <span className="tabular-nums">{x.r.early}</span>, csv: (x) => x.r.early, align: "right" },
    { id: "ot", label: "OT", hidden: true, sort: (x) => x.r.overtime, render: (x) => <span className="tabular-nums">{x.r.overtime}</span>, csv: (x) => x.r.overtime, align: "right" },
    { id: "hours", label: "Hours", sort: (x) => x.r.totalHours, render: (x) => <span className="tabular-nums">{x.r.totalHours.toFixed(1)}</span>, csv: (x) => x.r.totalHours, align: "right" },
    { id: "ontime", label: "On-time arrival", sort: (x) => x.r.onTimePct, render: (x) => <span className="tabular-nums">{x.r.present + x.r.half ? pct1(x.r.onTimePct) : "—"}</span>, csv: (x) => x.r.onTimePct },
  ];
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2"><MonthNav month={month} onChange={setMonth} max={today.slice(0, 7)} /><span className="text-xs text-muted-foreground">Average attendance {pct1(avg)}</span></div>
      <FilterBar page="attendance:report" module="attendance" fields={fields} quick={quick} state={fstate} onChange={setFstate} shown={shown.length} total={reps.length} placeholder="Search person or department…" />
      <DataGrid id="att-report" columns={cols} rows={[...shown].sort((a, b) => b.r.attendancePct - a.r.attendancePct)} rowKey={(x) => x.u.userId} exportAs={{ name: `attendance-${month}`, module: "attendance" }} empty={<EmptyState title="No attendance in this month" hint="Punches appear here as people check in." />} />
    </>
  );
}

function Leave() {
  const { data, meId, isSuper, userName, call, today, can, inReach } = useFlows();
  const att = useAttendance();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [year, setYear] = useState(today.slice(0, 4));
  const mine = [...att.leaves].filter((l) => l.userId === meId && l.startDate.slice(0, 4) <= year && l.endDate.slice(0, 4) >= year).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const stamp = att.leaves.map((l) => l.leaveId + l.status).join("|");
  const canDecide = (uid: string) => isSuper || data?.users.find((u) => u.userId === uid)?.managerId === meId || (can("approveLeave") && inReach(uid));
  const waiting = att.leaves.filter((l) => l.status === "Pending" && l.userId !== meId && canDecide(l.userId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const recent = can("approveLeave") ? [...att.leaves].filter((l) => l.userId !== meId && l.status !== "Pending").sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 25) : [];

  async function act(leaveId: string, kind: "approve" | "reject" | "cancel") {
    setBusy(leaveId);
    const r = kind === "cancel" ? await call("cancelLeave", { leaveId }) : await call("decideLeave", { leaveId, approve: kind === "approve", note: note[leaveId] ?? "" });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Failed"); else toast.success(kind === "approve" ? "Approved" : kind === "reject" ? "Rejected" : "Cancelled");
  }
  const when = (l: { startDate: string; endDate: string }) => `${fmtDate(l.startDate)}${l.endDate !== l.startDate ? ` – ${fmtDate(l.endDate)}` : ""}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3"><Button onClick={() => setAsking(true)}><CalendarPlusIcon /> Ask for leave</Button></div>
      <LeaveYearPanel year={year} onYear={setYear} refreshKey={stamp} />
      {waiting.length > 0 && (
        <Section title={`Waiting for your decision (${waiting.length})`}>
          <div className="grid gap-2">{waiting.map((l) => (
            <div key={l.leaveId} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{userName(l.userId)} <span className="font-normal text-muted-foreground">· {l.type} · {when(l)} · {l.days} day{l.days === 1 ? "" : "s"}</span></span></div>
              <p className="mt-0.5 text-xs text-muted-foreground">“{l.reason}”{l.backupUserId ? ` · backup ${userName(l.backupUserId)}` : ""}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input className="h-9 min-w-40 flex-1" placeholder="Note (optional)" value={note[l.leaveId] ?? ""} onChange={(e) => setNote({ ...note, [l.leaveId]: e.target.value })} />
                <Button size="sm" className="h-9" disabled={busy === l.leaveId} onClick={() => act(l.leaveId, "approve")}><CheckIcon /> Approve</Button>
                <Button size="sm" variant="outline" className="h-9 text-red-700" disabled={busy === l.leaveId} onClick={() => act(l.leaveId, "reject")}><XIcon /> Reject</Button>
              </div>
            </div>
          ))}</div>
        </Section>
      )}
      <Section title={`My leave requests ${year}`}>
        {mine.length === 0 ? <p className="py-3 text-center text-sm text-muted-foreground">No requests yet.</p> : (
          <div className="grid gap-1.5">{mine.slice(0, 30).map((l) => (
            <div key={l.leaveId} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Pill tone={LEAVE_TONE[l.status]}>{l.status}</Pill><span className="font-medium">{l.type}</span><span className="text-muted-foreground">{when(l)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{l.reason}{l.note ? ` — ${l.note}` : ""}</span>
              {l.status === "Pending" && <button className="text-xs text-red-700 underline" disabled={busy === l.leaveId} onClick={() => act(l.leaveId, "cancel")}>cancel</button>}
            </div>
          ))}</div>
        )}
      </Section>
      {recent.length > 0 && (
        <Section title="Recent decisions (my team)">
          <DataTable head={["Person", "Type", "When", "Days", "Status"]}>
            {recent.map((l) => <tr key={l.leaveId}><td className="font-medium">{userName(l.userId)}</td><td>{l.type}</td><td className="whitespace-nowrap text-xs">{when(l)}</td><td className="tabular-nums">{l.days}</td><td><Pill tone={LEAVE_TONE[l.status]}>{l.status}</Pill></td></tr>)}
          </DataTable>
        </Section>
      )}
      {asking && <LeaveDialog onClose={() => setAsking(false)} />}
    </div>
  );
}

