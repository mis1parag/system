/**
 * Minimal Google Sheets API v4 client (REST). Talks to Google, or to tools/fake-sheets in development / tests
 * (set SHEETS_API_BASE). No globals: build one with `createSheetsClient(config)`.
 */
export interface SheetsConfig {
  spreadsheetId: string;
  /** Service-account credentials. Not needed when baseUrl points at the local fake. */
  clientEmail?: string;
  privateKey?: string;
  /** Override for development, e.g. http://localhost:8788 */
  baseUrl?: string;
}

export type Cell = string | number | boolean | null;

export interface SheetsClient {
  readonly spreadsheetId: string;
  listTabs(): Promise<{ title: string; sheetId: number }[]>;
  addTabs(titles: string[]): Promise<void>;
  /** Values for each A1 range (rows can be ragged; trailing empty cells are omitted by the API). */
  batchGet(ranges: string[]): Promise<Cell[][][]>;
  /** Append rows below the table in `range`; returns the 1-based row number of the first appended row. */
  append(range: string, rows: Cell[][]): Promise<number>;
  batchUpdate(data: { range: string; values: Cell[][] }[]): Promise<void>;
  /** Header styling: bold, dark background, frozen first row. */
  styleHeader(sheetId: number, columns: number): Promise<void>;
}

export const colLetter = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
export const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

import { existsSync, readFileSync } from "node:fs";

export function configFromEnv(env: Record<string, string | undefined> = process.env): SheetsConfig {
  const spreadsheetId = env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const baseUrl = env.SHEETS_API_BASE?.trim() || undefined;
  let clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = env.GOOGLE_PRIVATE_KEY;
  // on your own PC the downloaded key file can simply be pointed at (it is never uploaded); on a server paste the JSON into GOOGLE_SERVICE_ACCOUNT_JSON
  const file = env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || (file && existsSync(file) ? readFileSync(file, "utf8").trim() : undefined);
  if (json) {
    try {
      const parsed = JSON.parse(json.startsWith("{") ? json : Buffer.from(json, "base64").toString("utf8"));
      clientEmail = parsed.client_email;
      privateKey = parsed.private_key;
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file, or its base64)");
    }
  }
  if (privateKey) privateKey = privateKey.replace(/\\n/g, "\n");
  if (!baseUrl && (!clientEmail || !privateKey)) {
    throw new Error("Google credentials missing: set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)");
  }
  return { spreadsheetId, clientEmail, privateKey, baseUrl };
}

class SheetsError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSheetsClient(cfg: SheetsConfig): SheetsClient {
  const base = (cfg.baseUrl ?? "https://sheets.googleapis.com").replace(/\/$/, "");
  const root = `${base}/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}`;
  let jwt: { getAccessToken(): Promise<{ token?: string | null }> } | null = null;

  async function token(): Promise<string> {
    if (cfg.baseUrl) return "dev-token";
    if (!jwt) {
      const { JWT } = await import("google-auth-library");
      jwt = new JWT({ email: cfg.clientEmail, key: cfg.privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    }
    const t = await jwt.getAccessToken();
    if (!t.token) throw new Error("Could not get a Google access token (check the service account key)");
    return t.token;
  }

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text();
        let msg = text;
        try { msg = JSON.parse(text).error?.message ?? text; } catch { /* not json */ }
        // 429 = quota, 5xx = transient → retry. Anything else is a bug or a permission problem → fail with Google's message.
        const retryable = res.status === 429 || res.status >= 500;
        const hint = res.status === 403 || res.status === 404 ? " Check that the spreadsheet is shared with the service account (Editor) and that GOOGLE_SHEET_ID is right." : "";
        throw new SheetsError(`Google Sheets API ${res.status}: ${String(msg).slice(0, 300)}.${hint}`, retryable);
      } catch (e) {
        if (e instanceof SheetsError && !e.retryable) throw e;
        lastErr = e;
        await sleep(700 * 2 ** attempt + Math.random() * 300); // quota windows are a minute long: wait up to ~25 s in total
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Google Sheets request failed");
  }

  return {
    spreadsheetId: cfg.spreadsheetId,

    async listTabs() {
      const r = await call<{ sheets?: { properties: { title: string; sheetId: number } }[] }>("GET", `${root}?fields=sheets.properties(title,sheetId)`);
      return (r.sheets ?? []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
    },

    async addTabs(titles) {
      if (!titles.length) return;
      await call("POST", `${root}:batchUpdate`, { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) });
    },

    async batchGet(ranges) {
      if (!ranges.length) return [];
      const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
      const r = await call<{ valueRanges?: { values?: Cell[][] }[] }>("GET", `${root}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
      return ranges.map((_, i) => r.valueRanges?.[i]?.values ?? []);
    },

    async append(range, rows) {
      const r = await call<{ updates?: { updatedRange?: string } }>(
        "POST", `${root}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { majorDimension: "ROWS", values: rows },
      );
      const m = /!\$?[A-Z]+\$?(\d+)/.exec(r.updates?.updatedRange ?? "");
      if (!m) throw new Error("Google did not say where the rows were added");
      return Number(m[1]);
    },

    async batchUpdate(data) {
      if (!data.length) return;
      await call("POST", `${root}/values:batchUpdate`, { valueInputOption: "RAW", data: data.map((d) => ({ range: d.range, majorDimension: "ROWS", values: d.values })) });
    },

    async styleHeader(sheetId, columns) {
      await call("POST", `${root}:batchUpdate`, {
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.16, blue: 0.22 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
              fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
          },
        ],
      });
    },
  };
}
