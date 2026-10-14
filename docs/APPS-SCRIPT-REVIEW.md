# Apps Script review — LaunchHub v2 and PSFA Attendance

Review of the two Apps Scripts found in the Drive, and what this app does differently.

## 1. LaunchHub v2 (launch / TAT dashboard)

**Good**
- Clear look: ink-navy sidebar, brass accent, soft status colours. The app now uses the same palette.
- One sheet per concern, simple row-per-launch model, easy for the team to read.

**Problems found**

| # | Problem | Why it matters | In this app |
|---|---------|----------------|-------------|
| 1 | Web app is deployed "Anyone" with no check of who is calling | Anyone with the link can read or change launches | Every call needs a login session; roles (Staff / Admin / Super Admin) are checked on the server |
| 2 | User text is put into HTML without escaping | A launch name like `<img onerror=…>` runs script (XSS) | React escapes all text; no `innerHTML` |
| 3 | IDs are built from time / row count | Two people saving together can get the same ID | IDs are unique per table (`prefix + counter`) and checked on save |
| 4 | TAT counted in calendar days | Sundays and holidays count as late | Planned time skips weekly-off days and holidays |
| 5 | A launch that half-fails is saved partly, silently | Data looks fine but steps are missing | Each action is one unit of work: all rows are saved or none; conflicts are reported |
| 6 | No lock around writes | Two saves at once overwrite each other | Row-version conflict check; the second save is told to reload |

## 2. PSFA Attendance script

**Good**
- The rules are sensible and are the ones now used here: ≥ 6 h full day, ≥ 4 h half day, late after 09:30, early before 17:00, off-day work ≥ 4 h is overtime.

**Problems found**

| # | Problem | Why it matters | In this app |
|---|---------|----------------|-------------|
| 1 | Punch uses a free-text name / code | Anyone can punch for someone else, typos split one person into two | Punch is tied to the signed-in user; employee ID is only used for import |
| 2 | Dates compared as text (`"5/10/2026"`) | `"10/…"` sorts before `"5/…"`, so reports go wrong | Dates are stored as `YYYY-MM-DD` and compared as dates |
| 3 | No lock on check-in / check-out | Double tap creates two rows | Server refuses a second check-in while one is open |
| 4 | An open check-out is never closed | Hours for that day are wrong or zero | Open punches are flagged ("missing check-out") and an admin can correct them |
| 5 | GPS saved as free text | Cannot be mapped or checked | Latitude / longitude saved as numbers, with a map link; the punch still works if the phone refuses location |
| 6 | Leave and attendance live in separate places | Absent days that were approved leave look like absences | One report: leave days are counted as leave, not absent |

## 3. What was built from the Drive "Attendance System" sheet

- **Attendance** page: Me / Today / Report / Leave tabs, month calendar with colours, CSV export.
- **Check in / Check out** card on Home (with live worked-hours timer).
- **Leave** requests with manager / admin approval; a full-day leave with a backup moves that person's FMS steps to the backup.
- **Importer**: `node --no-warnings --env-file=.env.local tools/attendance-xlsx.mjs "<Attendance System.xlsx>"`.
- **Settings**: late-after, early-before, full-day hours, half-day hours, normal hours (Settings → Attendance rules). Weekly off and holidays are shared with the rest of the app.

## 4. Not done / limits

- Photos with a punch: see section 5.
- Salary / payroll sheets are not imported.
- Everything was tested against the local fake Google Sheets server; the real Google API and email were not tested.

---

## 5. "Parag Unify Crafts" kiosk attendance (code.gs + index.html)

Desktop-only page: webcam preview, Employee ID box or QR scan (jsQR), Check In / Check Out, photo saved to Drive, location, link to a Looker Studio report.

**Good**
- The time comes from the server (`new Date()` in Apps Script), not from the browser, so it cannot be faked by changing the PC clock.
- A photo and a location go with each punch; a missing camera or location does not block the punch.
- One simple screen at reception — nothing to learn.

**Problems found**

| # | Problem | Why it matters | In this app |
|---|---------|----------------|-------------|
| 1 | "Desktop only" is checked in the browser (user-agent and screen width) | Anyone can bypass it; the server accepts any caller | Setting **Who can check in / out**: "Only at the office kiosk" is enforced on the server |
| 2 | No sign-in. Anyone who knows an Employee ID can punch for that person; a photographed QR works for ever | Buddy punching; nobody reviews the photos | The kiosk is used by a signed-in admin; every punch keeps a photo and the admin can open it from the day view |
| 3 | The "face detection" only draws a green oval for 3 seconds | It looks like a check but checks nothing | Not pretended: the photo is evidence, not verification |
| 4 | Day is `new Date().toISOString()` = UTC date | In India, punches between 00:00 and 05:30 land on the previous day | The company timezone setting (Asia/Kolkata) is used for "today" |
| 5 | Only one check-in and one check-out per day | Lunch out, site visit, second shift are impossible | Several in/out pairs per day; hours are the sum |
| 6 | Forgot to check out → nothing can fix it | The day has no hours for ever | An admin can correct or add a punch (it is audit-logged) |
| 7 | No lock around read-then-append | Two quick taps both pass "not checked in yet" → two rows | Fresh read before the check; a second check-in while one is open is refused |
| 8 | Photos are saved in Drive as "anyone with the link can view" | Face photos of staff are public to anyone who gets a link | Photos are small JPEGs in a private sheet tab; only the person and admins can load them |
| 9 | Whole sheet is read on every call (`getDataRange`), the staff sheet on every punch; `getRecentHistory` takes the first 5 rows before sorting | Slows down as rows grow; "recent history" shows the oldest rows | Data is cached and loaded once per page; reports are computed from loaded rows |
| 10 | `restrictMobile()` in code.gs uses `document` / `navigator` | Dead code that would crash if called on the server | Not applicable |
| 11 | Old Tailwind 2 and Font Awesome from CDN, hard-coded spreadsheet ID and a Looker *edit* link | Fragile; the link opens the editor, not the report | Reports are inside the app (Attendance → Monthly report, CSV export) |

**Brought into this app from it**
- **Attendance kiosk** page (admin): camera, Employee ID box, **Scan QR** (jsQR), one tap = check in, or check out if already in; big green/blue/red result banner; list of recent punches.
- **Photo with every punch** (Settings → Photo with every punch; the kiosk always takes one). The selfie is shrunk to about 15 KB so it fits a sheet cell.
- Photos are viewable from the day view (click a date in the calendar).

**Limits**
- QR codes: the app reads any QR that contains the Employee ID text; it does not print badges yet.
- Photos are kept inside the Google Sheet (small size). If you want them in Drive instead, that needs Drive access added to the service account.
