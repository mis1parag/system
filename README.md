# MIDAP FMS — Flow Management System

Define a process once (entry form + ordered steps: who, how, when). The app plans every step's time automatically (working days, holidays, weekly offs), tracks **Planned vs Actual**, shows delays, moves tasks to a backup when someone is absent, reminds, escalates, and reports.

**Stack:** Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui · Vercel · **Google Sheets (through the Sheets API) as the only database.**

## Features

| Area | What you get |
|---|---|
| Control Panel | One home screen (`/flows/panel`): what is overdue (mark done right there), decisions waiting (approve / reject), every FMS with live numbers and a **New entry** button, team workload with 30-day score, who is away and who covers, holidays, admin shortcuts. Staff see the same screen scoped to their own work. |
| Team | Roles Staff / Admin / Super Admin, **department** per person, sign in with **email or mobile + PIN**, **Add many people** (paste the Doer List straight from a sheet — random PINs are shown once, downloadable), people who left are kept as inactive, 5-wrong-PIN lockout. |
| Checklist | The Drive “Daily / Non-daily Checklist” system: repeating tasks (Daily, Weekly, Every 2 weeks, Monthly, Quarterly, Half-yearly, Yearly, One-time) per person. The app creates the dated entries itself a week ahead, skipping weekly-off days and holidays (Sunday/holiday dates for non-daily tasks move to the next working day). Tick with one tap, optional proof link, Tick-all, 30-minute undo, **buddy covers** while the doer is away, evening reminder, team view, paste-many import. |
| Scorecard | The Drive “Scorecard” system: per person per week, for Daily / Non-daily / One-time checklists **and every FMS step**: planned, due, done, done on time, **% work not done**, **% work not done on time**, last week, next week, 6-week trend, green/amber/red against a benchmark (Settings). Team view and CSV export. |
| Many FMS | Create any number of FMS. Start blank or from ready templates: Instamart & Blinkit, **CRM Advance Order, CRM Credit Order & Payment, Purchase PO to Accounts, Purchase Indent to PO** (built from the owner's Google Drive FMS sheets), Order-to-Delivery, Vendor Payment, Employee Onboarding, Customer Complaint. Templates name the doer (Riya, Shivani, Manish, Store Assistant…); add users with those names in Team and they are picked automatically. |
| Planning engine | Planned time = a date ± N **working days** (weekly-off days and holidays skipped), optional fixed time / extra hours; can start from the schedule date, any date field, the moment of entry, or when the previous step was done. |
| Views | List, Sheet (like the original Excel), Board (Kanban by step), Calendar, Dashboard. CSV export. |
| Smart steps | Auto-assign (fixed, by field value e.g. location → person, shared pool: round-robin / least-loaded), conditional steps (skipped when not needed), data captured at completion (docket no., POD…), sequential steps. |
| Work | My Tasks, bulk actions (done, reassign, postpone, priority, tags, cancel), priority & tags, comments, activity trail, postpone with auto re-plan, global search, SLA badges. |
| Control | Time-extension requests with manager/admin approval, absence → backup auto-cover, holidays (re-plan automatically), scorecards (on-time %, delay) per person and per FMS. |
| Automation | Reminders before due, overdue alerts, escalation to manager, **repeating entries** (daily / weekly / monthly), morning summary, Google-Form / webhook intake. |
| Alerts | In-app bell; optional email (SMTP) and WhatsApp (webhook). |
| Safety | Team login (Staff / Admin / Super Admin), PIN lockout after 5 wrong tries, audit log of every change, no hard deletes. |

## Run it on your computer (no Google needed)

```bash
npm install
npm run sheets      # terminal 1: a local fake of Google Sheets (port 8788)
npm run dev         # terminal 2: the app → http://localhost:3000
```

Open `http://localhost:3000/setup`, create the first Super Admin (tick the demo-users box to get Priya / Kunal / Nidhi). To load the original Instamart & Blinkit workbook:

```bash
npm run import:flow -- "C:/path/INSTAMART & BLINKIT FMS.xlsx"
```

All 15 FMS that exist as sheets in your Drive (Instamart & Blinkit, CRM Advance, CRM Credit, Purchase FMS, Purchase Indent, Purchase PO, Hiring, Inventory Order, Amazon FBA, Flipkart & Amazon PO, Reconcile Process, Reconcile Return, Amazon Product Launch, Employee Exit, Leave Request) are ready: in the app click **FMS → Add ready-made FMS**, or run `node --no-warnings --env-file=.env.local tools/seed-flows.mjs` after seeding the team. Doers are matched by name; role names in the Drive sheets (“Purchase Assistant”, “Pawan”…) go to the person in `src/lib/templates/assignee-fallback.json`.

Your Drive team (22 people from the Doer List / Scorecard / Employee Exist sheets, with departments and who left) is in `tools/team-from-drive.json`: after first-time setup run `node --no-warnings --env-file=.env.local tools/seed-team.mjs` — it adds everyone (Chirag = Super Admin, Vikas = Admin, the rest Staff; Ankit, Mukul, Ashwani, Kuldeep as inactive) and writes their sign-in details to `.data/team-sign-in.csv`. Tasks of people who left go to whoever took over.

Import your Drive checklist: download the checklist Google Sheet as .xlsx, add its people in Team (same spelling), then `npm run import:checklist -- "<file.xlsx>"` (reads the “Task List” sheet: Task · Doer Name · Department · Frequency · Day/Date). Or paste the rows in the app: Checklist → All tasks → Paste many.

Tests (58 + 75 + 83 + 55 checks, including a comparison with the real workbook's planned times and a check that every template creates entries and plans correctly): `npm test`

## Connect your real Google Sheet (step by step)

1. **Google Sheet banao** — sheets.google.com → Blank. Name it e.g. `MIDAP FMS DATA`. From the link `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` copy the ID → this is `GOOGLE_SHEET_ID`.
2. **Google Cloud project** — console.cloud.google.com → new project → *APIs & Services → Library* → search **Google Sheets API** → **Enable**.
3. **Service account** — *IAM & Admin → Service Accounts → Create*. Name it `midap-fms`. Open it → *Keys → Add key → JSON* → a file downloads.
4. **Share the Sheet** — open the JSON, copy `client_email` (looks like `midap-fms@project.iam.gserviceaccount.com`). In your Google Sheet click **Share**, paste that email, role **Editor**.
5. **Environment variables** (Vercel → Project → Settings → Environment Variables, and `.env.local` locally; see `.env.example`):
   - `GOOGLE_SHEET_ID` = the ID from step 1
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = the whole JSON file content (one line)
   - `AUTH_SECRET` = a long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `CRON_SECRET` = another random string (for the scheduler)
   - `SETUP_KEY` (recommended) = any secret, so only you can run first-time setup
6. **Remove** `SHEETS_API_BASE` (that is only for the local fake) and deploy / restart.
7. Open `https://your-app/setup` → create the Super Admin. The app creates all tabs in the Sheet by itself.
8. Optional: `npm run import:flow -- "<xlsx path>"` with the real env set, to import the old POs.

If the login page says **“Cannot reach the Google Sheet”**, re-check steps 2 (API enabled), 4 (shared as Editor) and that the ID / JSON are pasted fully.

### Scheduler (reminders, overdue, repeating entries, morning summary)
`GET /api/cron/tick` does the work. It runs when someone has the app open (every ~10 min) and from `vercel.json` once a day. For every few minutes use a free pinger (e.g. cron-job.org) on `https://your-app/api/cron/tick?key=<CRON_SECRET>` — or Vercel Pro with `*/10 * * * *`.

### Email / WhatsApp (optional)
`SMTP_URL` + `MAIL_FROM` for email; `WHATSAPP_WEBHOOK_URL` (+ `WHATSAPP_WEBHOOK_TOKEN`) for any gateway accepting `{to, message}`. Each person chooses their channels in *My profile*.

### Google Form → FMS
Open the FMS in *Edit FMS* (section 6): it shows the intake URL, a token and a ready Apps Script snippet. Paste it into the Form's script editor and add an *On form submit* trigger. Form question titles must match the entry field names.

## Good to know
- Google Sheets is not a transactional database: the app protects against double-clicks and two people editing the same row (it re-reads before writing and reports a conflict), but it is meant for a team, not thousands of simultaneous users. Sheets API allows ~60 reads/min per user; the app caches reads for a few seconds.
- Nothing is physically deleted — rows are marked deleted — so the Sheet doubles as a history.
- Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)


## Attendance & leave

- **Attendance** page (Me / Today / Report / Leave) and a Check in / Check out card on Home.
- Rules (Settings → Attendance rules): late after 09:30, early before 17:00, ≥ 6 h full day, ≥ 4 h half day. Weekly off and holidays come from the existing settings / holidays.
- Import the Drive "Attendance System" sheet (employee IDs, punches, leaves, leave allotment):

```bash
node --no-warnings --env-file=.env.local tools/attendance-xlsx.mjs "<Attendance System.xlsx>"
```

- Tests: `npm run test:attendance`. Review of the older Apps Scripts: `docs/APPS-SCRIPT-REVIEW.md`.
- **Kiosk** (`/flows/kiosk`, admins): keep it open on the reception PC. Staff type or scan (QR) their Employee ID; one tap checks in, or out if already in, with a small photo. Settings → Attendance rules: *Who can check in / out* (anywhere / only at the kiosk) and *Photo with every punch*.

## Roles, departments and access

- Three roles: **Super Admin** (everything), **Manager** (stored as `ADMIN`; looks after a department) and **User** (`STAFF`).
- **Departments:** people see the work of their own department and of the people who report to them (reporting manager on each person). Personal data (attendance, leave, checklist, details) is limited to yourself, your reports and — for a Manager — the department. The Super Admin sees everything; "See every department" can be ticked per role.
- **Access & roles** page (Super Admin): tick what a Manager and a User may do (create FMS, edit attendance, approve leave, move work, …). Only the changes from the defaults are stored in the `PERMISSIONS` setting.
- **FMS page:** the one place to open and use every FMS. The Super Admin switches an FMS off (employees can no longer see it) and chooses which departments see it.
- **Checklist:** daily, non-daily and one-time tasks in one list with filters (type, person, status, proof needed, department, dates), quick "new task" row, tick-many, and Move / hand over for people allowed to.
- **Attendance → Mark attendance:** check in / out with an optional photo, today's present / half / absent worked out live, this month's numbers, apply for leave.
- **Profile:** photo (served from `/api/avatar/<id>`) and employee details (`Employee_Details` tab).
- Tests: `npm run test:access`.

## Check-in that cannot be forgotten

- When someone opens the app on a working day without having checked in, a **check-in screen** appears (Control center / Settings → "Check-in screen": must check in first · ask and allow 30 min postpone · off). The Super Admin is never locked out.
- A small bar at the top always shows today's state ("Not checked in" / "In 09:34 · 2h 10m"); tap it to check in or out.
- Scheduler reminders: "you have not checked in" (default 09:45) and "still checked in" (default 18:30), once a day each.
- Forgot to check out? The next time the person opens the app it asks when they left (`closeMyPunch`, kept in the audit log).
- Skipped automatically on weekly-off days, holidays, approved full-day leave, and for people not on the attendance system (no Employee ID and no punches in 45 days).
- **Control center** (`/flows/admin`, Super Admin): what needs attention (people without department / reporting manager / Employee ID, forgotten check-outs, waiting requests, FMS switched off) and the main switches.
- Look and feel follows a Stripe-style dashboard (light, indigo accent, hairline borders, Inter).

## Access, vault and filters (v2)

* **Access & roles** (Super Admin): module × action permissions and "whose records" (own · team · department · everyone) per role and per person; custom roles. Deny by default; enforced on the server. See `docs/ARCHITECTURE-AND-SECURITY.md`.
* **Credential Vault** needs an encryption key on the server: set `VAULT_KEY` (64 hex characters, `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Keep it secret and never change it. Without it the vault stays closed. On Vercel add it under Environment Variables.
* **Quick Access**, **Saved filters**, one **filter bar** (quick filters + conditions + views + export) and a shapeable **table** (sort, columns, resize) are used on FMS, tasks, checklist, attendance, people and the activity log.
* Tests: `npm test` (the permission matrix is `tools/test-access.mjs`).
