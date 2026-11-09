"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { PermissionMatrix, overridesOf } from "@/components/access/permission-matrix";
import { Field, Spinner } from "@/components/common";
import type { RoleInfo } from "@/lib/flow-types";
import { effectivePermSet, type PermSet } from "@/lib/permissions";
import { useFlows } from "@/lib/flow-store";

/** One person: choose the role, then tick differences. Only the differences are stored. */
export function UserAccessDialog({ userId, roles, onClose }: { userId: string; roles: RoleInfo[]; onClose: () => void }) {
  const { data, call, userName, refresh } = useFlows();
  const u = data?.users.find((x) => x.userId === userId);
  const a = data?.access?.find((x) => x.userId === userId);
  const [role, setRole] = useState(u?.role ?? "STAFF");
  const [roleId, setRoleId] = useState(a?.roleId ?? "");
  const template = useMemo(() => roles.find((r) => r.roleId === (roleId || role))?.perms ?? {}, [roles, roleId, role]);
  const [perms, setPerms] = useState<PermSet>(() => effectivePermSet(u?.role ?? "STAFF", roles.find((r) => r.roleId === (a?.roleId || u?.role))?.perms ?? {}, a?.overrides ?? {}));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [only, setOnly] = useState(u?.notEmployee === "Y");
  if (!u) return null;
  const isSuperUser = role === "SUPER_ADMIN";
  const changeRole = (v: string) => {
    const custom = roles.find((r) => r.roleId === v && !r.system);
    const nextRole = custom ? custom.base : v;
    setRole(nextRole); setRoleId(custom ? v : "");
    setPerms(roles.find((r) => r.roleId === v)?.perms ?? {}); // a new role starts clean; personal changes are made again on top
  };
  async function save() {
    setBusy(true); setErr("");
    const r = await call("saveUserAccess", { userId, role, roleId, overrides: overridesOf(perms, template) });
    // "Super Admin only" (not an employee) is saved on its own, once the role is right
    if (r.ok && (role === "SUPER_ADMIN" ? only : false) !== (u?.notEmployee === "Y")) {
      const r2 = await call("setSuperAdminOnly", { userId, on: role === "SUPER_ADMIN" && only });
      if (!r2.ok) { setBusy(false); setErr(r2.error || "Could not save"); return; }
    }
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success(`Access of ${userName(userId)} saved`);
    onClose();
    await refresh();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>Access of {u.name}</DialogTitle><DialogDescription>Pick the role, then change only what is different for this person. Yellow rows differ from the role.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Role" className="w-60"><NativeSelect value={roleId || role} onChange={(e) => changeRole(e.target.value)}>{roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.name}{r.system ? "" : " (custom)"}</option>)}</NativeSelect></Field>
          <Button variant="ghost" onClick={() => setPerms(template)} disabled={isSuperUser}><RotateCcwIcon /> Same as the role</Button>
        </div>
        {isSuperUser && (
          <label className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input" checked={only} onChange={(e) => setOnly(e.target.checked)} />
            <span><b>Super Admin only — not an employee.</b> Keeps every Super Admin power, but no attendance or leave, no tasks, and the person is left out of team lists, attendance dashboards, rankings, reports and salary.</span>
          </label>
        )}
        {isSuperUser ? <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">Super Admin: everything, always.</p> : <PermissionMatrix value={perms} template={template} onChange={setPerms} />}
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save access"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
