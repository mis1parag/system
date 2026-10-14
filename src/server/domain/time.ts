/**
 * Wall-clock date/time helpers. All times are strings "yyyy-MM-dd HH:mm" (or dates "yyyy-MM-dd") in the Settings timezone,
 * so no timezone conversion is needed anywhere except when reading the real clock.
 */
export interface Clock { date: string; time: string; dt: string; stamp: string }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function clockNow(tz = "Asia/Kolkata", d = new Date()): Clock {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, dt: `${date} ${p.hour}:${p.minute}`, stamp: `${date} ${p.hour}:${p.minute}:${p.second}` };
}

export const isDate = (s: unknown): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
export const isDT = (s: unknown): boolean => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(s ?? "")) && isDate(String(s).slice(0, 10));
export const isTime = (s: unknown): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s ?? ""));

/** Accepts "yyyy-MM-dd", "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mm[:ss...]" → normalised, or null when invalid, or "" when empty. */
export function normDT(v: unknown): string | null {
  let s = String(v ?? "").trim().replace("T", " ");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.slice(0, 16);
  return isDT(s) ? s : null;
}
export const splitDT = (s: string) => ({ date: s.slice(0, 10), time: s.length > 10 ? s.slice(11, 16) : "" });

export const dayMs = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
export function dtMs(s: string): number {
  const p = splitDT(s);
  const [h, m] = (p.time || "00:00").split(":").map(Number);
  return dayMs(p.date) + h * 3600000 + m * 60000;
}
export const diffDays = (a: string, b: string) => Math.round((dayMs(a) - dayMs(b)) / 86400000);
export function addDays(s: string, n: number): string { return new Date(dayMs(s) + n * 86400000).toISOString().slice(0, 10); }
export function addMinutes(dt: string, min: number): string { return new Date(dtMs(dt) + min * 60000).toISOString().slice(0, 16).replace("T", " "); }
export const minutesBetween = (from: string, to: string) => Math.round((dtMs(to) - dtMs(from)) / 60000);
export const weekday = (date: string) => new Date(dayMs(date)).getUTCDay();

export interface Calendar { off: Set<number>; holidays: Set<string> }
export const isOffDay = (date: string, cal: Calendar) => cal.holidays.has(date) || cal.off.has(weekday(date));

/** Excel WORKDAY semantics: n = 0 returns the same date; otherwise counts only working days (weekly-off days and holidays are skipped). */
export function addWorkdays(date: string, n: number, cal: Calendar): string {
  n = Math.trunc(Number(n) || 0);
  if (n === 0) return date;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n), d = date, guard = 0;
  while (left > 0 && guard++ < 4000) {
    d = addDays(d, step);
    if (!isOffDay(d, cal)) left--;
  }
  return d;
}

/** Working days between two dates (to − from), counting only working days; negative when to < from. */
export function workdaysBetween(from: string, to: string, cal: Calendar): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let n = 0, d = a, guard = 0;
  while (d < b && guard++ < 4000) { d = addDays(d, 1); if (!isOffDay(d, cal)) n++; }
  return sign * n;
}
