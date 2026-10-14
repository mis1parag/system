// When a checklist task falls due. Pure date maths shared by the server (creating entries) and the browser (showing the next date).
import type { ChecklistFreq } from "./flow-types.ts";
import { addDays, isOffDay, type Calendar } from "../server/domain/time.ts";

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const shiftForward = (d: string, cal: Calendar) => { let x = d, g = 0; while (isOffDay(x, cal) && g++ < 31) x = addDays(x, 1); return x; };

/** Calendar dates on which the rule "falls" (before moving off days), from `start` up to `to`. For long-running rules only dates near `from` are produced. */
function nominalDates(freq: ChecklistFreq, start: string, from: string, to: string): string[] {
  const out: string[] = [];
  if (freq === "O") return start <= to ? [start] : [];
  if (freq === "D") { for (let d = start > from ? start : from, g = 0; d <= to && g++ < 4000; d = addDays(d, 1)) out.push(d); return out; }
  if (freq === "W" || freq === "F") {
    const step = freq === "W" ? 7 : 14;
    let d = start;
    const near = addDays(from, -step);
    if (near > start) { const k = Math.floor((new Date(near).getTime() - new Date(start).getTime()) / 86400000 / step); d = addDays(start, k * step); }
    for (let g = 0; d <= to && g++ < 4000; d = addDays(d, step)) if (d >= start) out.push(d);
    return out;
  }
  const every = { M: 1, Q: 3, H: 6, Y: 12 }[freq as "M" | "Q" | "H" | "Y"];
  const [sy, sm, sd] = start.split("-").map(Number);
  for (let k = 0, g = 0; g++ < 1200; k++) {
    const total = sm - 1 + k * every;
    const y = sy + Math.floor(total / 12), m = (total % 12) + 1;
    const d = ymd(y, m, Math.min(sd, daysIn(y, m)));
    if (d > to) break;
    out.push(d);
  }
  return out;
}

/** The planned dates of a task inside [from, to]: off days and holidays are skipped (daily) or moved to the next working day (everything else). */
export function plannedDates(t: { freq: ChecklistFreq; startDate: string; endDate?: string }, from: string, to: string, cal: Calendar): string[] {
  const end = t.endDate || "9999-12-31";
  const raw = nominalDates(t.freq, t.startDate, t.freq === "D" ? from : addDays(from, -31), to);
  const out = new Set<string>();
  for (const n of raw) {
    const d = t.freq === "D" ? (isOffDay(n, cal) ? "" : n) : shiftForward(n, cal);
    if (d && d >= from && d <= to && d <= end && d >= t.startDate) out.add(d);
  }
  return [...out].sort();
}
