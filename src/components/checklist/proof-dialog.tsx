/* eslint-disable @next/next/no-img-element -- the pictures are small data URLs, not files next/image could optimise */
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Spinner } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

const MAX_CHARS = 44000; // the sheet keeps the picture in one cell (50,000 characters at most)

/** Any photo or screenshot → a small JPEG that fits one cell. Tries smaller sizes until it fits. */
export async function shrinkToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("This file is not a picture")); i.src = url; });
    for (const side of [900, 720, 560, 440, 340, 260]) {
      const k = Math.min(1, side / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext("2d");
      if (!g) break;
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // a PNG with transparency would turn black otherwise
      g.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.72, 0.58, 0.45]) { const out = c.toDataURL("image/jpeg", q); if (out.length <= MAX_CHARS) return out; }
    }
    throw new Error("The picture is too detailed to keep. Try a smaller one or a screenshot.");
  } finally { URL.revokeObjectURL(url); }
}

/** Proof for a checklist task: a picture, a note (or link) — at least one of them. */
export function ProofDialog({ clId, title, onClose }: { clId: string; title: string; onClose: () => void }) {
  const { call } = useFlows();
  const [note, setNote] = useState("");
  const [remarks, setRemarks] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(""); setWorking(true);
    try { setImage(await shrinkToJpeg(f)); } catch (e) { setImage(""); setErr(e instanceof Error ? e.message : "Could not use this picture"); }
    setWorking(false);
    if (file.current) file.current.value = "";
  }
  async function save() {
    setBusy(true); setErr("");
    const r = await call("completeChecklist", { clId, proof: note, proofImage: image, remarks });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    toast.success("Done");
    onClose();
  }
  const ready = !!image || !!note.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="-mt-1 text-sm text-muted-foreground">This task needs proof. Add a <b>picture</b> or write a <b>note / link</b> — at least one.</p>
        <div className="grid gap-3">
          <div className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">Picture</div>
            {image ? (
              <div className="relative w-fit">
                    <img src={image} alt="Your proof" className="max-h-56 rounded-lg border" />
                <button type="button" onClick={() => setImage("")} aria-label="Remove the picture" className="absolute -right-2 -top-2 rounded-full border bg-white p-1 shadow"><XIcon className="size-3.5" /></button>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={working} onClick={() => file.current?.click()}>{working ? <Spinner /> : <><ImageIcon /> Choose or take a picture</>}</Button>
            )}
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <p className="mt-1.5 text-xs text-muted-foreground">Photo or screenshot. It is made small automatically.</p>
          </div>
          <Field label="Note or link" hint="For example a Drive link, an invoice number, or what you did."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a short note, or paste a link" /></Field>
          <Field label="Remarks (optional)"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || working || !ready}>{busy ? <Spinner /> : "Mark done"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "View picture": fetches the proof picture of one entry when asked (it is never part of the normal page data). */
export function ProofPicture({ clId }: { clId: string }) {
  const { call } = useFlows();
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  async function show() {
    setOpen(true); setErr("");
    if (src) return;
    const r = await call<{ image: string }>("getChecklistProof", { clId });
    if (r.ok) setSrc(r.data!.image); else setErr(r.error || "Could not open the picture");
  }
  return (
    <>
      <button type="button" onClick={show} className="inline-flex items-center gap-1 text-primary underline"><ImageIcon className="size-3" /> picture</button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Proof picture</DialogTitle></DialogHeader>
            {err ? <p role="alert" className="text-sm text-red-700">{err}</p> : src ? <img src={src} alt="Proof" className="max-h-[70dvh] w-full rounded-lg border object-contain" /> : <div className="flex justify-center py-8"><Spinner /></div>}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
