"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlusIcon, CameraIcon, CameraOffIcon, CheckCircle2Icon, ClockIcon, LogInIcon, LogOutIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { CameraView, useCamera } from "@/components/attendance/camera";
import { DeviceNotice } from "@/components/attendance/device-notice";
import { LeaveDialog } from "@/components/attendance/attendance-dialogs";
import { usePunch } from "@/components/attendance/punch-card";
import { useAttendance } from "@/components/attendance/use-attendance";
import { Pill, Section, Spinner, StatCard } from "@/components/common";
import { fmtHours, STATUS_LABEL } from "@/lib/attendance";
import { BalanceLine, useYearBalance } from "@/components/attendance/leave-year";
import { addMinutes, fmtDate, monthEnd, monthStart } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { pct1 } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Mark my attendance": check in / out with an optional photo, today's status worked out live, this month, and leave. */
export function MarkTab() {
  const { meId, today, now, holidayName } = useFlows();
  const att = useAttendance();
  const p = usePunch();
  const [photoPick, setPhotoOn] = useState(false);
  const [asking, setAsking] = useState(false);
  const photoOn = p.cameraRequired || photoPick;
  const cam = useCamera(photoOn);
  const n = now();
  // the clock on the card
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);

  const day = att.days(meId, today, today)[0];
  const rep = useMemo(() => att.person(meId, monthStart(today.slice(0, 7)), today), [att, meId, today]);
  const bal = useYearBalance(meId, today.slice(0, 4));
  const myLeaves = [...att.leaves].filter((l) => l.userId === meId).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 3);

  const liveH = p.liveMin / 60;
  const { fullHours, halfHours } = att.set;
  const off = day.status === "off" || day.status === "holiday";
  const live = off ? (liveH > 0 ? "Working on a day off" : day.status === "holiday" ? `Holiday — ${holidayName(today)}` : STATUS_LABEL[day.status]) : liveH >= fullHours ? "Present (full day)" : liveH >= halfHours ? "Half day so far" : p.state === "out" ? "Not checked in" : "In progress";
  const liveTone = liveH >= fullHours ? "green" : liveH >= halfHours ? "amber" : p.state === "out" ? "gray" : "blue";
  const toFull = Math.max(0, fullHours * 60 - p.liveMin);
  const fullAt = p.open && toFull > 0 ? addMinutes(n, toFull).slice(11) : "";
  const barPct = Math.min(100, (liveH / fullHours) * 100);
  const wantPhoto = photoOn && cam.state === "ready";

  async function go() { await p.punch(wantPhoto ? cam.snap() : ""); }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="grid content-start gap-4 lg:col-span-3">
        <Section title="Mark my attendance" hint={`${fmtDate(today, true)} · ${n.slice(11, 16)}`}>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={p.state === "in" ? "green" : p.state === "done" ? "blue" : "gray"}>{p.state === "in" ? `Working since ${p.open!.checkIn.slice(11)}` : p.state === "done" ? "Day finished" : "Not checked in yet"}</Pill>
              {day.late && <Pill tone="amber">Late today ({day.firstIn.slice(11)})</Pill>}
              {(p.open?.lat ?? p.mine[0]?.lat) != null && <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><MapPinIcon className="size-3" /> location saved</span>}
            </div>

            <DeviceNotice />
            {p.kioskOnly ? (
              <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>Check-in and check-out are done at the office kiosk (show or type your Employee ID there). Everything else on this page still works.</p><Link href="/flows/kiosk" className={cn(buttonVariants({ size: "lg" }), "h-11 w-fit text-base")}><LogInIcon /> Check in at the office kiosk</Link></div>
            ) : (
              <>
                <div>
                  <button type="button" onClick={() => !p.cameraRequired && setPhotoOn((v) => !v)} aria-pressed={photoOn} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", photoOn ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
                    {photoOn ? <CameraIcon className="size-3.5" /> : <CameraOffIcon className="size-3.5" />} {photoOn ? (p.cameraRequired ? "Camera photo is compulsory" : "Photo on — tap to turn off") : p.photoByDefault ? "Add a photo (your office likes one — still optional)" : "Add a photo (optional)"}
                  </button>
                  {photoOn && <CameraView videoRef={cam.videoRef} state={cam.state} className="mt-2 aspect-[4/3] w-full max-w-sm" />}
                  {p.cameraRequired && cam.state === "unavailable" && <p role="alert" className="mt-2 text-xs text-red-700">The camera is compulsory but could not start. Allow the camera for this site in your browser, then reload. If your camera does not work, ask the Super Admin to excuse you.</p>}
                </div>
                <Button onClick={go} disabled={p.busy || (p.cameraRequired && !wantPhoto)} size="lg" variant={p.state === "in" ? "outline" : "default"} className={cn("h-14 w-full max-w-sm text-base", p.state === "in" && "border-red-200 text-red-700 hover:bg-red-50")}>
                  {p.busy ? <Spinner /> : p.state === "in" ? <><LogOutIcon /> Check out{wantPhoto ? " with photo" : ""}</> : <><LogInIcon /> {p.state === "done" ? "Check in again" : "Check in"}{wantPhoto ? " with photo" : ""}</>}
                </Button>
              </>
            )}

            {p.mine.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {p.mine.map((r) => (
                  <li key={r.attId} className="flex flex-wrap items-center gap-x-2 rounded-lg border px-3 py-1.5">
                    <ClockIcon className="size-3.5 text-muted-foreground" /><span className="font-medium tabular-nums">{r.checkIn.slice(11)} → {r.checkOut ? r.checkOut.slice(11) : "now"}</span>
                    <span className="text-xs text-muted-foreground">{r.source === "kiosk" ? "kiosk" : r.source === "manual" ? "added by a manager" : "app"}{r.inPhoto || r.outPhoto ? " · photo saved" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="This month, counted for you" hint="Worked out from your check-ins, leaves and the holidays — nobody has to enter it.">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatCard dense label="Attendance" value={rep.workingDays ? pct1(rep.attendancePct) : "—"} tone={rep.workingDays ? (rep.attendancePct >= 95 ? "good" : rep.attendancePct >= 85 ? "warn" : "bad") : undefined} sub={`${rep.workingDays} working days`} />
            <StatCard dense label="Present" value={rep.present} sub={`${rep.half} half day${rep.half === 1 ? "" : "s"}`} tone="good" />
            <StatCard dense label="Absent" value={rep.absent} tone={rep.absent ? "bad" : "good"} sub={`${rep.leave} on leave`} />
            <StatCard dense label="Late arrivals" value={rep.late} tone={rep.late > 2 ? "warn" : undefined} sub={rep.present + rep.half ? `${pct1(rep.onTimePct)} on time` : undefined} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{fmtHours(rep.totalHours)} worked between {fmtDate(monthStart(today.slice(0, 7)))} and {fmtDate(monthEnd(today.slice(0, 7)) < today ? monthEnd(today.slice(0, 7)) : today)}.</p>
        </Section>
      </div>

      <div className="grid content-start gap-4 lg:col-span-2">
        <Section title="Today — present or not?" hint="Decided by the hours you work">
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Worked so far</span><b className="tabular-nums">{fmtHours(liveH)}</b></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(barPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Hours worked towards a full day">
              <div className={cn("h-full rounded-full transition-all", liveH >= fullHours ? "bg-emerald-500" : liveH >= halfHours ? "bg-amber-500" : "bg-sky-500")} style={{ width: `${barPct}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>0</span><span>half day {halfHours}h</span><span>full day {fullHours}h</span></div>
            <div className="flex items-center gap-2 pt-1"><CheckCircle2Icon className="size-4 text-muted-foreground" /><Pill tone={liveTone}>{live}</Pill></div>
            {fullAt && <p className="text-xs text-muted-foreground">You reach a full day at about <b className="text-foreground">{fullAt}</b> if you stay checked in.</p>}
            {p.state === "out" && !off && <p className="text-xs text-muted-foreground">Check in before {att.set.lateAfter} to be counted on time.</p>}
          </div>
        </Section>

        <Section title="Leave" hint="Ask for a day off, half day or short leave">
          <div className="grid gap-2">
            <Button onClick={() => setAsking(true)}><CalendarPlusIcon /> Apply for leave</Button>
            <BalanceLine b={bal} year={today.slice(0, 4)} />
            {myLeaves.map((l) => (
              <div key={l.leaveId} className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                <Pill tone={l.status === "Approved" ? "green" : l.status === "Rejected" ? "red" : l.status === "Pending" ? "amber" : "gray"}>{l.status}</Pill>
                <span className="font-medium">{l.type}</span><span className="text-muted-foreground">{fmtDate(l.startDate)}{l.endDate !== l.startDate ? ` – ${fmtDate(l.endDate)}` : ""}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
      {asking && <LeaveDialog onClose={() => setAsking(false)} />}
    </div>
  );
}
