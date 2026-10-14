"use client";

import { ACTIONS, MODULES, SCOPES, type Action, type Grant, type ModuleId, type PermSet, type Scope } from "@/lib/permissions";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

const same = (a?: Grant, b?: Grant) => JSON.stringify([[...(a?.a ?? [])].sort(), a?.s ?? "own"]) === JSON.stringify([[...(b?.a ?? [])].sort(), b?.s ?? "own"]);

/**
 * The one screen for "who can do what": modules down the side, actions across, and — for modules that have people's records in them —
 * whose records are in reach. Used for roles and for one person. `template` marks what differs from the role.
 */
export function PermissionMatrix({ value, onChange, template, readOnly }: { value: PermSet; onChange: (next: PermSet) => void; template?: PermSet; readOnly?: boolean }) {
  const set = (m: ModuleId, grant: Grant | undefined) => {
    const next = { ...value };
    if (!grant || grant.a.length === 0) next[m] = { a: [], s: grant?.s ?? value[m]?.s ?? "own" }; else next[m] = grant;
    onChange(next);
  };
  const toggleModule = (m: ModuleId, on: boolean) => set(m, on ? { a: ["view"], s: value[m]?.s ?? "own" } : { a: [], s: value[m]?.s ?? "own" });
  const toggle = (m: ModuleId, a: Action) => {
    const cur = value[m] ?? { a: [], s: "own" as Scope };
    const has = cur.a.includes(a);
    let next = has ? cur.a.filter((x) => x !== a) : [...cur.a, a];
    if (a === "view" && has) next = []; // no "view" = the module is off
    if (a !== "view" && !has && !next.includes("view")) next = ["view", ...next];
    set(m, { a: next, s: cur.s });
  };
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b bg-[#f6f9fc] text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2.5 font-semibold">Module</th>
            {ACTIONS.map((a) => <th key={a.id} title={a.hint} className="px-1 py-2.5 text-center font-semibold">{a.label}</th>)}
            <th className="min-w-36 px-3 py-2.5 font-semibold">Whose records</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => {
            const g = value[m.id];
            const on = !!g && g.a.includes("view");
            const diff = template ? !same(g?.a.length ? g : undefined, template[m.id]?.a.length ? template[m.id] : undefined) : false;
            return (
              <tr key={m.id} className={cn("border-b last:border-0", !on && "bg-muted/30", diff && "bg-[#fffbea]")}>
                <td className="px-3 py-2">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1 size-4 rounded border-input accent-[var(--primary)]" checked={on} disabled={readOnly} onChange={(e) => toggleModule(m.id, e.target.checked)} aria-label={`${m.label} on or off`} />
                    <span><span className="block font-medium">{m.label}{diff && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">changed</span>}</span><span className="block text-xs text-muted-foreground">{m.hint}</span></span>
                  </label>
                </td>
                {ACTIONS.map((a) => (
                  <td key={a.id} className="px-1 py-2 text-center">
                    {m.actions.includes(a.id) ? (
                      <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={!!g?.a.includes(a.id)} disabled={readOnly} onChange={() => toggle(m.id, a.id)} aria-label={`${m.label}: ${a.label}`} />
                    ) : <span className="text-muted-foreground/30">–</span>}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {m.scoped && on ? (
                    <NativeSelect value={g?.s ?? "own"} disabled={readOnly} onChange={(e) => set(m.id, { a: g?.a ?? [], s: e.target.value as Scope })} aria-label={`${m.label}: whose records`}>
                      {SCOPES.map((s) => <option key={s.id} value={s.id} title={s.hint}>{s.label}</option>)}
                    </NativeSelect>
                  ) : <span className="text-xs text-muted-foreground">{m.id === "vault" && on ? "Only what is assigned" : m.scoped ? "" : on ? "—" : ""}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Personal overrides = the modules where the person's grant differs from the template of their role. */
export function overridesOf(value: PermSet, template: PermSet): PermSet {
  const out: PermSet = {};
  for (const m of MODULES) {
    const a = value[m.id], b = template[m.id];
    if (!same(a?.a.length ? a : undefined, b?.a.length ? b : undefined)) out[m.id] = a ?? { a: [], s: "own" };
  }
  return out;
}
