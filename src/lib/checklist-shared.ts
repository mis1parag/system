// Checklist rules shared by the server and the browser. No path aliases, no Node APIs.
import { absentOn } from "./flow-shared.ts";
import type { Absence, ChecklistEntry, ChecklistFreq, ChecklistTask } from "./flow-types.ts";

type AbsenceLike = Pick<Absence, "userId" | "fromDate" | "toDate" | "backupUserId">;

/**
 * Who owns a still-open checklist entry right now: the doer, or — while the doer is away — the task's buddy
 * (or, when no buddy is set, the backup named in the absence).
 */
export function checklistOwner(
  e: Pick<ChecklistEntry, "doerId" | "plannedDate" | "status">, task: Pick<ChecklistTask, "backupId"> | undefined, absences: AbsenceLike[], today: string,
): { userId: string; covering: boolean } {
  if (e.status !== "Pending") return { userId: e.doerId, covering: false };
  let a = absentOn(absences, e.doerId, e.plannedDate);
  if (!a && e.plannedDate <= today) a = absentOn(absences, e.doerId, today);
  if (!a) return { userId: e.doerId, covering: false };
  const cover = task?.backupId && task.backupId !== e.doerId ? task.backupId : a.backupUserId;
  return { userId: cover, covering: true };
}

export const FREQ_LABEL: Record<ChecklistFreq, string> = { D: "Daily", W: "Weekly", F: "Every 2 weeks", M: "Monthly", Q: "Quarterly", H: "Half-yearly", Y: "Yearly", O: "One time" };

/** Scorecard bucket of a checklist task: Daily, Non-daily or One-time. */
export const freqGroup = (f: ChecklistFreq): "DC" | "NDC" | "OT" => (f === "D" ? "DC" : f === "O" ? "OT" : "NDC");

/** Accepts "D", "daily", "Weekly", "monthly"… → code, or "" when not understood. */
export function parseFreq(v: unknown): ChecklistFreq | "" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  const map: Record<string, ChecklistFreq> = {
    d: "D", daily: "D", day: "D", w: "W", weekly: "W", week: "W", f: "F", fortnightly: "F", biweekly: "F", "every 2 weeks": "F", m: "M", monthly: "M", month: "M",
    q: "Q", quarterly: "Q", quarter: "Q", h: "H", "half-yearly": "H", "half yearly": "H", halfyearly: "H", y: "Y", yearly: "Y", annual: "Y", annually: "Y",
    "h-y": "H", hy: "H", o: "O", once: "O", "one time": "O", "one-time": "O", onetime: "O",
  };
  return map[s] ?? "";
}
