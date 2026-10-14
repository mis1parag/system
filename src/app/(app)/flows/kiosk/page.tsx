"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CheckCircle2Icon, LogInIcon, LogOutIcon, QrCodeIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraView, useCamera } from "@/components/attendance/camera";
import { PageHeader, Section, Spinner } from "@/components/common";
import { useFlows, useRequireCap } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Done { action: "in" | "out"; name: string; empCode: string; time: string }
type Banner = { kind: "in" | "out" | "err"; title: string; sub: string };

/** Reception kiosk: an admin keeps this open on the office PC. Staff type or scan their Employee ID; the same tap checks them in, or out when they are already in. A small photo is kept with each punch. */
export default function KioskPage() {
  const ok = useRequireCap("useKiosk");
  const { call } = useFlows();
  const { videoRef, state, snap } = useCamera();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [recent, setRecent] = useState<Done[]>([]);
  const busyRef = useRef(false);
  const lastRef = useRef({ code: "", at: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c || busyRef.current) return;
    if (lastRef.current.code === c && Date.now() - lastRef.current.at < 6000) return; // the same QR is still in front of the camera
    lastRef.current = { code: c, at: Date.now() };
    busyRef.current = true; setBusy(true);
    const r = await call<Done>("kioskPunch", { empCode: c, photo: snap() });
    busyRef.current = false; setBusy(false);
    if (timer.current) clearTimeout(timer.current);
    if (r.ok && r.data) {
      setBanner({ kind: r.data.action, title: r.data.name, sub: `${r.data.action === "in" ? "Checked in" : "Checked out"} at ${r.data.time}` });
      setCode("");
      setRecent((l) => [r.data!, ...l].slice(0, 8));
    } else {
      lastRef.current = { code: "", at: 0 };
      setBanner({ kind: "err", title: "Not saved", sub: r.error || "Try again" });
    }
    timer.current = setTimeout(() => setBanner(null), 5000);
    inputRef.current?.focus();
  }, [call, snap]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // QR scanning: look at the camera picture a few times a second until a code is read
  useEffect(() => {
    if (!scan || state !== "ready") return;
    let raf = 0, last = 0;
    const canvas = document.createElement("canvas");
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || !v.videoWidth || t - last < 200 || busyRef.current) return;
      last = t;
      const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w);
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
      if (hit?.data) submit(hit.data);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scan, state, videoRef, submit]);


  if (!ok) return null;
  return (
    <>
      <PageHeader title="Attendance kiosk" subtitle="Keep this page open on the office PC. Staff type or scan their Employee ID to check in or out." />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CameraView videoRef={videoRef} state={state} className="aspect-[4/3] w-full" />
        </div>
        <div className="grid content-start gap-4 lg:col-span-2">
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
            <label htmlFor="empcode" className="text-sm font-medium">Employee ID</label>
            <div className="flex gap-2">
              <Input id="empcode" ref={inputRef} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Type the ID, or scan the QR" className="h-12 text-lg" />
              <Button type="button" variant={scan ? "default" : "outline"} className="h-12" onClick={() => setScan((s) => !s)} aria-pressed={scan} title="Scan a QR code with the camera"><QrCodeIcon /> {scan ? "Scanning…" : "Scan QR"}</Button>
            </div>
            <Button type="submit" size="lg" className="h-12 text-base" disabled={busy || !code.trim()}>{busy ? <Spinner /> : <><LogInIcon /> Check in / out</>}</Button>
            <p className="text-xs text-muted-foreground">One tap does the right thing: if the person is not in yet it checks them in, if they are already in it checks them out.</p>
          </form>
          <div aria-live="polite" className="min-h-24">
            {banner && (
              <div className={cn("flex items-center gap-3 rounded-xl border p-4", banner.kind === "in" && "border-emerald-200 bg-emerald-50 text-emerald-900", banner.kind === "out" && "border-sky-200 bg-sky-50 text-sky-900", banner.kind === "err" && "border-red-200 bg-red-50 text-red-900")}>
                {banner.kind === "err" ? <XCircleIcon className="size-8 shrink-0" /> : banner.kind === "in" ? <CheckCircle2Icon className="size-8 shrink-0" /> : <LogOutIcon className="size-8 shrink-0" />}
                <div className="min-w-0"><div className="truncate text-xl font-semibold">{banner.title}</div><div className="text-sm">{banner.sub}</div></div>
              </div>
            )}
          </div>
          <Section title="Punched on this screen" hint="Latest first (since you opened it)">
            {recent.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            <ul className="grid gap-1 text-sm">{recent.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{r.action === "in" ? "in" : "out"} {r.time}</span></li>)}</ul>
          </Section>
        </div>
      </div>
    </>
  );
}
