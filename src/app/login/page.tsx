"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/common";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<{ ok: boolean; hasUsers?: boolean; error?: string } | null>(null);

  // tells a brand-new install to run setup, and shows a clear message when the Google Sheet cannot be reached
  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" }).then((r) => r.json()).then(setSheet).catch(() => setSheet(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, pin }) });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "Login failed"); setBusy(false); return; }
      router.replace("/flows/panel");
    } catch {
      setError("Network error — check your connection");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-primary/5 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">M</div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">MIDAP FMS</h1>
          <p className="text-sm text-muted-foreground">Flow Management System</p>
        </div>
        {sheet && !sheet.ok && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800"><b>Cannot reach the Google Sheet.</b> {sheet.error} <a href="/setup" className="underline">Check setup</a></p>}
        {sheet?.ok && !sheet.hasUsers && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No users yet. <a href="/setup" className="font-medium underline">Run first-time setup</a></p>}
        <div className="grid gap-4">
          <Field label="Your email or mobile number">
            <Input autoFocus autoComplete="username" inputMode="text" className="h-11" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="name@company.com  or  98xxxxxxxx" required />
          </Field>
          <Field label="PIN" hint="The 4–8 digit PIN your admin gave you. Forgot it? Ask your admin to set a new one.">
            <Input type="password" autoComplete="current-password" inputMode="numeric" className="h-11" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" required />
          </Field>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="h-11 text-base" disabled={busy}>
            {busy ? <Spinner /> : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
