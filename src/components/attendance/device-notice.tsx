"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LaptopIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/common";
import { deviceToken } from "@/lib/device";
import { useFlows } from "@/lib/flow-store";

interface Dev { deviceId: string; label: string; status: "Approved" | "Pending" | "Blocked"; current: boolean }

/** Shown above the check-in button when laptops must be registered: is THIS laptop / phone allowed, and a button to ask. */
export function DeviceNotice() {
  const { call, data } = useFlows();
  const on = !!data?.attRules?.deviceCheck;
  const [devs, setDevs] = useState<Dev[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await call<{ devices: Dev[] }>("myDevices", { deviceToken: deviceToken() });
    if (r.ok) setDevs(r.data!.devices);
  }, [call]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (on) load(); }, [on, load]);
  if (!on) return null;
  const here = devs?.find((d) => d.current);
  async function ask() {
    setBusy(true);
    const r = await call("registerDevice", { deviceToken: deviceToken() });
    setBusy(false);
    if (r.ok) { toast.success("Done — the admin will approve this laptop / phone"); load(); } else toast.error(r.error || "Could not register");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <LaptopIcon className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">This laptop / phone:</span>
      {devs === null ? <span className="text-xs text-muted-foreground">checking…</span>
        : here ? <><Pill tone={here.status === "Approved" ? "green" : here.status === "Pending" ? "amber" : "red"}>{here.status === "Approved" ? "Registered" : here.status === "Pending" ? "Waiting for approval" : "Blocked"}</Pill><span className="text-xs text-muted-foreground">{here.label}</span></>
        : <><Pill tone="gray">Not registered</Pill><Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={ask}>Register this laptop / phone</Button></>}
    </div>
  );
}
