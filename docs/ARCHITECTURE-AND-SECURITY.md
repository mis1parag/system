# MIDAP — architecture, access model and security

Written after inspecting the existing app, before and while the access system was upgraded. Nothing was rebuilt from scratch: the FMS engine, checklist, attendance, scorecard, audit log and the Google Sheets storage are the same ones that were already working.

## 1. What MIDAP is today

| Part | How it is built |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4. One browser app, one server. |
| Data | Google Sheets through the Sheets API (service account). A local fake Sheets server is used in development and tests. Every table is a tab; rows are never physically deleted (`deleted = Y`). |
| Server code | `src/server/**` — plain TypeScript run directly by Node. One entry point for every action: `runAction()` in `src/server/api.ts`. Domain logic in `src/server/domain/*` (FMS engine, entries, tasks, checklist, attendance, people, access, vault, quick links, filters). |
| Shared rules | `src/lib/*` — pure code used by both the server and the browser (permissions, attendance rules, filters, dates). |
| Browser | `src/app/(app)/flows/*` pages, `src/components/*`, one client store `src/lib/flow-store.tsx` (one bundle from `/api/flow-data`, writes through `/api/mutate`). |
| Tests | `tools/test-*.mjs` run the real server stack against the fake Sheets: flow, features, templates, checklist, attendance, **access** (the permission matrix). `npm test` runs all. |

## 2. Features that exist

FMS (processes, entries, steps, planned vs actual times, approvals for more time, reassign, bulk actions, import, recurring entries, intake form) · Checklist (daily / weekly / monthly / one-time, proof, buddy cover) · Attendance (check in/out with optional photo and location, kiosk with QR / Employee ID, leave and approvals, monthly report, check-in screen and reminders) · Scorecard and Insights · Team, departments, reporting managers, profile photo and employee details · Holidays and absence cover · Notifications (in app, email, WhatsApp) · Audit log · **new:** Access & roles, Quick Access, Credential Vault, Saved filters, Control center.

## 3. Authentication (unchanged, reviewed)

Sign in with mobile / email / user ID + PIN. PINs are hashed with scrypt (random salt) — never stored in clear. Five wrong PINs lock the account for 15 minutes. The session is an HMAC-signed cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, 14 days). Every request re-reads the person from the sheet: a deactivated person, or a changed role / access, takes effect at the next request. Added: IP and browser are written to the activity log; sign-out and failed sign-ins are logged; `/api/mutate` refuses requests whose `Origin` is another website.

## 4. Roles and permissions — before and after

**Before:** three roles (Super Admin, Admin, Staff) and a short list of "capabilities" (create FMS, approve leave…) that the Super Admin could switch per role. Data was filtered by department.

**After** — one model, enforced on the server:

* **Module × action.** Modules: FMS, Checklist, Attendance & leave, Scorecard, Quick Access, Credential Vault, Employees, Reports, Settings, Activity logs. Actions: view, create, edit, delete, assign, approve, export, import, manage, configure (each module offers the ones that make sense).
* **Whose records (scope):** only their own · their team (the people who report to them, down the line) · their department · everyone.
* **Roles:** Super Admin (everything, cannot be restricted), Admin, Manager, Team Member — and any number of custom roles ("Sales Manager"). The Super Admin edits every template on *Access & roles*.
* **Personal changes:** on one person the Super Admin changes only what differs from the role; the rest follows the role.
* **Deny by default.** A module that is not granted does not exist for the person.

Where it is enforced (not only hidden):

1. `runAction` checks `module + action` **before** any handler runs (`perm` on every action).
2. Handlers check the **record**: is this person / entry / login inside the caller's reach? (`ctx.reach()`, `ctx.manages()`, `requireEntryAccess()`; the Vault checks its own assignment list.)
3. `getFlowData` — the only read the browser uses — builds the bundle per module: a module that is not granted sends **no rows, no counts, no notifications, no settings** for it.
4. Notifications, email and WhatsApp are filtered by module (`moduleOfNotification`, `ctx.deliverable`).
5. Search (`searchEntries`) and entry detail (`getItemDetail`) apply the same visibility as the lists.
6. The browser hides menus, cards and buttons from the same permission data — that is only convenience; a page the person does not have shows "no access" and the server would refuse the data anyway.

