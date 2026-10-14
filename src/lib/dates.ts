export const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Kolkata";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function parts(d: Date) {
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
}

export function todayStr(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
export function nowTime(d = new Date()): string {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
}

const ms = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export function addDays(s: string, n: number): string {
  const d = new Date(ms(s) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((ms(a) - ms(b)) / 86400000);
}
export const monthOf = (s: string) => s.slice(0, 7);
export function monthStart(m: string) { return `${m}-01`; }
export function monthEnd(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
export function daysInMonth(m: string) { return Number(monthEnd(m).slice(8)); }
export function addMonths(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function inRange(d: string, from: string, to: string) {
  return !!d && d >= from && d <= to;
}

const DISPLAY = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const DISPLAY_Y = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
export function fmtDate(s: string, withYear = false): string {
  if (!s) return "—";
  return (withYear ? DISPLAY_Y : DISPLAY).format(new Date(ms(s)));
}
export function fmtMonth(m: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(ms(m + "-01")));
}
export function weekdayName(s: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(new Date(ms(s)));
}
export function relDay(s: string, today: string): string {
  const d = diffDays(s, today);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

// ---- date-time helpers for the FMS module (wall-clock "yyyy-MM-dd HH:mm") ----
export const nowDT = (d = new Date()) => `${todayStr(d)} ${nowTime(d)}`;
export function dtMs(s: string): number {
  const [d, t = "00:00"] = s.split(" ");
  const [h, m] = t.split(":").map(Number);
  return ms(d) + h * 3600000 + m * 60000;
}
export function fmtDT(s: string, withYear = false): string {
  if (!s) return "—";
  const [d, t] = s.split(" ");
  return `${fmtDate(d, withYear)}${t ? ", " + t : ""}`;
}
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  if (d === 0) return h < 6 && m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  if (d >= 3) return `${d} days`;
  return `${d} day${d > 1 ? "s" : ""}${h ? ` ${h} h` : ""}`;
}

export const minutesBetween = (from: string, to: string) => Math.round((dtMs(to) - dtMs(from)) / 60000);
export const addMinutes = (dt: string, min: number) => new Date(dtMs(dt) + min * 60000).toISOString().slice(0, 16).replace("T", " ");
