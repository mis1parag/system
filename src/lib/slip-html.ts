// The salary slip as a finished document (A4). The same HTML is shown on screen (in a frame) and printed / saved as PDF, so what you see is what you get.
import { fmtDate, fmtMonth } from "./dates.ts";
import { amountInWords, rupees } from "./money.ts";

export interface SlipLine { label: string; amount: number }
export interface SlipDoc {
  slip: { slipId: string; period: string; daysPaid: number | null; earnings: SlipLine[]; deductions: SlipLine[]; gross: number; totalDeductions: number; net: number; note: string; status: string; publishedAt: string };
  employee: { name: string; empCode: string; department: string; designation?: string; joinDate?: string };
  company: string;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function slipHtml(o: SlipDoc): string {
  const s = o.slip, e = o.employee;
  const rows = Math.max(s.earnings.length, s.deductions.length, 1);
  const body = Array.from({ length: rows }, (_, i) => {
    const a = s.earnings[i], d = s.deductions[i];
    return `<tr><td>${a ? esc(a.label) : "&nbsp;"}</td><td class="n">${a ? rupees(a.amount) : ""}</td><td class="gap"></td><td>${d ? esc(d.label) : ""}</td><td class="n">${d ? rupees(d.amount) : ""}</td></tr>`;
  }).join("");
  const info = (k: string, v: string) => `<div class="kv"><span>${k}</span><b>${v ? esc(v) : "—"}</b></div>`;
  const draft = s.status !== "Published";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Salary slip ${esc(s.period)} - ${esc(e.name)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @page{size:A4;margin:12mm}
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f6;font:13px/1.5 Inter,"Segoe UI",system-ui,Arial,sans-serif;color:#1a1f36;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:800px;margin:18px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 14px rgba(26,31,54,.12);position:relative}
  .band{background:linear-gradient(135deg,#1a1f36 0%,#2d3470 60%,#635bff 130%);color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  .band h1{margin:0;font-size:22px;letter-spacing:.2px}.band .sub{opacity:.75;font-size:12px;letter-spacing:.16em;text-transform:uppercase;margin-top:2px}
  .band .per{text-align:right}.band .per b{display:block;font-size:19px}.band .per span{opacity:.75;font-size:12px}
  .pad{padding:20px 28px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 18px;padding:14px 16px;border:1px solid #e3e8ee;border-radius:8px;background:#f7f9fc}
  .kv span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#697386}.kv b{font-size:13.5px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  thead th{background:#f0f2ff;color:#4b3fd6;font-size:11px;text-transform:uppercase;letter-spacing:.08em;text-align:left;padding:9px 10px;border-bottom:2px solid #d6d9ff}
  thead th.n{text-align:right}
  tbody td{padding:8px 10px;border-bottom:1px solid #eef0f4}.n{text-align:right;font-variant-numeric:tabular-nums}.gap{width:14px;border-bottom:none!important}
  tbody tr:nth-child(even) td:not(.gap){background:#fafbfd}
  tfoot td{padding:10px;font-weight:700;border-top:2px solid #1a1f36}
  .net{margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:16px;background:#efeeff;border:1px solid #d6d9ff;border-radius:10px;padding:14px 18px}
  .net .lab{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#4b3fd6}.net .amt{font-size:26px;font-weight:700;color:#1a1f36;font-variant-numeric:tabular-nums}
  .words{margin-top:8px;font-size:12px;color:#3c4257}.words b{color:#1a1f36}
  .note{margin-top:12px;padding:10px 12px;border-left:3px solid #635bff;background:#f7f9fc;color:#3c4257;font-size:12px}
  .sign{display:flex;justify-content:space-between;margin-top:46px;gap:30px}.sign div{flex:1;border-top:1px solid #8792a2;padding-top:5px;text-align:center;font-size:11px;color:#697386}
  .foot{margin-top:22px;padding-top:10px;border-top:1px dashed #cfd7e3;font-size:10.5px;color:#8792a2;display:flex;justify-content:space-between;gap:10px}
  .mark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;font-weight:800;color:rgba(26,31,54,.06);transform:rotate(-24deg);pointer-events:none;letter-spacing:.1em}
  @media print{body{background:#fff}.page{margin:0;box-shadow:none;border-radius:0;max-width:none}}
  @media (max-width:560px){.grid{grid-template-columns:repeat(2,1fr)}.band{flex-direction:column;align-items:flex-start}.band .per{text-align:left}.net{flex-direction:column;align-items:flex-start}}
  </style></head><body><div class="page">${draft ? '<div class="mark">DRAFT</div>' : ""}
  <div class="band"><div><h1>${esc(o.company)}</h1><div class="sub">Salary slip</div></div><div class="per"><span>Pay period</span><b>${esc(fmtMonth(s.period))}</b></div></div>
  <div class="pad">
    <div class="grid">${info("Employee name", e.name)}${info("Employee ID", e.empCode)}${info("Department", e.department)}${info("Designation", e.designation ?? "")}${info("Date of joining", e.joinDate ? fmtDate(e.joinDate, true) : "")}${info("Days paid", s.daysPaid !== null ? String(s.daysPaid) : "")}</div>
    <table><thead><tr><th>Earnings</th><th class="n">Amount</th><th class="gap"></th><th>Deductions</th><th class="n">Amount</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td>Gross earnings</td><td class="n">${rupees(s.gross)}</td><td></td><td>Total deductions</td><td class="n">${rupees(s.totalDeductions)}</td></tr></tfoot></table>
    <div class="net"><div><div class="lab">Net pay (take home)</div><div class="words"><b>${esc(amountInWords(s.net))}</b></div></div><div class="amt">${rupees(s.net)}</div></div>
    ${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}
    <div class="sign"><div>Prepared by (Accounts)</div><div>Authorised signatory</div><div>Employee</div></div>
    <div class="foot"><span>Slip no. ${esc(s.slipId.slice(-8))}${s.publishedAt ? ` · issued ${esc(fmtDate(s.publishedAt.slice(0, 10), true))}` : ""}</span><span>This is a computer-generated salary slip.</span></div>
  </div></div></body></html>`;
}
