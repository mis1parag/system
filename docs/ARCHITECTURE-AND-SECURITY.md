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

## 9. Launch-readiness additions (people side)

What was added on top of the access system, all enforced on the server (`src/server/domain/*`) and covered by `tools/test-hr.mjs` (118 checks):

| Area | What it does | Where |
|---|---|---|
| Leave, year by year | Each calendar year has its own balance: allowance (own figure → company policy → profile) + carried forward (limit and "use by" date) + manual adjustments − approved leave. Pending is shown as reserved; rejected / cancelled never count; a leave over New Year is split between the two years; approving twice is refused. Optional setting `LEAVE_BLOCK_OVERDRAW` refuses requests beyond the balance. | `lib/attendance.ts` (`yearBalance`), `domain/leave-year.ts`, tabs `Leave_Policy`, `Leave_Adjust` |
| Holidays | Add / edit / delete / publish, year by year. A **draft** holiday is not a day off and is hidden from employees; planning, checklist, attendance and leave all use published holidays only. | `domain/holidays.ts`, page `/flows/holidays`, `Holidays.published` |
| Salary slips | New module `payroll`. Slips are built in the app (earnings, deductions, net), saved as draft, published by someone with the publish right. An employee can open only their own published slip; reporting managers, admins and other payroll-less people get nothing. A wrong or somebody else's slip id looks the same as "not found". Opening someone else's slip is written to the activity log. No salary figure travels in the normal page data. | `domain/payroll.ts`, page `/flows/payslips`, tab `Salary_Slips` |
| Private notes | Belong to one person; not even the Super Admin can read, edit or delete them. They are not in any bundle, report, score or notification. A note can become an official one-time checklist task only when its owner chooses. | `domain/notes.ts`, page `/flows/notes`, tab `Notes` |
| Reminders | New module `reminders`. Individual or bulk, only to people inside the sender's reach, with a preview, a send key (a double click or a retry sends once), a related FMS / checklist task that the recipient really works on, a log of sender / recipients / time, and a notification to each recipient. | `domain/reminders.ts`, page `/flows/reminders`, tab `Reminders` |
| Manager dashboard | "My team": attendance today, FMS and checklist progress, leave to decide — for the people in the manager's reach only. "No FMS assigned" is an empty state, never overdue. One definition of progress for everything: `lib/progress.ts`. | page `/flows/myteam` |
| Vault access | Giving a person a login now also gives them the module "Credential Vault · view (own)"; taking their last login away takes that access away again. (Before, they were on the list but could not open the Vault.) | `domain/vault.ts` (`assignVault`) |
| Privacy | The people list sent to an employee has only **names** (to pick a colleague as backup or assignee). Role, Employee ID, reporting manager, leave figures and contact details are sent only for yourself, your own manager and people inside your reach. | `domain/read.ts` |
| Check-in / check-out | Two quick clicks (or two devices) can no longer create two punches: punches of one person are run one after the other on the server; the button also ignores a second tap, and after a failed request the screen reloads the real state. | `api.ts`, `components/attendance/punch-card.tsx` |

### Roles after this change
Super Admin: everything. Admin: department scope by default, no payroll, no vault, no settings (the Super Admin can grant any of these). Manager: team scope; reminders; leave approval; no payroll, vault or private notes. Team Member: own work, own leave, own slips, own notes. Everything is a template the Super Admin can change on *Access & roles*.

### Backup and recovery
* Data lives in the Google Sheet. *File → Version history* keeps every change; download a monthly `.xlsx` as a second copy.
* New tabs and columns are created automatically on the first request after an update (`ensureSchema`); existing rows are never rewritten or deleted by an update.
* `VAULT_KEY` must be kept safe separately — without it, saved passwords cannot be opened.
* Rolling back the app = redeploy the previous version on Vercel; the sheet keeps the extra tabs, which older versions ignore.

### Not covered / honest limits
* A real browser was used to check sign-in, check-in / out, notes, holidays, leave, reminders (single and double click) and payroll preparation / publishing. Tablet and phone layouts were not visually tested.
* Two *different* servers handling the same person's check-in at the same instant could still create two punches (the lock is per server). The button lock and the "already checked in" rule make this very unlikely; a duplicate would show in the day's list and can be deleted by a manager.
* Salary slips are made inside the app. Uploading finished PDF files is not supported: Google Sheet cells are too small for PDFs (they need Drive or file storage).
* Password reset: people have a PIN, and an admin sets a new one (there is no self-service e-mail reset).
* Email / WhatsApp delivery of reminders needs `SMTP_URL` (and WhatsApp settings); without them reminders reach people in the app (bell and Reminders page).

### Exit, switch off, delete (people leaving)
| Action | Who | What happens |
|---|---|---|
| Record exit (last working day, kind, note, who takes over) | Admin and Super Admin (`Employees · delete`, inside their reach). Not Managers. Only the Super Admin for an Admin / Super Admin. Never for yourself. | Last day today or earlier: the account is switched off at once (old sessions are refused on the next request), open FMS steps, checklist tasks and the people who reported to them move to the chosen colleague, pending leave requests are cancelled, vault logins are closed, and the "Employee Exit" FMS gets an entry if the company has it. Last day in the future: stays active until that day; the daily tick then does the same. |
| Switch off / on | same | Cannot sign in; nothing is deleted. |
| Reinstate | same | Active again; exit details cleared (the activity log keeps the history). |
| Delete | Super Admin only, name typed to confirm | Only for a person who never did anything (no attendance, leave, work, slips, reminders, reports). Anyone with history is refused and must be switched off / exited, so old records keep their name. The row is kept but hidden; mobile / email / Employee ID are freed. |

The Team & profiles page shows "Left 16 Oct" / "Leaving 20 Oct" and has an **Exits** filter (date, kind, note for people who may record exits). The last active Super Admin can never be removed.

### Super Admin console (`/flows/console`)
Only the Super Admin (server-checked; a person without the role gets FORBIDDEN even with the URL or the API).
* **Data editor** — open People, FMS entries and steps, checklist, attendance, leave, policy, holidays, absence, employee details, requests, comments or announcements; search any value; change fields by hand. The id and a few columns are locked; PIN hashes, access overrides, vault secrets, private notes, salary slips and the activity log are not offered. Wrong roles, statuses, managers, dates, repeated Employee IDs, a check-out before the check-in, or switching off the last Super Admin are refused. Marking a step done fills its time and the entry follows its steps. Every change is written to the activity log with the old and the new value.
* **Restore** — deleted holidays, absences, leave adjustments, announcements, … can be shown and brought back (or hidden).
* **Download CSV** of any table (written to the activity log).
* **Data checks** — work left on switched-off people, people without a reporting manager or Employee ID, manager gone, duplicate IDs, check-ins never closed, leave stuck pending, entries without steps, holidays not published, no leave policy for the year.
* **Announcements** — to everyone, one department or chosen people, with dates and an "important" kind; shown on Home, and sent to the bell.
