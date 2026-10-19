# Go live — demo se asli (Google Sheet + internet)

Aapko sirf **Google ka kaam** aur **hosting ka login** karna hai. Baaki sab (secrets, data copy, checks) taiyaar hai.
`.env.live` file project folder mein pehle se bani hai (private, git mein nahi jaati) — usme `AUTH_SECRET`, `VAULT_KEY`, `CRON_SECRET` already bhare hain.

## Part A — Google (10 minute, ek baar)

1. **Naya blank Google Sheet** banao (sheets.google.com → Blank). Naam: `MIDAP FMS DATA`.
   Link mein `…/spreadsheets/d/` ke baad wala lamba hissa = **Sheet ID**. Use `.env.live` mein `GOOGLE_SHEET_ID=` ke aage paste karo.
2. **Google Cloud** (console.cloud.google.com) → naya project (naam kuch bhi, jaise `midap`).
3. **APIs & Services → Library → "Google Sheets API" → Enable.**
4. **IAM & Admin → Service Accounts → Create service account** (naam `midap-sheets`, koi role nahi chahiye) → Done.
5. Us service account par click → **Keys → Add key → Create new key → JSON** → ek `.json` file download hogi.
6. Us JSON file ko **project folder mein `.data/google-key.json`** naam se rakh do (`.data` git mein nahi jaata). Ya poora JSON ek line mein `.env.live` ke `GOOGLE_SERVICE_ACCOUNT_JSON=` ke aage paste karo.
7. JSON mein `client_email` dikhega (`…@….iam.gserviceaccount.com`). **Apne Google Sheet ko us email ke saath share karo — role: Editor.** (Sheet → Share → email paste → Editor → Send.)

> Ye key aur Sheet private rakho. Jo bhi us Sheet ko khol sakta hai wo data padh sakta hai (Vault ke passwords encrypted hain, PIN hashed hain).

## Part B — Check aur data copy (main karunga, ya aap chalao)

```bash
npm run live:check      # saari settings + Google se connection check
npm run live:setup      # Sheet mein tabs/headers banata hai
npm run live:migrate    # dikhata hai kya copy hoga (kuch likhta nahi)
npm run live:migrate -- --yes   # asli copy: log + unke PIN, FMS, entries, checklist, attendance, holidays, leave, settings
```

Test ka kachra copy nahi hota (test user, test photos, test vault/shortcuts, purane notifications, test punches).
Sab log **wahi PIN** se sign-in karenge jo abhi hai.

Sheet par pehle se log hon to tool ruk jaata hai (galti se overwrite nahi karta).

## Part C — Internet par (Vercel, 10 minute)

1. Code **GitHub** par daalo (private repo). *(Mujhe bolo to main commit kar deta hu; push aap karoge ya repo URL do.)*
2. vercel.com → **Add New → Project → us repo ko import karo** (Next.js khud pehchan leta hai).
3. **Settings → Environment Variables:** `.env.live` ki saari lines paste karo (Google wali bhi).
   **`SHEETS_API_BASE` kabhi mat daalna** (wo sirf local demo ke liye hai).
4. **Deploy.** Jo address mile (jaise `https://midap-fms.vercel.app`) use `APP_URL` mein daalo → Redeploy.
5. Pehle sign-in par check-in screen aayegi; Super Admin ko **Control center** kholkar "Needs your attention" list dekhni hai.

## Part D — Live hone ke baad

* **Reminders/scheduler:** Vercel free plan din mein ek baar chalata hai (`vercel.json`). Har 10 minute ke liye cron-job.org par free job lagao: `https://<address>/api/cron/tick?key=<CRON_SECRET>`. Jab bhi koi app khola hota hai tab bhi ~10 min mein khud chal jaata hai.
* **Email alerts + salary slip e-mail (optional):** `SMTP_URL` + `MAIL_FROM` bharo (Gmail ke liye App Password). Salary slip mails ka log **Attendance → Salary slips → E-mails** mein dikhta hai (Pending / Sent / Failed, Retry button). SMTP set na ho to mails Pending rehti hain aur SMTP lagte hi chali jaati hain.
* **Google se sign-in (optional):** Google Cloud Console → Credentials → *OAuth client ID* (Web application) banao, Authorised redirect URI = `<APP_URL>/api/auth/google/callback`. Phir Vercel mein `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` aur `APP_URL` (https) daalo. Sirf wahi log aa sakte hain jinka **verified Google email** unke profile ke email se match kare (naya user kabhi nahi banta).
* **Backup:** Google Sheet ka *File → Version history* khud history rakhta hai; mahine mein ek baar *File → Download → .xlsx* bhi le lo.
* **VAULT_KEY kabhi mat badlo** aur kahin safe copy rakho — kho gayi to saved passwords wapas nahi khulenge.
* **PIN badalna:** har insaan *My profile* mein khud badal sakta hai.

## Agar kuch ruke

| Error | Matlab |
|---|---|
| `Google Sheets API 403 / 404` | Sheet service account ke email ke saath **Editor** share nahi hui, ya Sheet ID galat |
| `GOOGLE_SERVICE_ACCOUNT_JSON is not valid` | Poora JSON ek line mein paste karo, ya base64 |
| `Wrong ID or PIN` live par | migration nahi hui ya galat sheet — `npm run live:check` chalao |
| Page "demo mode" dikhaye | `SHEETS_API_BASE` Vercel mein set hai — hata do |
