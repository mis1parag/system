"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/common";

interface Status { ok: boolean; ready?: boolean; hasUsers?: boolean; needsKey?: boolean; demo?: boolean; error?: string }

/** First-time setup: creates the tabs in the Google Sheet and the first Super Admin. Only works while there are no users. */
export default function SetupPage() {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [v, setV] = useState({ name: "", mobile: "", email: "", pin: "", key: "" });
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setSt({ ok: false, error: "Could not reach the server" }));
  }, []);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, demo }) });
    const json = await res.json();
    if (!json.ok) { setError(json.error || "Setup failed"); setBusy(false); return; }
    router.replace("/login");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-primary/5 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-5">
          <div className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">M</div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">First-time setup</h1>
          <p className="text-sm text-muted-foreground">Creates the tabs in your Google Sheet and the first Super Admin.</p>
        </div>
        {!st && <div className="flex justify-center py-8"><Spinner /></div>}
        {st && !st.ok && (
          <div className="grid gap-3 text-sm">
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800"><b>Cannot reach your Google Sheet.</b><br />{st.error}</p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              <li>Is <code>GOOGLE_SHEET_ID</code> the long ID from the Sheet link?</li>
              <li>Did you share the Sheet with the service-account email as <b>Editor</b>?</li>
              <li>Is the Google Sheets API enabled in that Google Cloud project?</li>
              <li>Are <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (or EMAIL + PRIVATE_KEY) set correctly?</li>
            </ul>
          </div>
        )}
        {st?.ok && st.hasUsers && (
          <div className="grid gap-3 text-sm"><p>Setup is already done.</p><Link href="/login" className="font-medium text-primary underline">Go to sign in</Link></div>
        )}
        {st?.ok && !st.hasUsers && (
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Your name *"><Input className="h-11" value={v.name} onChange={set("name")} required /></Field>
            <Field label="Mobile (10 digits) *" hint="You sign in with this"><Input className="h-11" inputMode="numeric" value={v.mobile} onChange={set("mobile")} required /></Field>
            <Field label="Email"><Input className="h-11" type="email" value={v.email} onChange={set("email")} /></Field>
            <Field label="PIN * (4–8 digits)"><Input className="h-11" type="password" inputMode="numeric" autoComplete="new-password" value={v.pin} onChange={set("pin")} required /></Field>
            {st.needsKey && <Field label="Setup key *" hint="The SETUP_KEY value from your server settings"><Input className="h-11" type="password" value={v.key} onChange={set("key")} required /></Field>}
            {st.demo && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-input" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Also add 3 demo users (test Sheet only)</label>}
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" size="lg" className="h-11 text-base" disabled={busy}>{busy ? <Spinner /> : "Create tabs & Super Admin"}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
