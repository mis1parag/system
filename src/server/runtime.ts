import "server-only";
import { configFromEnv, createSheetsClient } from "./sheets/client.ts";
import { Db } from "./sheets/db.ts";

const g = globalThis as unknown as { __midapDb?: Db };

/** One Db per server instance (it caches reads for a few seconds, so repeated page loads cost one Google call). */
export function getDb(): Db {
  if (!g.__midapDb) {
    g.__midapDb = new Db(createSheetsClient(configFromEnv()), { ttlMs: Number(process.env.SHEETS_CACHE_MS ?? 4000) });
  }
  return g.__midapDb;
}

/** false when pointed at the local fake (SHEETS_API_BASE): the UI shows a "demo data" banner. */
export const isLive = () => !process.env.SHEETS_API_BASE;
