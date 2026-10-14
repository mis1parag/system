const fs = require("fs");
const ExcelJS = require("exceljs");
const cell = (v) => {
  if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text ?? (v.richText ? v.richText.map((t) => t.text).join("") : v.formula ? "=" + v.formula.slice(0, 40) : "");
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  return v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, 36);
};
(async () => {
  const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  fs.writeFileSync(process.argv[3], Buffer.from(j.content, "base64"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[3]);
  console.log(wb.worksheets.map((w) => `${w.name}(${w.rowCount}x${w.columnCount})`).join(", "));
  const only = process.argv[4];
  for (const ws of wb.worksheets) {
    if (only && !only.split("|").includes(ws.name)) continue;
    console.log("\n--", ws.name);
    let shown = 0;
    ws.eachRow((row, n) => { if (shown < (Number(process.argv[5]) || 6) && row.values.some((x) => x !== null && x !== undefined && x !== "")) { shown++; console.log(n, row.values.slice(1, 18).map(cell).join(" | ")); } });
  }
})();
