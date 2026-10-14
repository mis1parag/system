# Architecture

```
Browser (React, client components)
   │  GET /api/flow-data      POST /api/mutate {action, data}      POST /api/auth/login …
   ▼
Next.js route handlers  ──►  src/server/api.ts  (action dispatcher, role checks)
                                  │
                                  ▼
                       src/server/domain/*   (engine, flows, entries, tasks, people, read, cron, notify)
                                  │   Tx = unit of work (load → change rows → commit)
                                  ▼
                       src/server/sheets/db.ts   (typed tables, cache, conflict checks, audit)
                                  │
                                  ▼
                       src/server/sheets/client.ts   (Sheets API v4 REST, service-account JWT, retry/backoff)
                                  ▼
                              Google Sheet   (one tab per table)
```

`src/server/**` is plain TypeScript that Node 24 runs directly (no path aliases, `.ts` import extensions), so the same code is exercised by `tools/test-*.mjs` against `tools/fake-sheets/server.mjs` — a local fake of the Sheets REST API — without Google.

## Tabs (tables)
`Users, Flows, Flow_Items, Flow_Tasks, Comments, Requests, Notifications, Holidays, Absences, Settings, Audit_Log`. Created automatically by `/setup`. Columns are defined once in `sheets/schema.ts`.

- **Flows** hold the definition as JSON (fields, steps with rule / assignment / condition / completion fields / reminders), SLA, recurrence and the intake token.
- **Flow_Items** = one entry (e.g. a PO) with its data as JSON. **Flow_Tasks** = one row per step per entry (planned, actual, status, assignee, extension count, step data).

## Planning engine (`domain/engine.ts`, `domain/time.ts`)
`planned = base ± N working days (+ hours) [at HH:mm]` with base ∈ schedule date, another date field, entry creation time, previous step's actual. Weekly-off days and holidays (global or per FMS) are skipped, like Excel `WORKDAY`. Done steps keep their planned time; `origPlanned` remembers the first plan. Conditional steps are `Skipped` when their condition fails and come back when it holds again. Verified against the original workbook: 3,631 planned times, 0 differences.

## Absence cover
Computed on read (`effectiveAssignee`), never by rewriting rows: a pending step whose planned day falls in an absence goes to the backup; deleting the absence returns it. The backup is notified.

## Writing safely to a Sheet
Sheets has no transactions. `Tx.commit()` therefore: never deletes rows (soft delete), re-reads the id column and aborts with `CONFLICT` if a row moved, uses state guards (e.g. a step can only be completed if still pending), generates collision-resistant ids, batches all changes into one `values:batchUpdate` + appends, and invalidates the read cache. The client merges the returned row changes and refreshes on conflict.

## Scheduler (`domain/cron.ts`)
`tick` creates reminders (before due), overdue alerts (silenced for stale backlog older than 3 days), escalations (to the step's escalation person, else the manager, else admins), recurring entries (guarded by `lastRunAt`), and the morning digest. `deliver` sends email / WhatsApp for notifications whose user chose those channels.

## Security
HMAC-signed httpOnly session cookie (`AUTH_SECRET`); PINs are scrypt-hashed; 5 wrong PINs lock an account for 15 minutes; roles enforced on the server in `api.ts` and the domain functions; `/api/cron/tick` needs `CRON_SECRET`; `/api/intake/[flowId]` needs the per-FMS token; `/setup` only works while there are no users (and needs `SETUP_KEY` if set). Service-account keys never reach the browser.

## Not covered by automated tests
The real Google endpoint and the real SMTP / WhatsApp gateways: the client follows the documented Sheets v4 REST contract and is tested against the fake, but a first live run on your own Sheet is the real proof.
