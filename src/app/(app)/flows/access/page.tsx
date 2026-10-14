"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, PlusIcon, RotateCcwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/avatar";
import { PermissionMatrix } from "@/components/access/permission-matrix";
import { UserAccessDialog } from "@/components/access/user-access-dialog";
import { DataTable, Field, PageHeader, Pill, Spinner } from "@/components/common";
import type { RoleInfo } from "@/lib/flow-types";
import { ROLE_INFO, type PermSet, type SystemRole } from "@/lib/permissions";
import { useFlows } from "@/lib/flow-store";
import { cn } from "@/lib/utils";

/** Super Admin only: roles (what each role can do) and people (which role, plus personal changes). */
export default function AccessPage() {
  const { data, isSuper } = useFlows();
  if (!data) return null;
  if (!isSuper || !data.roles) return <p className="py-10 text-center text-sm text-muted-foreground">Only the Super Admin can open this page.</p>;
  return (
    <>
      <PageHeader
        title="Access & roles"
        subtitle="Decide, module by module, what each role and each person can do — and whose records they see."
        help={{ id: "access2", title: "How access works", text: "A person has a role (Admin, Manager, Team Member or a role you create). The role says which modules they have and what they can do in each one: view, create, edit, delete, assign, approve, export, import, manage, configure. “Whose records” says how far they see: only their own, their team, their department, or everyone. A module that is not ticked does not exist for that person — not in the menu, not in search, not in notifications, and the server refuses it. You can also change one person on the People tab." }}
      />
      <Tabs defaultValue="roles">
        <div className="mb-3"><TabsList><TabsTrigger value="roles">Roles</TabsTrigger><TabsTrigger value="people">People</TabsTrigger></TabsList></div>
        <TabsContent value="roles"><RolesTab roles={data.roles} /></TabsContent>
        <TabsContent value="people"><PeopleTab roles={data.roles} /></TabsContent>
      </Tabs>
    </>
  );
}

