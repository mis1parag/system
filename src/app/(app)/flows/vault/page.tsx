"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, EyeIcon, EyeOffIcon, ExternalLinkIcon, KeyRoundIcon, LockIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/avatar";
import { EmptyState, Field, PageHeader, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

interface Item { vaultId: string; service: string; username: string; loginUrl: string; category: string; notes: string; createdBy: string; updatedAt: string; canReveal: boolean; sharedWith?: { userId: string; canReveal: boolean }[] }
interface Listing { enabled: boolean; items: Item[] }

/** Encrypted shared logins. The list never contains passwords; Reveal and Copy ask the server each time and are written to the activity log. */
export default function VaultPage() {
  const { call, allow, isSuper, meId } = useFlows();
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [edit, setEdit] = useState<Item | "new" | null>(null);
  const [share, setShare] = useState<Item | null>(null);

  const load = useCallback(async () => {
    const r = await call<Listing>("listVault", {});
    if (!r.ok) setError(r.error || "Could not open the vault"); else { setList(r.data!); setError(""); }
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => list?.items ?? [], [list]);
  const cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const shown = useMemo(() => items.filter((i) => (!cat || i.category === cat) && (!q || `${i.service} ${i.username} ${i.category} ${i.notes}`.toLowerCase().includes(q.toLowerCase()))), [items, cat, q]);
  const canAdd = allow("vault", "create");

  async function remove(i: Item) {
    if (!window.confirm(`Delete the login “${i.service}”? Everyone it was shared with loses it.`)) return;
    const r = await call("deleteVault", { vaultId: i.vaultId });
    if (!r.ok) toast.error(r.error || "Could not delete"); else { toast.success("Deleted"); load(); }
  }

  if (error) return <EmptyState title="The vault is closed" hint={error} />;
  return (
    <>
      <PageHeader title="Credential vault" subtitle="Shared logins, encrypted. You see only what has been given to you." actions={canAdd && list?.enabled && <Button onClick={() => setEdit("new")}><PlusIcon /> Add login</Button>} />
      {list && !list.enabled && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><LockIcon className="mr-1.5 inline size-4" />The vault is not set up on this server (no encryption key). Nothing can be saved or revealed until whoever installed the app adds <code>VAULT_KEY</code>. This is on purpose: it never stores passwords unprotected.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 max-w-sm flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search service or username…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cats.length > 1 && <div className="flex flex-wrap gap-1.5">{["", ...cats].map((c) => <button key={c || "all"} onClick={() => setCat(c)} aria-pressed={cat === c} className={cn("rounded-full border px-3 py-1 text-xs font-medium", cat === c ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>{c || "All"}</button>)}</div>}
      </div>
      {!list && <p className="py-6 text-center text-sm text-muted-foreground"><Spinner className="mr-2 inline" /> Opening…</p>}
      {list && items.length === 0 && <EmptyState title="Nothing here yet" hint={canAdd ? "Add a login, then choose who may use it." : "No login has been shared with you."} />}
      <div className="grid gap-2">
        {shown.map((i) => <Row key={i.vaultId} item={i} mine={i.createdBy === meId} manage={isSuper || allow("vault", "manage")} onEdit={() => setEdit(i)} onShare={() => setShare(i)} onDelete={() => remove(i)} />)}
      </div>
      {edit && <LoginDialog item={edit === "new" ? undefined : edit} onClose={(saved) => { setEdit(null); if (saved) load(); }} />}
      {share && <ShareDialog item={share} onClose={(saved) => { setShare(null); if (saved) load(); }} />}
    </>
  );
}

function Row({ item, mine, manage, onEdit, onShare, onDelete }: { item: Item; mine: boolean; manage: boolean; onEdit: () => void; onShare: () => void; onDelete: () => void }) {
  const { call, allow } = useFlows();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function ask(purpose: "reveal" | "copy") {
    setBusy(purpose);
    const r = await call<{ secret: string }>("revealVault", { vaultId: item.vaultId, purpose });
    setBusy("");
    if (!r.ok) { toast.error(r.error || "Not allowed"); return null; }
    return r.data!.secret;
  }
  async function reveal() {
    if (secret) { setSecret(""); return; }
    const s = await ask("reveal");
    if (s === null) return;
    setSecret(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSecret(""), 15_000); // hides itself
  }
  async function copy() {
    const s = await ask("copy");
    if (s === null) return;
    try { await navigator.clipboard.writeText(s); toast.success("Password copied"); } catch { toast.error("Your browser did not allow copying"); }
  }
  const canChange = mine || manage;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#efeeff] text-primary"><KeyRoundIcon className="size-5" /></span>
      <div className="min-w-48 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">{item.service}{item.category && <span className="rounded bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{item.category}</span>}</div>
        <div className="truncate text-xs text-muted-foreground">{item.username || "—"}{item.notes ? ` · ${item.notes}` : ""}</div>
        {item.sharedWith && item.sharedWith.length > 0 && <div className="mt-1 flex -space-x-1.5">{item.sharedWith.slice(0, 6).map((s) => <Avatar key={s.userId} userId={s.userId} size={18} className="ring-2 ring-card" />)}{item.sharedWith.length > 6 && <span className="pl-2.5 text-[11px] text-muted-foreground">+{item.sharedWith.length - 6}</span>}</div>}
      </div>
      <div className="flex min-w-40 items-center gap-1.5 font-mono text-sm tabular-nums" aria-live="polite">{item.canReveal ? (secret ? <span className="select-all break-all rounded bg-muted px-1.5 py-0.5">{secret}</span> : <span className="tracking-widest text-muted-foreground">••••••••</span>) : <span className="text-xs italic text-muted-foreground" style={{ fontFamily: "inherit" }}>password not shared</span>}</div>
      <div className="flex items-center gap-1">
        {item.canReveal && <Button size="sm" variant="outline" disabled={busy !== ""} onClick={reveal}>{busy === "reveal" ? <Spinner /> : secret ? <><EyeOffIcon /> Hide</> : <><EyeIcon /> Reveal</>}</Button>}
        {item.canReveal && <Button size="sm" variant="outline" disabled={busy !== ""} onClick={copy}>{busy === "copy" ? <Spinner /> : <><CopyIcon /> Copy</>}</Button>}
        {item.loginUrl && <a href={item.loginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2.5 text-[0.8rem] font-medium text-[#3c4257] hover:bg-[#f6f9fc]"><ExternalLinkIcon className="size-3.5" /> Open</a>}
        {canChange && allow("vault", "assign") && <button aria-label={`Share ${item.service}`} title="Who can use it" className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={onShare}><ShareIcon className="size-4" /></button>}
        {canChange && allow("vault", "edit") && <button aria-label={`Edit ${item.service}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={onEdit}><PencilIcon className="size-3.5" /></button>}
        {canChange && allow("vault", "delete") && <button aria-label={`Delete ${item.service}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-red-700" onClick={onDelete}><Trash2Icon className="size-3.5" /></button>}
      </div>
    </div>
  );
}

function LoginDialog({ item, onClose }: { item?: Item; onClose: (saved: boolean) => void }) {
  const { call } = useFlows();
  const [v, setV] = useState({ service: item?.service ?? "", username: item?.username ?? "", loginUrl: item?.loginUrl ?? "https://", category: item?.category ?? "", notes: item?.notes ?? "", secret: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr("");
    const r = await call("saveVault", { vaultId: item?.vaultId, ...v, loginUrl: v.loginUrl === "https://" ? "" : v.loginUrl });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success("Saved — the password is stored encrypted");
    onClose(true);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? `Edit ${item.service}` : "Add a login"}</DialogTitle><DialogDescription>The password is encrypted before it is saved. Nobody can read it from the sheet.</DialogDescription></DialogHeader>
        <form className="grid gap-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Service"><Input value={v.service} onChange={set("service")} placeholder="Shopify" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Username"><Input value={v.username} onChange={set("username")} autoComplete="off" /></Field><Field label="Category"><Input value={v.category} onChange={set("category")} placeholder="Marketplace" /></Field></div>
          <Field label="Login address"><Input value={v.loginUrl} onChange={set("loginUrl")} inputMode="url" /></Field>
          <Field label={item ? "New password (leave empty to keep)" : "Password"}>
            <div className="flex gap-2"><Input type={show ? "text" : "password"} value={v.secret} onChange={set("secret")} autoComplete="new-password" /><Button type="button" variant="outline" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"}>{show ? <EyeOffIcon /> : <EyeIcon />}</Button></div>
          </Field>
          <Field label="Note (not secret)"><Textarea rows={2} value={v.notes} onChange={set("notes")} placeholder="Which account, who to ask…" /></Field>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onClose(false)}>Cancel</Button><Button type="submit" disabled={busy || !v.service.trim() || (!item && !v.secret)}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ item, onClose }: { item: Item; onClose: (saved: boolean) => void }) {
  const { data, call } = useFlows();
  const [sel, setSel] = useState<Record<string, boolean | undefined>>(() => Object.fromEntries((item.sharedWith ?? []).map((s) => [s.userId, s.canReveal])));
  const [busy, setBusy] = useState(false);
  const people = (data?.users ?? []).filter((u) => u.status === "Active");
  async function save() {
    setBusy(true);
    const r = await call("assignVault", { vaultId: item.vaultId, users: Object.entries(sel).filter(([, v]) => v !== undefined).map(([userId, canReveal]) => ({ userId, canReveal: !!canReveal })) });
    setBusy(false);
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success("Saved");
    onClose(true);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Who can use {item.service}?</DialogTitle><DialogDescription>“Use” lets them see it and open the login page. “Reveal” also lets them see and copy the password — every time is logged.</DialogDescription></DialogHeader>
        <div className="grid gap-1">
          {people.map((u) => (
            <div key={u.userId} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50">
              <label className="flex flex-1 cursor-pointer items-center gap-2"><input type="checkbox" className="size-4" checked={sel[u.userId] !== undefined} onChange={(e) => setSel((s) => ({ ...s, [u.userId]: e.target.checked ? false : undefined }))} /><Avatar userId={u.userId} size={22} />{u.name}<span className="text-xs text-muted-foreground">{u.department}</span></label>
              <label className={cn("flex items-center gap-1 text-xs", sel[u.userId] === undefined && "invisible")}><input type="checkbox" className="size-3.5" checked={!!sel[u.userId]} onChange={(e) => setSel((s) => ({ ...s, [u.userId]: e.target.checked }))} /> may reveal</label>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
