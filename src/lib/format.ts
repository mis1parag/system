const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export const inr = (n: number) => "₹" + INR.format(Math.round(n || 0));

/** ₹1.2L / ₹3.4Cr style for dense dashboards. */
export function inrShort(n: number): string {
  const v = Math.abs(n || 0), sign = n < 0 ? "-" : "";
  if (v >= 1e7) return `${sign}₹${NUM1.format(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}₹${NUM1.format(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}₹${NUM1.format(v / 1e3)}k`;
  return `${sign}₹${INR.format(Math.round(v))}`;
}
export const n0 = (n: number) => INR.format(Math.round(n || 0));
export const pct1 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${NUM1.format(n)}%`);
export const cleanPhone = (s: string) => s.replace(/\D/g, "").slice(-10);
