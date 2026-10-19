"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LogInIcon, LogOutIcon, MapPinIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CameraView, getPosition, useCamera } from "@/components/attendance/camera";
import { Spinner } from "@/components/common";
import { fmtHours } from "@/lib/attendance";
import { minutesBetween } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

/** Today's punches of the signed-in person and the one action that makes sense now (check in / check out). */
export function usePunch() {
  const { data, meId, today, now, call, allow, refresh } = useFlows();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // a second tap while the first is still on its way does nothing
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []); // keeps the timer moving

  const mine = (data?.attendance ?? []).filter((r) => r.userId === meId && r.date === today).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const open = mine.find((r) => !r.checkOut);
  const n = now();
  const closedMin = mine.filter((r) => r.checkOut).reduce((a, r) => a + Math.max(0, minutesBetween(r.checkIn, r.checkOut)), 0);
  const liveMin = closedMin + (open ? Math.max(0, minutesBetween(open.checkIn, n)) : 0);
  const state: "in" | "done" | "out" = open ? "in" : mine.length ? "done" : "out";
  const kioskOnly = data?.settings?.ATT_SELF_PUNCH === "N" && !allow("attendance", "manage");
  const photoByDefault = data?.settings?.ATT_PHOTO === "Y";

  /** `photo` is optional: a punch never needs one. */
  async function punch(photo = "") {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      const pos = await getPosition();
      const r = await call(state === "in" ? "checkOut" : "checkIn", { ...pos, photo });
      if (!r.ok) {
        toast.error(r.code === "NETWORK" ? "No connection — your punch may not have been saved. Checking…" : r.error || "Could not save");
        await refresh(); // the screen may be out of date (another device, a slow connection): show what the server really has
        return false;
      }
      toast.success(state === "in" ? "Checked out — have a good evening" : "Checked in — have a good day", { description: pos.lat ? "Location saved" : "Location not available (saved without it)" });
      return true;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { mine, open, closedMin, liveMin, state, busy, punch, kioskOnly, photoByDefault };
}

/** Compact Check in / Check out strip with today's status and a live "worked so far" timer (used on Home). */
export function PunchCard({ compact }: { compact?: boolean }) {
  const { allow, data } = useFlows();
  const p = usePunch();
  const [snapOpen, setSnapOpen] = useState(false);
  const { mine, open, closedMin, liveMin, state } = p;

  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm", compact && "p-3")}>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", state === "in" ? "bg-emerald-100 text-emerald-700" : state === "done" ? "bg-sky-100 text-sky-700" : "bg-muted text-muted-foreground")}>
        {state === "in" ? <LogInIcon className="size-5" /> : <LogOutIcon className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {state === "in" ? `Checked in at ${open!.checkIn.slice(11)}` : state === "done" ? "Day finished" : "You have not checked in yet"}
        </div>
        <div className="text-xs text-muted-foreground">
          {state === "in" ? `${fmtHours(liveMin / 60)} worked so far` : state === "done" ? `${fmtHours(closedMin / 60)} today · ${mine[0].checkIn.slice(11)} → ${mine[mine.length - 1].checkOut.slice(11)}` : "Tap the button when you reach work."}
          {(open?.lat ?? mine[0]?.lat) != null && <span className="ml-1.5 inline-flex items-center gap-0.5"><MapPinIcon className="size-3" /> location saved</span>}
        </div>
      </div>
      {p.kioskOnly ? <Link href="/flows/kiosk" className={cn(buttonVariants({ size: "lg" }), "h-11 text-base")}><LogInIcon /> Check in at the office kiosk</Link> : (
        <Button onClick={() => (p.photoByDefault ? setSnapOpen(true) : p.punch())} disabled={p.busy} size="lg" variant={state === "in" ? "outline" : "default"} className={cn("h-11 min-w-32 text-base", state === "in" && "border-red-200 text-red-700 hover:bg-red-50")}>
          {p.busy ? <Spinner /> : state === "in" ? <><LogOutIcon /> Check out</> : <><LogInIcon /> {state === "done" ? "Check in again" : "Check in"}</>}
        </Button>
      )}
      {snapOpen && <SelfieDialog title={state === "in" ? "Check out" : "Check in"} busy={p.busy} onCancel={() => setSnapOpen(false)} onTake={async (photo) => { if (await p.punch(photo)) setSnapOpen(false); }} />}
      {allow("attendance", "manage") && state === "out" && data?.settings?.ATT_SELF_PUNCH === "N" && <Link href="/flows/kiosk" className="text-xs text-primary underline">Open kiosk</Link>}
    </div>
  );
}

/** Camera preview, then one tap: takes the selfie and punches. A photo is a bonus, never a gate: "without photo" is always there. */
function SelfieDialog({ title, busy, onCancel, onTake }: { title: string; busy: boolean; onCancel: () => void; onTake: (photo: string) => void }) {
  const cam = useCamera();
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{title} · look at the camera</DialogTitle></DialogHeader>
        <CameraView videoRef={cam.videoRef} state={cam.state} className="aspect-[4/3] w-full" />
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="outline" onClick={() => onTake("")} disabled={busy}>{title} without photo</Button>
          <Button onClick={() => onTake(cam.snap())} disabled={busy || cam.state !== "ready"}>{busy ? <Spinner /> : `Take photo & ${title.toLowerCase()}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
