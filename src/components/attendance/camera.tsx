"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Best-effort GPS: never blocks a punch — if the device says no or is slow, the punch is saved without a location. */
export function getPosition(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({});
    const t = setTimeout(() => resolve({}), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(t); resolve({}); },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 60_000 },
    );
  });
}

/** Opens the front camera while mounted. `snap()` returns a small JPEG (data URL, about 15 KB) — or "" when there is no camera. */
export function useCamera(active = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "ready" | "unavailable">("starting");
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) { queueMicrotask(() => !stopped && setState("unavailable")); return () => { stopped = true; }; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play().catch(() => {}); }
        setState("ready");
      })
      .catch(() => { if (!stopped) setState("unavailable"); });
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [active]);

  const snap = useCallback((): string => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return "";
    const w = 320, h = Math.round((v.videoHeight / v.videoWidth) * w);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(v, 0, 0, w, h);
    let q = 0.6, url = c.toDataURL("image/jpeg", q);
    while (url.length > 40000 && q > 0.3) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
    return url.length <= 40000 ? url : "";
  }, []);

  return { videoRef, state, snap };
}

/** The live preview (mirrored like a mirror, so people can line themselves up). */
export function CameraView({ videoRef, state, className }: { videoRef: React.RefObject<HTMLVideoElement | null>; state: "starting" | "ready" | "unavailable"; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-slate-900", className)}>
      <video ref={videoRef} muted playsInline autoPlay className={cn("size-full object-cover [transform:scaleX(-1)]", state !== "ready" && "invisible")} />
      {state !== "ready" && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-300">{state === "starting" ? "Starting the camera…" : "Camera not available — the punch will be saved without a photo."}</div>}
      {state === "ready" && <div className="pointer-events-none absolute inset-[12%] rounded-[50%] border-2 border-dashed border-emerald-400/70" aria-hidden />}
    </div>
  );
}