function RolesTab({ roles }: { roles: RoleInfo[] }) {
  const { call, refresh } = useFlows();
  const [pick, setPick] = useState("ADMIN");
  const [draft, setDraft] = useState<{ id: string; perms: PermSet; name: string; description: string; base: string } | null>(null);
  const [busy, setBusy] = useState("");
  const cur = roles.find((r) => r.roleId === pick) ?? roles[1];
  const d = draft && draft.id === cur.roleId ? draft : { id: cur.roleId, perms: cur.perms, name: cur.name, description: cur.description, base: cur.base };
  const dirty = !!draft && draft.id === cur.roleId && JSON.stringify(draft) !== JSON.stringify({ id: cur.roleId, perms: cur.perms, name: cur.name, description: cur.description, base: cur.base });
  const fixed = cur.roleId === "SUPER_ADMIN";

  async function save() {
    setBusy("save");
    const r = await call<{ roleId: string }>("saveRole", { roleId: cur.roleId, name: d.name, description: d.description, base: d.base, perms: d.perms });
    setBusy("");
    if (!r.ok) { toast.error(r.error || "Could not save"); return; }
    toast.success("Saved");
    setDraft(null);
    if (!cur.system && r.data?.roleId) setPick(r.data.roleId);
    await refresh(); // the new access takes effect everywhere at once
  }
  async function reset() {
    setBusy("reset");
    const r = await call("resetRole", { roleId: cur.roleId });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Could not reset"); else { toast.success("Back to the default"); await refresh(); }
  }
  async function remove() {
    if (!window.confirm(`Delete the role “${cur.name}”? ${cur.people} ${cur.people === 1 ? "person goes" : "people go"} back to the standard access of their built-in role.`)) return;
    setBusy("del");
    const r = await call("deleteRole", { roleId: cur.roleId });
    setBusy("");
    if (!r.ok) toast.error(r.error || "Could not delete"); else { toast.success("Role deleted"); setPick("STAFF"); await refresh(); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="grid content-start gap-1.5">
        {roles.map((r) => (
          <button key={r.roleId} onClick={() => { setPick(r.roleId); setDraft(null); }} className={cn("rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/40", cur.roleId === r.roleId && "border-primary bg-[#efeeff]")}>
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{r.name}</span><span className="text-xs text-muted-foreground">{r.people}</span></div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{r.description || (r.system ? "" : `Behaves like ${ROLE_INFO[r.base as SystemRole]?.label ?? r.base}`)}</div>
            {r.system && r.customized && <Pill tone="amber" className="mt-1">edited</Pill>}
            {!r.system && <Pill tone="violet" className="mt-1">custom</Pill>}
          </button>
        ))}
        <NewRole onCreated={(id) => { setPick(id); setDraft(null); }} />
      </div>
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {cur.system ? (
            <div><div className="text-lg font-semibold">{cur.name}</div><div className="text-sm text-muted-foreground">{cur.description}</div></div>
          ) : (
            <>
              <Field label="Role name" className="w-56"><Input value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} /></Field>
              <Field label="Behaves like" className="w-44" hint="Decides who can edit this person"><NativeSelect value={d.base} onChange={(e) => setDraft({ ...d, base: e.target.value })}><option value="STAFF">Team Member</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></NativeSelect></Field>
              <Field label="Description" className="min-w-52 flex-1"><Input value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} /></Field>
            </>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {cur.system && cur.customized && !fixed && <Button variant="outline" onClick={reset} disabled={busy !== ""}>{busy === "reset" ? <Spinner /> : <><RotateCcwIcon /> Back to default</>}</Button>}
            {!cur.system && <Button variant="outline" className="text-red-700" onClick={remove} disabled={busy !== ""}><Trash2Icon /> Delete role</Button>}
            {!fixed && <Button onClick={save} disabled={!dirty || busy !== ""}>{busy === "save" ? <Spinner /> : "Save role"}</Button>}
          </div>
        </div>
        {fixed && <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground"><ShieldCheckIcon className="mr-1.5 inline size-4 text-emerald-600" />The Super Admin can do everything and cannot be restricted. This protects you from locking yourself out.</p>}
        <PermissionMatrix value={d.perms} readOnly={fixed} onChange={(perms) => setDraft({ ...d, perms })} />
        <p className="text-xs text-muted-foreground">Ticking any action also switches the module on (View). Un-ticking View switches the whole module off for this role.</p>
      </div>
    </div>
  );
}

function NewRole({ onCreated }: { onCreated: (id: string) => void }) {
  const { call, data, refresh } = useFlows();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("STAFF");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function create() {
    setBusy(true); setErr("");
    const src = data?.roles?.find((r) => r.roleId === from);
    const r = await call<{ roleId: string }>("saveRole", { name, base: src?.system ? from : src?.base ?? "STAFF", description: "", perms: src?.perms ?? {} });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not create"); return; }
    toast.success("Role created — now tick what it can do");
    setOpen(false); setName("");
    await refresh();
    onCreated(r.data!.roleId);
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><PlusIcon /> New role</Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>New role</DialogTitle><DialogDescription>Example: “Sales Manager” — FMS, customers and reports, but no vault and no settings.</DialogDescription></DialogHeader>
            <div className="grid gap-3">
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
              <Field label="Start from"><NativeSelect value={from} onChange={(e) => setFrom(e.target.value)}>{(data?.roles ?? []).filter((r) => r.roleId !== "SUPER_ADMIN").map((r) => <option key={r.roleId} value={r.roleId}>{r.name}</option>)}</NativeSelect></Field>
              {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} disabled={busy || !name.trim()}>{busy ? <Spinner /> : <><CopyIcon /> Create</>}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function PeopleTab({ roles }: { roles: RoleInfo[] }) {
  const { data } = useFlows();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState("");
  const rows = useMemo(() => (data?.users ?? []).filter((u) => u.status === "Active" && (!q || `${u.name} ${u.department ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data?.users, q]);
  const acc = new Map((data?.access ?? []).map((a) => [a.userId, a]));
  const roleName = (id: string) => roles.find((r) => r.roleId === id)?.name ?? id;
  return (
    <>
      <div className="mb-3 flex items-center gap-2"><Input className="h-9 w-60" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="text-xs text-muted-foreground">{rows.length} people</span></div>
      <DataTable head={["Person", "Department", "Role", "Personal changes", ""]}>
        {rows.map((u) => {
          const a = acc.get(u.userId);
          const n = Object.keys(a?.overrides ?? {}).length;
          return (
            <tr key={u.userId}>
              <td><span className="flex items-center gap-2 font-medium"><Avatar userId={u.userId} size={26} />{u.name}</span></td>
              <td className="text-muted-foreground">{u.department || "—"}</td>
              <td>{a?.roleId ? <span>{roleName(a.roleId)} <span className="text-xs text-muted-foreground">(custom)</span></span> : roleName(u.role)}</td>
              <td>{n ? <Pill tone="amber">{n} module{n === 1 ? "" : "s"} changed</Pill> : <span className="text-xs text-muted-foreground">as the role</span>}</td>
              <td className="text-right"><Button size="sm" variant="outline" onClick={() => setEdit(u.userId)}>Edit access</Button></td>
            </tr>
          );
        })}
      </DataTable>
      {edit && <UserAccessDialog userId={edit} roles={roles} onClose={() => setEdit("")} />}
    </>
  );
}
