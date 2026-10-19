"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CameraIcon, CameraOffIcon, ClockIcon, LogInIcon, LogOutIcon, SunriseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CameraView, useCamera } from "@/components/attendance/camera";
import { usePunch } from "@/components/attendance/punch-card";
import { useAttendance } from "@/components/attendance/use-attendance";
import { Spinner } from "@/components/common";
import { fmtHours } from "@/lib/attendance";
import { addMinutes, fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

const SNOOZE_KEY = "midap-checkin-snooze";
const readSnooze = () => { try { return sessionStorage.getItem(SNOOZE_KEY) ?? ""; } catch { return ""; } };

/**
 * What the app knows about the signed-in person's day, so it can make sure they check in — and out.
 * The check-in screen appears when: it is a working day, they are not on leave, they have not checked in yet and the time has come.
 */
export function useDayState() {
  const { data, meId, today, now, isSuper, allow } = useFlows();
  const att = useAttendance();
  const [snoozeUntil, setSnooze] = useState(readSnooze);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const n = now();
  const hm = n.slice(11, 16);
  const s = data?.settings ?? {};
  const mode = (s.ATT_GATE ?? "required") as "required" | "prompt" | "off";
  const me = data?.users.find((u) => u.userId === meId);
  const mine = att.rows.filter((r) => r.userId === meId);
  const tracked = !!me?.empCode || mine.some((r) => r.date >= addDaysStr(today, -45));
  const day = att.days(meId, today, today)[0];
  const todays = mine.filter((r) => r.date === today);
  const stale = mine.filter((r) => !r.checkOut && r.date < today && r.date >= addDaysStr(today, -14)).sort((a, b) => a.date.localeCompare(b.date));
  const open = todays.find((r) => !r.checkOut);
  const kioskOnly = s.ATT_SELF_PUNCH === "N" && !allow("attendance", "manage");
  const workingDay = !!day && day.status !== "off" && day.status !== "holiday" && day.status !== "leave";
  const due = !!data && mode !== "off" && tracked && workingDay && !kioskOnly && todays.length === 0 && hm >= (s.ATT_GATE_FROM || "08:00") && hm <= "21:00";
  const snoozed = mode === "prompt" && !!snoozeUntil && n < snoozeUntil;
  // the Super Admin is never locked out — for them it is always a postponable reminder
  const strict = mode === "required" && !isSuper;
  const checkoutDue = !!open && !kioskOnly && hm >= (s.ATT_REMIND_CHECKOUT || "18:30");
  return {
    ready: !!data, tracked, workingDay, kioskOnly, todays, open, stale, day, strict, mode,
    needsCheckIn: due && !snoozed, needsCheckOut: checkoutDue,
    postpone: (minutes = 30) => { const until = addMinutes(n, minutes); try { sessionStorage.setItem(SNOOZE_KEY, until); } catch { /* private window: it simply comes back */ } setSnooze(until); },
    lateAfter: s.ATT_LATE_AFTER || "09:30",
  };
}
const addDaysStr = (d: string, k: number) => new Date(Date.parse(d + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10);

/** The check-in / check-out form: the time, the rule, an optional photo, one big button. */
export function CheckInPanel({ onDone, onPostpone, greeting }: { onDone?: () => void; onPostpone?: () => void; greeting?: boolean }) {
  const { data, today, now } = useFlows();
  const p = usePunch();
  const st = useDayState();
  const [photoPick, setPhotoOn] = useState(false);
  const photoOn = p.cameraRequired || photoPick;
  const cam = useCamera(photoOn);
  const n = now();
  const hour = Number(n.slice(11, 13));
  const out = p.state === "in";
  const wantPhoto = photoOn && cam.state === "ready";
  const late = !out && n.slice(11, 16) > st.lateAfter;
  const name = data?.me.name.split(" ")[0] ?? "";

  async function go() {
    const ok = await p.punch(wantPhoto ? cam.snap() : "");
    if (ok) onDone?.();
  }
  return (
    <div className="grid gap-4">
      {greeting && (
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><SunriseIcon className="size-5" /></span>
          <div><div className="text-lg font-semibold leading-tight">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {name}</div><div className="text-sm text-muted-foreground">{fmtDate(today, true)} · {n.slice(11, 16)}</div></div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {out ? `You are checked in since ${p.open?.checkIn.slice(11)} (${fmtHours(p.liveMin / 60)} so far). Check out when you leave, so your hours are right.`
          : late ? `It is after ${st.lateAfter}, so today will be marked late. Check in now — it is still better than not at all.`
          : `Check in before ${st.lateAfter} to be on time. It takes one tap.`}
      </p>
      <div>
        <button type="button" onClick={() => !p.cameraRequired && setPhotoOn((v) => !v)} aria-pressed={photoOn} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", photoOn ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
          {photoOn ? <CameraIcon className="size-3.5" /> : <CameraOffIcon className="size-3.5" />} {photoOn ? (p.cameraRequired ? "Camera photo is compulsory" : "Photo on — tap to turn off") : "Add a photo (optional)"}
        </button>
        {photoOn && <CameraView videoRef={cam.videoRef} state={cam.state} className="mt-2 aspect-[4/3] w-full" />}
        {p.cameraRequired && cam.state === "unavailable" && <p role="alert" className="mt-2 text-xs text-red-700">The camera is compulsory but could not start. Allow the camera for this site in your browser, then reload. If your camera does not work, ask the Super Admin to excuse you.</p>}
      </div>
      <Button onClick={go} disabled={p.busy || (p.cameraRequired && !wantPhoto)} size="lg" variant={out ? "outline" : "default"} className={cn("h-14 w-full text-base", out && "border-red-200 text-red-700 hover:bg-red-50")}>
        {p.busy ? <Spinner /> : out ? <><LogOutIcon /> Check out now</> : <><LogInIcon /> Check in now</>}
      </Button>
      {!out && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <Link href="/flows/attendance?tab=leave" onClick={() => onPostpone?.()} className="underline underline-offset-2 hover:text-foreground">Not working today? Apply for leave</Link>
          {onPostpone && <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onPostpone}>Remind me in 30 minutes</button>}
        </div>
      )}
    </div>
  );
}

/** Opens by itself when a person has not checked in, or forgot to check out earlier. Cannot be closed by accident. */
export function CheckInGate() {
  const st = useDayState();
  const [dismissed, setDismissed] = useState(false);
  if (!st.ready) return null;
  if (st.stale.length) return <ForgotCheckout key={st.stale[0].attId} />;
  if (!st.needsCheckIn || dismissed) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !st.strict) { st.postpone(); setDismissed(true); } }}>
      <DialogContent showCloseButton={!st.strict} className="sm:max-w-md" onKeyDown={(e) => { if (st.strict && e.key === "Escape") e.preventDefault(); }}>
        <DialogHeader><DialogTitle className="sr-only">Check in</DialogTitle><DialogDescription className="sr-only">Check in to start your day</DialogDescription></DialogHeader>
        <CheckInPanel greeting onDone={() => setDismissed(true)} onPostpone={st.strict ? undefined : () => { st.postpone(); setDismissed(true); }} />
        {st.strict && <DialogFooter className="!mt-0 border-0 bg-transparent p-0 text-xs text-muted-foreground sm:justify-start">Your company needs everyone to check in before using the app.</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** "You did not check out on Tuesday" — the person says when they left. */
function ForgotCheckout() {
  const { call } = useFlows();
  const st = useDayState();
  const r = st.stale[0];
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const res = await call("closeMyPunch", { attId: r.attId, time });
    setBusy(false);
    if (!res.ok) setErr(res.error || "Could not save"); else toast.success("Thanks — your check-out is saved");
  }
  const left = st.stale.length - 1;
  return (
    <Dialog open onOpenChange={() => { /* has to be answered */ }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>You did not check out on {fmtDate(r.date, true)}</DialogTitle>
          <DialogDescription>You checked in at {r.checkIn.slice(11)} and the day was never closed, so its hours are unknown. When did you leave?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="left-at">I left at</label>
          <Input id="left-at" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 w-40 text-base" />
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          {left > 0 && <p className="text-xs text-muted-foreground">{left} more earlier day{left === 1 ? "" : "s"} to fill in after this.</p>}
        </div>
        <DialogFooter><Button onClick={save} disabled={busy || !time}>{busy ? <Spinner /> : "Save check-out"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One small line that is always visible: where you stand today. Tap it to check in or out. */
export function DayChip({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const p = usePunch();
  const st = useDayState();
  const [open, setOpen] = useState(false);
  const state = useMemo(() => (!st.ready || !st.tracked ? "none" : st.kioskOnly ? "kiosk" : p.state), [st.ready, st.tracked, st.kioskOnly, p.state]);
  if (state === "none") return null;
  if (state === "kiosk") return (
    <Link href="/flows/kiosk" aria-label="Check in at the office kiosk" className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors", tone === "dark" ? "bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent" : "bg-muted text-foreground hover:bg-muted/70")}>
      <ClockIcon className="size-3.5 shrink-0 opacity-70" /><span className="min-w-0 flex-1 truncate">Check in at the office kiosk</span>
    </Link>
  );
  const label = state === "in" ? `In ${p.open!.checkIn.slice(11)} · ${fmtHours(p.liveMin / 60)}` : state === "done" ? `Done · ${fmtHours(p.closedMin / 60)}` : st.workingDay ? "Not checked in" : "Day off";
  const bad = state === "out" && st.workingDay;
  return (
    <>
      <button type="button" onClick={() => (state === "done" || !st.workingDay ? undefined : setOpen(true))} aria-label={`Attendance today: ${label}`}
        className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors", tone === "dark" ? "bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent" : "bg-muted text-foreground hover:bg-muted/70", bad && "ring-1 ring-red-400/60")}>
        <span className={cn("size-2 shrink-0 rounded-full", state === "in" ? "bg-emerald-500" : bad ? "animate-pulse bg-red-500" : "bg-slate-400")} />
        <ClockIcon className="size-3.5 shrink-0 opacity-70" /><span className="min-w-0 flex-1 truncate">{label}</span>
        {(state === "in" || bad) && <span className="shrink-0 text-[11px] opacity-80">{state === "in" ? "Check out" : "Check in"}</span>}
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="sr-only">Attendance</DialogTitle></DialogHeader><CheckInPanel onDone={() => setOpen(false)} /></DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A banner at the top of the page when someone is still checked in late in the day. */
export function CheckOutNudge() {
  const st = useDayState();
  const [open, setOpen] = useState(false);
  if (!st.needsCheckOut) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <ClockIcon className="size-4" /> You are still checked in since {st.open?.checkIn.slice(11)}. Going home?
        <Button size="sm" variant="outline" className="ml-auto h-8 border-amber-300 bg-white" onClick={() => setOpen(true)}>Check out</Button>
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="sr-only">Check out</DialogTitle></DialogHeader><CheckInPanel onDone={() => setOpen(false)} /></DialogContent>
        </Dialog>
      )}
    </>
  );
}
