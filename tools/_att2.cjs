const ExcelJS=require("exceljs");
const c=(v)=>{ if(v&&typeof v==="object"&&!(v instanceof Date)) v=v.result!==undefined?v.result:(v.formula?"="+v.formula:v.text??""); if(v instanceof Date) return v.toISOString().slice(0,16); return v==null?"":String(v).replace(/\s+/g," ").trim(); };
(async()=>{ const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(process.argv[2]);
 const sc=wb.getWorksheet("SalaryCalculation"); for(let r=1;r<=4;r++) console.log("SAL",r, sc.getRow(r).values.slice(1,23).map(x=>c(x).slice(0,60)).join(" | "));
 const ar=wb.getWorksheet("Attendance Report"); console.log("REPORT hdr row1:", ar.getRow(1).values.slice(1,12).map(x=>c(x).slice(0,80)).join(" | ")); 
 for(const addr of ["C4","D4","E4","F4","G4","H4","I4","J4","K4"]) console.log(addr, c(ar.getCell(addr).value).slice(0,420));
 const names=new Set(); wb.getWorksheet("Attendance").eachRow((r,n)=>{ if(n>1) names.add(c(r.getCell(2).value)); }); console.log("people in Attendance:", [...names].join(", "));
 const si=wb.getWorksheet("Staff Information"); const rows=[]; si.eachRow((r,n)=>{ if(n>1&&c(r.getCell(1).value)) rows.push(r.values.slice(1,6).map(c).join("|")); }); console.log(rows.length+" staff:", rows.join(" ; "));
})();
