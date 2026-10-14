// usage: node tools/_gs.cjs <downloaded-json> [outdir]  — lists the files of an Apps Script project and writes them out
const fs = require("fs"), path = require("path");
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const proj = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
console.log("title:", j.title, "| files:", (proj.files || []).length);
const out = process.argv[3];
if (out) fs.mkdirSync(out, { recursive: true });
for (const f of proj.files || []) {
  const src = f.source || "";
  const fns = [...src.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
  console.log(`- ${f.name}.${f.type === "SERVER_JS" ? "gs" : f.type === "HTML" ? "html" : "json"}  ${src.length} chars  ${src.split("\n").length} lines${fns.length ? "  fns: " + fns.slice(0, 40).join(", ") : ""}`);
  if (out) fs.writeFileSync(path.join(out, f.name + (f.type === "SERVER_JS" ? ".gs" : f.type === "HTML" ? ".html" : ".json")), src);
}
