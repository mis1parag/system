"use client";

import { useEffect, useRef, useState } from "react";
import { UserAccessDialog } from "@/components/access/user-access-dialog";
import { toast } from "sonner";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/avatar";
import { Field, Spinner } from "@/components/common";
import { fmtDate } from "@/lib/dates";
import { useFlows } from "@/lib/flow-store";
import { ROLE_LABEL, type Role } from "@/lib/types";

const TYPES = ["Full time", "Part time", "Contract", "Intern", "Consultant"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
interface Details {
  designation: string; joinDate: string; employmentType: string; workLocation: string; dob: string; gender: string; bloodGroup: string; address: string;
  personalEmail: string; emergencyName: string; emergencyPhone: string; notes: string;
}
const EMPTY: Details = { designation: "", joinDate: "", employmentType: "", workLocation: "", dob: "", gender: "", bloodGroup: "", address: "", personalEmail: "", emergencyName: "", emergencyPhone: "", notes: "" };

/** Centre-crops a picked photo to a small square JPEG (about 10 KB) so it fits a sheet cell. */
function shrink(file: File, side = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = side;
      const ctx = c.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return reject(new Error("This browser cannot resize pictures")); }
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
      URL.revokeObjectURL(url);
      let q = 0.82, out = c.toDataURL("image/jpeg", q);
      while (out.length > 40000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture")); };
    img.src = url;
  });
}

