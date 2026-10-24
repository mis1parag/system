"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/common";
import { GOOGLE_ERRORS } from "@/lib/login-messages";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [next] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("next") ?? ""));
  const [sheet, setSheet] = useState<{ ok: boolean; hasUsers?: boolean; error?: string; google?: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const loading = sheet === null && !failed; // until the server says whether Google sign-in is on, show neither form
  const google = !!sheet?.google;

  // tells a brand-new install to run setup, and shows a clear message when the Google Sheet cannot be reached
  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" }).then((r) => r.json()).then(setSheet).catch(() => setFailed(true));
    // a failed Google sign-in comes back here with a short code (only messages from a fixed list are ever shown)
    const g = new URLSearchParams(window.location.search).get("google");
    if (g && GOOGLE_ERRORS[g]) queueMicrotask(() => setError(GOOGLE_ERRORS[g]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, pin }) });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "Login failed"); setBusy(false); return; }
      // a private link (for example the one in a salary-slip e-mail) brings you back to it after signing in — same-site paths only
      const next = new URLSearchParams(window.location.search).get("next") ?? "";
      if (/^\/(?!\/)[\w\-./?=&%]*$/.test(next) && !next.startsWith("/login")) window.location.assign(next);
      else router.replace("/flows/panel");
    } catch {
      setError("Network error — check your connection");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#1e1b4b] via-[#3730a3] to-[#6d28d9] p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3"><span className="inline-flex size-11 items-center justify-center rounded-xl bg-white/15 text-xl font-bold ring-1 ring-white/30">P</span><span className="text-lg font-semibold tracking-tight">Parag Unify Crafts</span></div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">One panel for the whole team.</h2>
          <p className="mt-3 text-base text-white/80">Tasks, daily checklists, attendance and salary slips — in one place, for everyone from the office to the warehouse.</p>
          <ul className="mt-6 grid gap-2 text-sm text-white/85">
            {["Process tracking (FMS) with planned vs actual time", "Daily, weekly and one-time checklists", "Check-in / check-out with approvals", "Salary slips, only for you"].map((t) => <li key={t} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-white/70" />{t}</li>)}
          </ul>
        </div>
        <div className="relative text-xs text-white/60">© Parag Unify Crafts</div>
      </aside>
      <section className="flex items-center justify-center bg-gradient-to-b from-[#eef2ff] to-white px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg shadow-indigo-100">
        <div className="mb-6">
          <div className="inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#4f46e5] to-[#7c3aed] text-lg font-bold text-white shadow-sm lg:hidden">P</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight lg:mt-0">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to the Parag Unify Crafts panel</p>
        </div>
        {sheet && !sheet.ok && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800"><b>Cannot reach the Google Sheet.</b> {sheet.error} <a href="/setup" className="underline">Check setup</a></p>}
        {sheet?.ok && !sheet.hasUsers && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No users yet. <a href="/setup" className="font-medium underline">Run first-time setup</a></p>}
        <div className="grid gap-4">
          {loading && <div className="flex justify-center py-6"><Spinner /></div>}
          {google && (
            <a href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`} className={cn(buttonVariants({ size: "lg" }), "h-12 gap-2 bg-white text-base text-foreground ring-1 ring-border hover:bg-muted")}>
              <svg viewBox="0 0 24 24" className="mr-2 size-4" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" /></svg>
              Sign in with Google
            </a>
          )}
          {google && <p className="text-center text-xs text-muted-foreground">Use the Google account with the e-mail your admin added for you.</p>}
          {!loading && (!google || showPin) && (
            <>
              <Field label="Your email or mobile number">
                <Input autoFocus={!google} autoComplete="username" inputMode="text" className="h-11" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="name@company.com  or  98xxxxxxxx" required />
              </Field>
              <Field label="PIN" hint={google ? "PIN sign-in is only for the Super Admin." : "The 4–8 digit PIN your admin gave you. Forgot it? Ask your admin to set a new one."}>
                <Input type="password" autoComplete="current-password" inputMode="numeric" className="h-11" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" required />
              </Field>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!loading && (!google || showPin) && (
            <Button type="submit" size="lg" className="h-11 text-base" disabled={busy}>
              {busy ? <Spinner /> : "Sign in"}
            </Button>
          )}
          {google && !showPin && <button type="button" onClick={() => setShowPin(true)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Super Admin PIN sign-in</button>}
        </div>
      </form>
      </section>
    </main>
  );
}
