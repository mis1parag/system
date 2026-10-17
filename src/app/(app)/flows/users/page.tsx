"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { IdCardIcon, PencilIcon, PlusIcon, ShieldCheckIcon, UserMinusIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/avatar";
import { Field, PageHeader, Pill, Spinner } from "@/components/common";
import { DataGrid, type Col } from "@/components/data-grid";
import { FilterBar, useFilters, type QuickDef } from "@/components/filters/filter-bar";
import { applyFilters, type FieldDef } from "@/lib/filters";
import { UserAccessDialog } from "@/components/access/user-access-dialog";
import { ProfileDialog } from "@/components/people/profile-editor";
import { BulkUsersDialog } from "@/components/team/bulk-users-dialog";
import { RemoveUserDialog } from "@/components/people/exit-dialogs";
import { fmtDate } from "@/lib/dates";
import type { FlowUser } from "@/lib/flow-types";
import { useFlows } from "@/lib/flow-store";
import { ROLE_LABEL, type Role } from "@/lib/types";

export default function UsersPage() {
  const { data, userName, allow, isSuper, inReach, peopleFor, meId } = useFlows();
  const [remove, setRemove] = useState<FlowUser | null>(null);
  const people = peopleFor("employees");
  const [edit, setEdit] = useState<FlowUser | "new" | null>(null);
  const [profile, setProfile] = useState("");
  const [access, setAccess] = useState("");
  const [many, setMany] = useState(false);
  const [fstate, setFstate] = useFilters("employees:list", "active");
  const mine = useMemo(() => (data?.users ?? []).filter((u) => u.deleted !== "Y" && inReach(u.userId, "employees")), [data?.users, inReach]);
  if (!data) return null;
  const manage = allow("employees", "create");
  // only the Super Admin changes Admins and the Super Admin; everyone else with Employees · edit changes Managers and Team Members
  // exit, switch off, reinstate, delete: Admins and the Super Admin (Employees · delete); only the Super Admin for an Admin; never for yourself
  const canRemove = (u: FlowUser) => allow("employees", "delete") && u.userId !== meId && (isSuper || u.role === "STAFF" || u.role === "MANAGER");
  const canEdit = (u: FlowUser) => allow("employees", "edit") && (isSuper || u.role === "STAFF" || u.role === "MANAGER");
  const fields: FieldDef<FlowUser>[] = [
    { key: "dept", label: "Department", type: "select", options: [...new Set(mine.map((u) => u.department).filter(Boolean))].sort().map((d) => ({ value: String(d), label: String(d) })), get: (u) => u.department },
    { key: "role", label: "Role", type: "select", options: (["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] })), get: (u) => u.role },
    { key: "manager", label: "Reporting manager", type: "user", options: mine.map((u) => ({ value: u.userId, label: u.name })), get: (u) => u.managerId },
    { key: "status", label: "Status", type: "select", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }], get: (u) => u.status },
    { key: "empCode", label: "Employee ID", type: "text", get: (u) => u.empCode },
    { key: "name", label: "Name", type: "text", get: (u) => u.name },
  ];
  const quickFns: Record<string, (u: FlowUser) => boolean> = { active: (u) => u.status === "Active", all: () => true, inactive: (u) => u.status !== "Active", exited: (u) => !!u.exitDate, managers: (u) => u.role === "MANAGER" || u.role === "ADMIN" || mine.some((x) => x.managerId === u.userId), nomanager: (u) => u.status === "Active" && !u.managerId && u.role !== "SUPER_ADMIN" };
  const quick: QuickDef[] = [{ id: "active", label: "Active", count: mine.filter(quickFns.active).length }, { id: "managers", label: "Managers" }, { id: "nomanager", label: "No reporting manager", count: mine.filter(quickFns.nomanager).length }, { id: "exited", label: "Exits", count: mine.filter(quickFns.exited).length }, { id: "inactive", label: "Left / inactive", count: mine.filter(quickFns.inactive).length }, { id: "all", label: "All" }];
  const rows = applyFilters(mine, fields, fstate, { quick: quickFns, text: (u) => `${u.name} ${u.empCode ?? ""} ${u.department ?? ""}` });
  const cols: Col<FlowUser>[] = [
    { id: "name", label: "Name", sort: (u) => u.name, render: (u) => <button className="flex items-center gap-2 text-left font-medium hover:text-primary" onClick={() => setProfile(u.userId)}><Avatar userId={u.userId} size={28} /><span>{u.name}{u.empCode && <span className="block text-[11px] font-normal text-muted-foreground">{u.empCode}</span>}</span></button>, csv: (u) => u.name },
    { id: "dept", label: "Department", sort: (u) => u.department ?? "", render: (u) => <span className="text-muted-foreground">{u.department || "—"}</span> },
    { id: "role", label: "Role", sort: (u) => ROLE_LABEL[u.role as Role] ?? u.role, render: (u) => <span>{ROLE_LABEL[u.role as Role] ?? u.role}</span> },
    { id: "manager", label: "Reporting manager", sort: (u) => (u.managerId ? userName(u.managerId) : ""), render: (u) => <span>{u.managerId ? userName(u.managerId) : "—"}</span> },
    { id: "empCode", label: "Employee ID", hidden: true, sort: (u) => u.empCode ?? "", render: (u) => <span className="text-xs">{u.empCode || "—"}</span> },
    ...(manage ? [{ id: "signin", label: "Sign in", hidden: true, sort: (u: FlowUser) => u.email || u.mobile || "", render: (u: FlowUser) => <span className="block max-w-56 truncate text-xs" title={`${u.email ?? ""} ${u.mobile ?? ""}`}>{u.email || u.mobile}</span> } as Col<FlowUser>] : []),
    { id: "status", label: "Status", sort: (u) => u.status, render: (u) => u.exitDone === "Y" ? <Pill tone="red">Left {fmtDate(u.exitDate!)}</Pill> : u.exitDate ? <Pill tone="amber">Leaving {fmtDate(u.exitDate)}</Pill> : <Pill tone={u.status === "Active" ? "green" : "gray"}>{u.status}</Pill> },
    { id: "exit", label: "Exit", hidden: true, sort: (u) => u.exitDate ?? "", render: (u) => u.exitDate ? <span className="text-xs">{fmtDate(u.exitDate, true)} · {u.exitType}{u.exitReason ? ` — ${u.exitReason}` : ""}</span> : <span className="text-muted-foreground">—</span>, csv: (u) => (u.exitDate ? `${u.exitDate} ${u.exitType ?? ""}` : "") },
    { id: "actions", label: "", render: (u) => (
      <span className="whitespace-nowrap">
        <button aria-label={`Open profile of ${u.name}`} title="Photo and details" onClick={() => setProfile(u.userId)} className="rounded p-1 text-muted-foreground hover:bg-muted"><IdCardIcon className="size-4" /></button>
        {canEdit(u) && <button aria-label={`Edit ${u.name}`} title="Edit account" onClick={() => setEdit(u)} className="rounded p-1 text-muted-foreground hover:bg-muted"><PencilIcon className="size-3.5" /></button>}
        {canRemove(u) && <button aria-label={`Exit, switch off or delete ${u.name}`} title="Exit / switch off / delete" onClick={() => setRemove(u)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-700"><UserMinusIcon className="size-3.5" /></button>}
        {isSuper && <button aria-label={`Access of ${u.name}`} title="What this person can do" onClick={() => setAccess(u.userId)} className="rounded p-1 text-muted-foreground hover:bg-muted"><ShieldCheckIcon className="size-4" /></button>}
      </span>) },
  ];

  return (
    <>
      <PageHeader
        title="Team & profiles"
        subtitle={isSuper ? "Everyone who signs in: department, who they report to, photo and employee details." : "People in your department and the people who report to you."}
        actions={manage && <><Button variant="outline" onClick={() => setMany(true)}><UsersIcon /> Add many</Button><Button onClick={() => setEdit("new")}><PlusIcon /> Add person</Button></>}
        help={{ id: "team", title: "Department and reporting manager", text: "Each person belongs to a department and has a reporting manager. People see the work of their own department and of the people who report to them — not other departments (unless the Super Admin allows it on the Access page). The reporting manager gets escalations and approves leave and more-time requests for their team." }}
      />
      <Tabs defaultValue="people">
        <div className="mb-3 overflow-x-auto"><TabsList><TabsTrigger value="people">People</TabsTrigger><TabsTrigger value="chart">Who reports to whom</TabsTrigger></TabsList></div>
        <TabsContent value="people">
          <FilterBar page="employees:list" module="employees" fields={fields} quick={quick} state={fstate} onChange={setFstate} shown={rows.length} total={mine.length} placeholder="Search name, ID, department…" />
          <DataGrid id="people" columns={cols} rows={rows} rowKey={(u) => u.userId} exportAs={{ name: "people", module: "employees" }} />
          <p className="mt-2 text-xs text-muted-foreground">{people.length} active people in your reach.{manage ? " Sign-in uses mobile number (or email / user ID) and a PIN. Leave the PIN empty when editing to keep the current one." : ""}</p>
        </TabsContent>
        <TabsContent value="chart"><OrgChart users={mine.filter((u) => u.status === "Active")} onOpen={setProfile} /></TabsContent>
      </Tabs>
      {remove && <RemoveUserDialog user={remove} onClose={() => setRemove(null)} />}
      {many && <BulkUsersDialog onClose={() => setMany(false)} />}
      {edit && <UserDialog user={edit === "new" ? undefined : edit} isSuper={isSuper} onClose={() => setEdit(null)} />}
      {profile && <ProfileDialog userId={profile} onClose={() => setProfile("")} />}
      {access && data.roles && <UserAccessDialog userId={access} roles={data.roles} onClose={() => setAccess("")} />}
    </>
  );
}

/** Nested list: each person under their reporting manager. People whose manager is outside the list start a branch of their own. */
function OrgChart({ users, onOpen }: { users: FlowUser[]; onOpen: (id: string) => void }) {
  const ids = new Set(users.map((u) => u.userId));
  const kids = new Map<string, FlowUser[]>();
  for (const u of users) { const m = u.managerId && ids.has(u.managerId) && u.managerId !== u.userId ? u.managerId : ""; (kids.get(m) ?? kids.set(m, []).get(m)!).push(u); }
  for (const l of kids.values()) l.sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const node = (u: FlowUser, depth: number): React.ReactNode => {
    if (seen.has(u.userId) || depth > 8) return null; // a loop in the data must not freeze the page
    seen.add(u.userId);
    const list = kids.get(u.userId) ?? [];
    const row = (
      <button className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-sm hover:border-primary/40" onClick={() => onOpen(u.userId)}>
        <Avatar userId={u.userId} size={28} />
        <span><span className="font-medium">{u.name}</span><span className="block text-[11px] text-muted-foreground">{ROLE_LABEL[u.role as Role] ?? u.role}{u.department ? ` · ${u.department}` : ""}{list.length ? ` · ${list.length} report${list.length === 1 ? "" : "s"}` : ""}</span></span>
      </button>
    );
    return (
      <li key={u.userId} className="list-none">
        {list.length ? <details open={depth < 1}><summary className="mb-1 cursor-pointer marker:text-muted-foreground">{row}</summary><ul className="ml-5 grid gap-1.5 border-l pl-3 pb-1">{list.map((c) => node(c, depth + 1))}</ul></details> : <div className="mb-1 ml-4">{row}</div>}
      </li>
    );
  };
  const roots = kids.get("") ?? [];
  if (!users.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nobody to show.</p>;
  return <ul className="grid gap-1.5">{roots.map((u) => node(u, 0))}</ul>;
}

function UserDialog({ user, isSuper, onClose }: { user?: FlowUser; isSuper: boolean; onClose: () => void }) {
  const { call, data, allow } = useFlows();
  const [v, setV] = useState({ name: user?.name ?? "", role: (user?.role ?? "STAFF") as string, mobile: user?.mobile ?? "", email: user?.email ?? "", department: user?.department ?? (isSuper ? "" : data?.me.department ?? ""), status: user?.status ?? "Active", pin: "", managerId: user ? user.managerId ?? "" : isSuper ? "" : data?.me.userId ?? "", empCode: user?.empCode ?? "", leaveAllot: String(user?.leaveAllot ?? "") });
  const [notify, setNotify] = useState<string[]>((user?.notify || "app").split(",").filter(Boolean));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const depts = [...new Set((data?.users ?? []).map((u) => u.department).filter(Boolean))].sort() as string[];

  async function save() {
    setBusy(true); setErr("");
    const r = await call("saveUser", { userId: user?.userId, ...v, notify: notify.join(",") || "app" });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success("Saved");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{user ? `Edit ${user.name}` : "Add person"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *" className="col-span-2"><Input value={v.name} onChange={set("name")} /></Field>
          <Field label="Role">
            <NativeSelect value={v.role} onChange={set("role")} disabled={!isSuper && !!user && !["STAFF", "MANAGER"].includes(user.role)}>
              <option value="STAFF">Team Member (does the work)</option>
              <option value="MANAGER">Manager (looks after a team)</option>
              {isSuper && <option value="ADMIN">Admin (almost everything)</option>}
              {isSuper && <option value="SUPER_ADMIN">Super Admin (everything)</option>}
            </NativeSelect>
          </Field>
          {allow("employees", "delete") && user?.exitDone !== "Y" ? <Field label="Status" hint="To record that someone left, use the exit button in the list."><NativeSelect value={v.status} onChange={set("status")}><option>Active</option><option>Inactive</option></NativeSelect></Field> : <div />}
          <Field label="Department" hint="People see their own department's work"><Input list="dept-list" value={v.department} onChange={set("department")} placeholder="Accounts, CRM, Ecommerce…" /><datalist id="dept-list">{depts.map((d) => <option key={d} value={d} />)}</datalist></Field>
          <Field label="Reporting manager" hint="Gets escalations, approves leave and more-time requests">
            <NativeSelect value={v.managerId} onChange={set("managerId")}><option value="">—</option>{(data?.users ?? []).filter((u) => u.status === "Active" && u.userId !== user?.userId).map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Email (sign in)"><Input type="email" value={v.email} onChange={set("email")} /></Field>
          <Field label="Mobile" hint="Mobile or email is needed to sign in"><Input inputMode="numeric" value={v.mobile} onChange={set("mobile")} /></Field>
          <Field label="Employee ID" hint="e.g. DE0007 — as in your attendance sheet"><Input value={v.empCode} onChange={set("empCode")} /></Field>
          <Field label="Leave days per year"><Input inputMode="decimal" value={v.leaveAllot} onChange={set("leaveAllot")} placeholder="0" /></Field>
          <Field label="Send alerts by" className="col-span-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{["app", "email", "whatsapp"].map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 rounded border-input" checked={notify.includes(c)} onChange={(e) => setNotify(e.target.checked ? [...notify, c] : notify.filter((x) => x !== c))} /> {c === "app" ? "In the app" : c === "email" ? "Email" : "WhatsApp"}</label>)}</div>
          </Field>
          <Field label={user ? "New PIN (leave blank to keep)" : "PIN * (4–8 digits)"} className="col-span-2"><Input inputMode="numeric" autoComplete="new-password" value={v.pin} onChange={set("pin")} /></Field>
        </div>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>{busy ? <Spinner /> : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

