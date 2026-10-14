/**
 * A tiny local stand-in for the Google Sheets API v4 (the handful of endpoints MIDAP uses), for development and tests.
 *   node tools/fake-sheets/server.mjs        → http://localhost:8788   (state in .data/fake-sheets.json)
 * Point the app at it with SHEETS_API_BASE=http://localhost:8788 and any GOOGLE_SHEET_ID.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colLetter = (n) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

/** "'My Tab'!A2:K" → { tab, c1, r1, c2, r2 } (rows/cols 1-based, r1/r2 may be null = open ended) */
export function parseRange(a1) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(a1);
  if (!m) throw new Error("Bad range: " + a1);
  const tab = (m[1] ?? m[2]).replace(/''/g, "'");
  const [from, to = from] = m[3].replace(/\$/g, "").split(":");
  const p = (x) => { const k = /^([A-Z]+)(\d+)?$/.exec(x); if (!k) throw new Error("Bad range: " + a1); return { c: colNum(k[1]), r: k[2] ? Number(k[2]) : null }; };
  const a = p(from), b = p(to);
  return { tab, c1: a.c, r1: a.r, c2: b.c, r2: b.r };
}

export function createFakeSheets({ file } = {}) {
  /** @type {Record<string, { nextId: number, tabs: Record<string, { sheetId: number, rows: any[][] }> }>} */
  let state = {};
  if (file && fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, "utf8"));
  const save = () => { if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } };
  const book = (id) => (state[id] ??= { nextId: 1, tabs: {} });
  const tabOf = (b, name) => { const t = b.tabs[name]; if (!t) { const e = new Error(`Unable to parse range: ${name}`); e.status = 400; throw e; } return t; };
  const lastDataRow = (t, c1, c2) => {
    for (let i = t.rows.length - 1; i >= 0; i--) {
      const row = t.rows[i] ?? [];
      for (let c = c1; c <= Math.min(c2, row.length); c++) if (row[c - 1] !== undefined && row[c - 1] !== "" && row[c - 1] !== null) return i + 1;
    }
    return 0;
  };
  const read = (t, rg) => {
    const last = lastDataRow(t, 1, 1000);
    const r1 = rg.r1 ?? 1, r2 = Math.min(rg.r2 ?? last, last);
    const out = [];
    for (let r = r1; r <= r2; r++) {
      const row = t.rows[r - 1] ?? [];
      const cells = [];
      for (let c = rg.c1; c <= rg.c2; c++) cells.push(row[c - 1] === undefined || row[c - 1] === null ? "" : row[c - 1]);
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      out.push(cells);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  };
  const write = (t, r, c, values) => {
    values.forEach((vals, i) => {
      while (t.rows.length < r + i) t.rows.push([]);
      const row = t.rows[r + i - 1];
      vals.forEach((v, j) => { row[c - 1 + j] = v; });
    });
  };
  const rangeText = (tab, c1, r1, c2, r2) => `'${tab}'!${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`;

  function handle(method, url, body) {
    const u = new URL(url, "http://x");
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname);
    if (!m) { const e = new Error("Not found"); e.status = 404; throw e; }
    const id = decodeURIComponent(m[1]);
    const rest = decodeURIComponent(m[2]);
    const b = book(id);

    if (method === "GET" && rest === "") {
      return { spreadsheetId: id, sheets: Object.entries(b.tabs).map(([title, t], index) => ({ properties: { sheetId: t.sheetId, title, index } })) };
    }
    if (method === "POST" && rest === ":batchUpdate") {
      const replies = [];
      for (const rq of body.requests ?? []) {
        if (rq.addSheet) {
          const title = rq.addSheet.properties.title;
          if (b.tabs[title]) { const e = new Error(`A sheet with the name "${title}" already exists. Please enter another name.`); e.status = 400; throw e; }
          b.tabs[title] = { sheetId: b.nextId++, rows: [] };
          replies.push({ addSheet: { properties: { sheetId: b.tabs[title].sheetId, title } } });
        } else replies.push({}); // styling requests are accepted and ignored
      }
      save();
      return { spreadsheetId: id, replies };
    }
    if (method === "GET" && rest === "/values:batchGet") {
      const ranges = u.searchParams.getAll("ranges");
      return {
        spreadsheetId: id,
        valueRanges: ranges.map((a1) => {
          const rg = parseRange(a1);
          const values = read(tabOf(b, rg.tab), rg);
          return { range: a1, majorDimension: "ROWS", ...(values.length ? { values } : {}) };
        }),
      };
    }
    if (method === "POST" && rest === "/values:batchUpdate") {
      let cells = 0;
      for (const d of body.data ?? []) {
        const rg = parseRange(d.range);
        write(tabOf(b, rg.tab), rg.r1 ?? 1, rg.c1, d.values ?? []);
        cells += (d.values ?? []).reduce((n, r) => n + r.length, 0);
      }
      save();
      return { spreadsheetId: id, totalUpdatedCells: cells };
    }
    const am = /^\/values\/(.+):append$/.exec(rest);
    if (method === "POST" && am) {
      const rg = parseRange(am[1]);
      const t = tabOf(b, rg.tab);
      const values = body.values ?? [];
      const at = lastDataRow(t, rg.c1, rg.c2) + 1;
      write(t, at, rg.c1, values);
      save();
      const width = Math.max(1, ...values.map((r) => r.length));
      return { spreadsheetId: id, tableRange: am[1], updates: { updatedRange: rangeText(rg.tab, rg.c1, at, rg.c1 + width - 1, at + values.length - 1), updatedRows: values.length } };
    }
    const e = new Error(`Not implemented in the fake: ${method} ${rest}`);
    e.status = 501;
    throw e;
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        if (req.url === "/__reset") { state = {}; save(); res.writeHead(200); return res.end("reset"); }
        const out = handle(req.method, req.url, raw ? JSON.parse(raw) : undefined);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(e.status ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: e.status ?? 500, message: e.message } }));
      }
    });
  });
  server.reset = () => { state = {}; save(); };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FAKE_SHEETS_PORT || 8788);
  const file = process.env.FAKE_SHEETS_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".data", "fake-sheets.json");
  if (process.env.FAKE_SHEETS_RESET && fs.existsSync(file)) fs.unlinkSync(file);
  createFakeSheets({ file }).listen(port, () => console.log(`[fake-sheets] http://localhost:${port}  (state: ${file})`));
}
