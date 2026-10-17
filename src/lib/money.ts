// Rupee helpers: 12,34,567.50 style and "Rupees Twelve Lakh … Only".
export const rupees = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const below1000 = (n: number) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " : ""}` : ""}${n % 100 ? below100(n % 100) : ""}`;

/** 126050.5 → "Rupees One Lakh Twenty Six Thousand Fifty and Fifty Paise Only" (Indian numbering: thousand, lakh, crore). */
export function amountInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  const rupee = Math.floor(total / 100), paise = total % 100;
  if (rupee === 0 && paise === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  let n = rupee;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  const r = parts.join(" ");
  return `Rupees ${r}${paise ? `${r ? " and " : ""}${below100(paise)} Paise` : ""} Only`;
}
