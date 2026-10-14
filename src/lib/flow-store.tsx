"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FLOW_TABLES, type Absence, type Flow, type FlowBundle, type FlowItem, type FlowTask, type FlowUser } from "@/lib/flow-types";
import { parseFlow } from "@/lib/flow";
import { mergeTables, type TableMap } from "@/lib/merge";
import { nowDT, todayStr } from "@/lib/dates";
import type { ApiResult } from "@/lib/types";
import { MODULE_IDS, type Action, type Cap, type ModuleId } from "@/lib/permissions";

interface FlowStore {
  data: FlowBundle | null;
  loading: boolean;
  error: string | null;
  flows: Flow[];
  userById: (id: string) => FlowUser | undefined;
  userName: (id: string) => string;
  meId: string;
  isAdmin: boolean;
  isSuper: boolean;
  /** Wall-clock "now" (re-evaluated on every render). */
  now: () => string;
  today: string;
  refresh: () => Promise<void>;
  /** Load a flow's full history (all completed entries), merging into the current data. */
  loadHistory: (flowId: string) => Promise<void>;
  /** Put entries fetched elsewhere (search results) into the local data so the entry panel can open them. */
  absorb: (items: FlowItem[], tasks: FlowTask[]) => void;
  /** Show a change at once (before the server answers). Returns a function that puts the old row back if the server says no. */
  optimistic: (sheet: "Checklist_Log" | "Flow_Tasks", before: Record<string, unknown>, after: Record<string, unknown>) => () => void;
  /** Run any action. Writes merge the returned row changes into the local data. Never throws. */
  call: <T = unknown>(action: string, payload?: unknown) => Promise<ApiResult<T>>;
  /** What the signed-in person may do (set by the Super Admin on the Access page). */
  can: (cap: Cap) => boolean;
  /** May I do this (module + action)? Server-checked as well — this only decides what to show. */
  allow: (module: ModuleId, action: Action) => boolean;
  /** Do I have this module at all (can I view it)? A module I do not have does not exist for me. */
  has: (module: ModuleId) => boolean;
  /** Is this person inside my reach in that module (own · team · department · everyone)? */
  inReach: (userId: string, module?: ModuleId | "people" | "work") => boolean;
  /** Active people I may see in a module, myself first. For pickers and lists. */
  peopleFor: (module: ModuleId) => FlowUser[];
  absencesNow: Absence[];
  itemsOf: (flowId: string) => FlowItem[];
  tasksOf: (itemId: string) => FlowTask[];
}

const Ctx = createContext<FlowStore | null>(null);
export const useFlows = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useFlows outside FlowProvider");
  return s;
};

const TABLES = FLOW_TABLES as unknown as TableMap<FlowBundle>;

