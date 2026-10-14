// Parsing of stored flow definitions. Shared by the server and the browser (no path aliases so Node can run it directly).
import type { Flow, FlowField, FlowRec, FlowStep, Recurrence } from "./flow-types.ts";

const json = <T>(s: string, d: T): T => { try { return (JSON.parse(s) as T) ?? d; } catch { return d; } };

const cache = new WeakMap<FlowRec, Flow>();
export function parseFlow(rec: FlowRec): Flow {
  const hit = cache.get(rec);
  if (hit) return hit;
  const rc = json<Recurrence | null>(rec.recurrenceJson || "null", null);
  const f: Flow = {
    rec, flowId: rec.flowId, name: rec.name, description: rec.description, archived: rec.status === "Archived", anchorField: rec.anchorField,
    titleFields: String(rec.titleFields || "").split(",").map((x) => x.trim()).filter(Boolean), groupField: rec.groupField,
    openLabel: rec.openLabel || "In progress", doneLabel: rec.doneLabel || "Completed",
    weeklyOff: String(rec.weeklyOff ?? "").split(",").filter((x) => x.trim() !== "").map(Number), workStart: rec.workStart || "09:30", workEnd: rec.workEnd || "18:00",
    slaDays: Number(rec.slaDays) || 0, intakeToken: rec.intakeToken || "", recurrence: rc && rc.enabled ? rc : null,
    fields: json<FlowField[]>(rec.fieldsJson, []), steps: json<FlowStep[]>(rec.stepsJson, []),
    departments: String(rec.departments ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    allowedUsers: String(rec.allowedUsers ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
  cache.set(rec, f);
  return f;
}