FMS entries are visible, by default, only to the people working on them and the managers whose reach includes those people. The creator can additionally share an entry with the department, selected people, or management ("More options"). An FMS (process) can be switched off, or limited to departments / named people, by the Super Admin only.

## 5. Data (Google Sheets tabs)

Existing: Users, Flows, Flow_Items, Flow_Tasks, Comments, Requests, Notifications, Holidays, Absences, Checklist_Tasks, Checklist_Log, Attendance, Attendance_Photos, Leaves, Profile_Photos, Employee_Details, Settings, Audit_Log.
New: **Roles**, **Quick_Links**, **Vault_Items**, **Vault_Access**, **Saved_Filters**. New columns: Users (custom role, personal overrides), Flows (allowed users), Flow_Items (visibility, visible-to, department), Audit_Log (module, IP, device), Checklist_Log (original date, moved by). Missing tabs and columns are created automatically on the first request.

## 6. Security review — risks found and what was done

| Risk | Status |
|---|---|
| A person could be shown (or sent by email) data of a module they should not have | Fixed: per-module bundle, notification and outbox filters, tests |
| Entries visible to everyone in the department by default | Fixed: default is "people working on it + their managers"; wider only on purpose |
| Admin could grant rights | Fixed: only the Super Admin changes roles / access; an Admin cannot create or edit Admins |
| Passwords of shared logins | Vault: AES-256-GCM, key only on the server (`VAULT_KEY`), list API never contains a secret, reveal / copy are logged without the secret. **No key = the vault refuses to store anything** (no insecure fallback). |
| Exports bypassing permissions | Export buttons need the *export* right and are built from data the person already received; every export is logged. There is no "export all" endpoint. |
| Cross-site requests | Origin check + SameSite cookie |
| Secrets in logs | The activity log never receives passwords; `pinHash`, `permsJson`, `secretEnc` are stripped from every response (`SENSITIVE` in `db.ts`) |
| CSV formula injection | Exported cells that start with `= + - @` are neutralised |
| Open: Google Sheet access | Anyone who can open the Google Sheet itself can read everything except Vault passwords (encrypted) and PIN hashes. Keep the sheet private to the service account and the owner. |

## 7. The 30-point plan — status

Done: 1 module / action / data-level permissions · 2 Super Admin · 3 roles incl. custom · 4 per-person access screen · 5–6 FMS visibility and assignment · 7 backend enforcement · 8 data security · 9 audit (login, logout, failed login, permission and role changes, credentials, exports, FMS / checklist / attendance / settings changes; with IP and device) · 10 one reusable filter component with operators · 11 saved filters (rename, delete, default, share if allowed) · 12 quick filters · 13 bulk actions (only those allowed) · 14 table customisation (sort, hide / show, reorder, resize, remembered; export if allowed) · 15 Home = *My work* · 16 checklist scopes · 17 attendance scopes + audited corrections · 18 scorecard scopes · 19 Quick Access · 20 Credential Vault · 21–23 search / notifications / export respect permissions · 24 archive instead of delete, confirmations · 25 simple UX · 26 command palette with quick actions · 27 Control center · 29 permission test matrix (`tools/test-access.mjs`, 97 checks).

Not done / limits (said plainly):
* FMS entries keep the *fields each FMS defines* (customer, project, next follow-up…); there is no separate fixed "Attachments" field.
* Statuses and priorities are fixed lists, not configurable. Notification rules are the existing settings (reminder minutes, escalation, check-in reminders), not a rule builder.
* Resizing and reordering columns is remembered per device (browser storage), not per account.
* The activity log can be searched and filtered but old entries are never purged automatically.
* Everything was tested against the local fake Google Sheets, not a live sheet.

## 8. Dashboard research (what shaped the Home page)

Internal-tool guidance agrees: show a role-based "my work" home with only what the person is allowed to use, make every number a one-click door to the filtered list, keep tables compact, sortable and filterable with saved views, offer bulk actions with a "select all N results" choice, and give power users a command palette and CSV export.
Sources: Jestor on internal-tool UX (blog.jestor.com), DronaHQ internal tools UX (dronahq.com), Edana dashboard UX (edana.ch), UX Planet data-table practices (uxplanet.org), AdminLTE dashboard examples (adminlte.io).