/** Picture + employee details of one person. Everyone edits their own personal part; HR fields need "Add and edit people". */
export function ProfileEditor({ userId }: { userId: string }) {
  const { data, call, userName, userById, meId } = useFlows();
  const u = userById(userId);
  const [d, setD] = useState<Details>(EMPTY);
  const [rights, setRights] = useState({ canEdit: false, canEditHr: false });
  const [loaded, setLoaded] = useState<"loading" | "ok" | "no">("loading");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    // load once per person; setState only after the response
    call<{ details: Partial<Details>; canEdit: boolean; canEditHr: boolean }>("getEmployee", { userId }).then((r) => {
      if (!live) return;
      if (!r.ok) { setLoaded("no"); return; }
      setD({ ...EMPTY, ...r.data!.details });
      setRights({ canEdit: r.data!.canEdit, canEditHr: r.data!.canEditHr });
      setLoaded("ok");
    });
    return () => { live = false; };
  }, [userId, call]);

  const canPhoto = userId === meId || rights.canEdit;
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((cur) => ({ ...cur, [k]: e.target.value }));

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy("photo"); setErr("");
    try {
      const image = await shrink(f);
      const r = await call("saveProfilePhoto", { userId, image });
      if (!r.ok) setErr(r.error || "Could not save the photo"); else toast.success("Photo saved");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not read the picture"); }
    setBusy("");
    if (file.current) file.current.value = "";
  }
  async function removePhoto() {
    setBusy("photo");
    const r = await call("saveProfilePhoto", { userId, image: "" });
    setBusy("");
    if (!r.ok) setErr(r.error || "Could not remove"); else toast.success("Photo removed");
  }
  async function save() {
    setBusy("save"); setErr("");
    const r = await call("saveEmployee", { userId, ...d });
    setBusy("");
    if (!r.ok) setErr(r.error || "Could not save"); else toast.success("Details saved");
  }

  if (!u) return null;
  const mgr = u.managerId ? userName(u.managerId) : "—";
  const team = (data?.users ?? []).filter((x) => x.managerId === userId && x.status === "Active");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar userId={userId} size={84} className="ring-2 ring-border" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{u.name}</div>
          <div className="text-sm text-muted-foreground">{ROLE_LABEL[u.role as Role] ?? u.role}{u.department ? ` · ${u.department}` : ""}{u.empCode ? ` · ID ${u.empCode}` : ""}</div>
          <div className="text-sm text-muted-foreground">Reporting manager: <b className="text-foreground">{mgr}</b>{team.length ? ` · ${team.length} report${team.length === 1 ? "" : "s"} to ${userId === meId ? "you" : "them"}` : ""}</div>
          {canPhoto && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input ref={file} type="file" accept="image/*" className="sr-only" id={`photo-${userId}`} onChange={(e) => pick(e.target.files?.[0])} />
              <Button size="sm" variant="outline" disabled={busy === "photo"} onClick={() => file.current?.click()}>{busy === "photo" ? <Spinner /> : <><CameraIcon /> {u.photoVer ? "Change photo" : "Upload photo"}</>}</Button>
              {u.photoVer && <Button size="sm" variant="ghost" disabled={busy === "photo"} onClick={removePhoto}><Trash2Icon /> Remove</Button>}
            </div>
          )}
        </div>
      </div>

      {loaded === "loading" && <p className="text-sm text-muted-foreground">Loading details…</p>}
      {loaded === "no" && <p className="text-sm text-muted-foreground">You can see the picture and reporting line of this person, but not their personal details.</p>}
      {loaded === "ok" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation"><Input value={d.designation} onChange={set("designation")} disabled={!rights.canEditHr} placeholder="Executive, Designer…" /></Field>
          <Field label="Employment type"><NativeSelect value={d.employmentType} onChange={set("employmentType")} disabled={!rights.canEditHr}><option value="">—</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
          <Field label="Date of joining"><Input type="date" value={d.joinDate} onChange={set("joinDate")} disabled={!rights.canEditHr} /></Field>
          <Field label="Work location"><Input value={d.workLocation} onChange={set("workLocation")} disabled={!rights.canEditHr} placeholder="Office, city" /></Field>
          <Field label="Date of birth"><Input type="date" value={d.dob} onChange={set("dob")} disabled={!rights.canEdit} /></Field>
          <Field label="Gender"><NativeSelect value={d.gender} onChange={set("gender")} disabled={!rights.canEdit}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></NativeSelect></Field>
          <Field label="Blood group"><NativeSelect value={d.bloodGroup} onChange={set("bloodGroup")} disabled={!rights.canEdit}><option value="">—</option>{BLOOD.map((b) => <option key={b}>{b}</option>)}</NativeSelect></Field>
          <Field label="Personal email"><Input type="email" value={d.personalEmail} onChange={set("personalEmail")} disabled={!rights.canEdit} /></Field>
          <Field label="Address" className="col-span-2"><Textarea rows={2} value={d.address} onChange={set("address")} disabled={!rights.canEdit} /></Field>
          <Field label="Emergency contact"><Input value={d.emergencyName} onChange={set("emergencyName")} disabled={!rights.canEdit} placeholder="Name and relation" /></Field>
          <Field label="Emergency phone"><Input inputMode="tel" value={d.emergencyPhone} onChange={set("emergencyPhone")} disabled={!rights.canEdit} /></Field>
          {rights.canEditHr && <Field label="HR notes (only managers see this)" className="col-span-2"><Textarea rows={2} value={d.notes} onChange={set("notes")} /></Field>}
          {d.joinDate && <p className="col-span-2 text-xs text-muted-foreground">Joined {fmtDate(d.joinDate, true)}.</p>}
          {err && <p role="alert" className="col-span-2 text-sm text-red-700">{err}</p>}
          {rights.canEdit && <div className="col-span-2"><Button onClick={save} disabled={busy === "save"}>{busy === "save" ? <Spinner /> : "Save details"}</Button></div>}
        </div>
      )}
      {loaded !== "ok" && err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

export function ProfileDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { isSuper, data } = useFlows();
  const [access, setAccess] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Profile</DialogTitle></DialogHeader>
        <ProfileEditor userId={userId} />
        <DialogFooter>{isSuper && data?.roles && <Button variant="outline" className="mr-auto" onClick={() => setAccess(true)}>What can this person do?</Button>}<Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        {access && data?.roles && <UserAccessDialog userId={userId} roles={data.roles} onClose={() => setAccess(false)} />}
      </DialogContent>
    </Dialog>
  );
}