export function FlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<FlowBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (qs = ""): Promise<FlowBundle | null> => {
    const res = await fetch(`/api/flow-data${qs}`, { cache: "no-store" });
    const json = (await res.json()) as ApiResult<FlowBundle>;
    if (res.status === 401) { router.replace("/login"); return null; }
    if (!json.ok || !json.data) throw new Error(json.error || "Could not load data");
    return json.data;
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const d = await fetchData();
      if (d) { setData(d); setError(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load data");
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  // initial load; state is only set after the awaited response
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  // refresh when the phone wakes up, and keep the notification bell fresh while the app is open
  useEffect(() => {
    let last = Date.now();
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - last > 60_000) { last = Date.now(); refresh(); } };
    const timer = setInterval(() => { if (document.visibilityState === "visible") { last = Date.now(); refresh(); } }, 120_000);
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(timer); };
  }, [refresh]);

  const loadHistory = useCallback(async (flowId: string) => {
    try {
      const d = await fetchData(`?flowId=${encodeURIComponent(flowId)}&all=1`);
      if (d) setData((cur) => (cur ? mergeTables(cur, TABLES, { Flow_Items: d.items as never, Flow_Tasks: d.tasks as never }) : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load history");
    }
  }, [fetchData]);

  const absorb = useCallback((i: FlowItem[], t: FlowTask[]) => {
    setData((cur) => (cur ? mergeTables(cur, TABLES, { Flow_Items: i as never, Flow_Tasks: t as never }) : cur));
  }, []);

  const optimistic = useCallback((sheet: "Checklist_Log" | "Flow_Tasks", before: Record<string, unknown>, after: Record<string, unknown>) => {
    setData((cur) => (cur ? mergeTables(cur, TABLES, { [sheet]: [after] } as never) : cur));
    return () => setData((cur) => (cur ? mergeTables(cur, TABLES, { [sheet]: [before] } as never) : cur));
  }, []);

  const call = useCallback(async <T,>(action: string, payload: unknown = {}): Promise<ApiResult<T>> => {
    try {
      const res = await fetch("/api/mutate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: payload }) });
      if (res.status === 401) { router.replace("/login"); return { ok: false, error: "Session expired", code: "UNAUTHORIZED" }; }
      const json = (await res.json()) as ApiResult<T>;
      if (json.ok) {
        if (json.changes || json.removed) setData((cur) => (cur ? mergeTables(cur, TABLES, json.changes as never, json.removed) : cur));
        json.warnings?.forEach((w) => toast.warning(w));
        // holiday changes re-plan many tasks on the server; settings change what the app shows: pull the fresh plan
        if (action === "addHolidays" || action === "deleteHoliday" || action === "replanFlow" || action === "saveSettings") refresh();
      } else if (json.code === "CONFLICT") {
        refresh();
      }
      return json;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error — check your connection and try again", code: "NETWORK" };
    }
  }, [router, refresh]);

  const flows = useMemo(() => (data?.flows ?? []).map(parseFlow), [data?.flows]);
  const users = data?.users;
  const userById = useCallback((id: string) => users?.find((u) => u.userId === id), [users]);
  const userName = useCallback((id: string) => users?.find((u) => u.userId === id)?.name ?? (id || "—"), [users]);
  const today = useMemo(() => todayStr(), []);
  const items = data?.items;
  const tasks = data?.tasks;
  const itemsOf = useCallback((flowId: string) => (items ?? []).filter((i) => i.flowId === flowId), [items]);
  const tasksOf = useCallback((itemId: string) => (tasks ?? []).filter((t) => t.itemId === itemId).sort((a, b) => a.seq - b.seq), [tasks]);

  const can = useCallback((cap: Cap) => !!data?.can?.[cap], [data?.can]);
  const allow = useCallback((m: ModuleId, a: Action) => !!data?.perms?.[m]?.a.includes(a), [data?.perms]);
  const has = useCallback((m: ModuleId) => !!data?.perms?.[m]?.a.includes("view"), [data?.perms]);
  const reach = useMemo(() => Object.fromEntries(MODULE_IDS.map((m) => [m, { all: !!data?.reach?.[m]?.all, ids: new Set(data?.reach?.[m]?.ids ?? []) }])) as Record<ModuleId, { all: boolean; ids: Set<string> }>, [data?.reach]);
  const inReach = useCallback((id: string, module: ModuleId | "people" | "work" = "attendance") => { const r = reach[module === "people" ? "attendance" : module === "work" ? "fms" : module]; return !!r && (r.all || r.ids.has(id)); }, [reach]);
  const meIdForList = data?.me.userId ?? "";
  const peopleFor = useCallback((m: ModuleId) => (users ?? []).filter((u) => u.status === "Active" && (reach[m].all || reach[m].ids.has(u.userId))).sort((a, b) => (a.userId === meIdForList ? -1 : b.userId === meIdForList ? 1 : a.name.localeCompare(b.name))), [users, reach, meIdForList]);

  const value: FlowStore = {
    data, loading, error, flows, userById, userName, meId: data?.me.userId ?? "",
    isAdmin: data?.me.role === "SUPER_ADMIN" || data?.me.role === "ADMIN", isSuper: data?.me.role === "SUPER_ADMIN",
    now: nowDT, today, refresh, loadHistory, absorb, optimistic, call, can, allow, has, inReach, peopleFor, absencesNow: data?.absences ?? [], itemsOf, tasksOf,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Send people away from a screen they are not allowed to use (the Super Admin always may). */
export function useRequireCap(cap: Cap) {
  const { data, can } = useFlows();
  const router = useRouter();
  const ok = !!data && can(cap);
  useEffect(() => { if (data && !ok) router.replace("/flows/panel"); }, [data, ok, router]);
  return ok;
}
