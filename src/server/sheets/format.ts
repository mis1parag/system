/**
 * How the Google Sheet looks: a light colour per group of tabs, a clear (not black) header row that stays in view, a filter on every tab,
 * sensible column widths, big technical columns (photos, hashes, encrypted values) folded away, and a "Guide" tab that explains every tab.
 * Pure functions that build Sheets API requests — nothing here talks to Google (tools/format-sheet.mjs does).
 */
import { TABLES, TABLE_ORDER } from "./schema.ts";

export type Group = "People" | "FMS" | "Checklist" | "Attendance" | "Salary" | "Tools" | "Rules";
export const GROUP_COLOR: Record<Group, { header: [number, number, number]; tab: [number, number, number]; name: string }> = {
  People: { header: [0xdb, 0xea, 0xfe], tab: [0x3b, 0x82, 0xf6], name: "Blue" },
  FMS: { header: [0xdc, 0xfc, 0xe7], tab: [0x22, 0xc5, 0x5e], name: "Green" },
  Checklist: { header: [0xcc, 0xfb, 0xf1], tab: [0x14, 0xb8, 0xa6], name: "Teal" },
  Attendance: { header: [0xfe, 0xf3, 0xc7], tab: [0xf5, 0x9e, 0x0b], name: "Yellow" },
  Salary: { header: [0xed, 0xe9, 0xfe], tab: [0x8b, 0x5c, 0xf6], name: "Purple" },
  Tools: { header: [0xff, 0xed, 0xd5], tab: [0xf9, 0x73, 0x16], name: "Orange" },
  Rules: { header: [0xe5, 0xe7, 0xeb], tab: [0x6b, 0x72, 0x80], name: "Grey" },
};

/** What each tab holds, in plain words, and whether it is safe to edit by hand. */
export const TAB_INFO: Record<string, { group: Group; what: string; edit: string }> = {
  Users: { group: "People", what: "Har employee: naam, role, mobile, email, department, Employee ID, manager, kaun active hai ya exit kar gaya.", edit: "App se (Team & profiles). PIN ka column chhupa hua hai." },
  Roles: { group: "People", what: "Custom roles aur unki permissions (kaun kya dekh / kar sakta hai).", edit: "App se (Access & roles)." },
  Employee_Details: { group: "People", what: "Employee ki personal details: designation, joining date, address, emergency contact.", edit: "App se (Team & profiles)." },
  Profile_Photos: { group: "People", what: "Profile ki chhoti photo (image ka column chhupa hua hai, bahut bada hota hai).", edit: "Kabhi nahi." },
  Flows: { group: "FMS", what: "Har FMS (process): naam, steps, kaun karega, on/off (Status = Archived matlab band).", edit: "App se (FMS → Edit FMS)." },
  Flow_Items: { group: "FMS", what: "FMS ki har entry (jaise ek PO ya ek candidate) aur uska status: Open / Completed / Cancelled.", edit: "App se. Galti hone par Super Admin console." },
  Flow_Tasks: { group: "FMS", what: "Har entry ke steps: kaun karega, planned time, actual time, Done / Pending.", edit: "App se (Super Admin console)." },
  Comments: { group: "FMS", what: "Entries par likhe comments.", edit: "App se." },
  Requests: { group: "FMS", what: "More-time aur approval ki requests (FMS aur checklist dono).", edit: "App se (Approvals)." },
  Checklist_Tasks: { group: "Checklist", what: "Checklist ke tasks ka setup: kaun karega, kitni baar (Daily / Weekly / One-time…), proof chahiye ya nahi.", edit: "App se (Checklist → Task setup)." },
  Checklist_Proofs: { group: "Checklist", what: "Proof ki photo jo checklist tick karte waqt upload hui (image ka column chhupa hua hai).", edit: "Kabhi nahi." },
  Checklist_Log: { group: "Checklist", what: "Har din ki checklist entry: planned date, kab kiya, Done / Pending.", edit: "App se (tick karke). Sheet me seedha nahi." },
  Attendance: { group: "Attendance", what: "Har check-in / check-out: time, kis laptop se, photo ID, source (app / kiosk / import).", edit: "App se (Mark attendance)." },
  Attendance_Photos: { group: "Attendance", what: "Check-in ki selfie (image ka column chhupa hua hai).", edit: "Kabhi nahi." },
  Leaves: { group: "Attendance", what: "Leave requests aur unka decision.", edit: "App se (Leave)." },
  Holidays: { group: "Attendance", what: "Company holidays.", edit: "App se (Holidays)." },
  Absences: { group: "Attendance", what: "Kisi ke chhutti par hone par kaam kisko milega (backup).", edit: "App se." },
  Leave_Policy: { group: "Attendance", what: "Saal ke hisaab se leave kitni milti hai aur kitni aage jaati hai.", edit: "App se." },
  Leave_Adjust: { group: "Attendance", what: "Kisi ki leave me manual +/- badlav (reason ke saath).", edit: "App se." },
  Devices: { group: "Attendance", what: "Kaun se laptop / phone se check-in hota hai: approved, pending ya blocked.", edit: "App se (Laptops & camera)." },
  Att_Exempt: { group: "Attendance", what: "Jinhe laptop ya camera ke niyam se chhoot hai, aur kyun.", edit: "App se (Laptops & camera)." },
  Salary_Structure: { group: "Salary", what: "Har employee ki mahine ki salary (sirf payroll dekh sakta hai).", edit: "App se (Salary → Monthly salary). Private." },
  Salary_Slips: { group: "Salary", what: "Banayi gayi salary slips (Draft / Published).", edit: "App se. Private." },
  Pay_Waivers: { group: "Salary", what: "Kaun se absent / late din ki salary nahi kati (waive-off) aur kyun.", edit: "App se." },
  Slip_Requests: { group: "Salary", what: "Employee ne kisi mahine ki slip maangi.", edit: "App se." },
  Mail_Log: { group: "Salary", what: "Salary slip ki emails: Pending / Sent / Failed aur retry ka record (amount nahi).", edit: "Kabhi nahi. App me Salary → E-mails." },
  Notes: { group: "Tools", what: "Logon ke private notes.", edit: "Kabhi nahi (private)." },
  Reminders: { group: "Tools", what: "Managers ke bheje reminders ka record.", edit: "Kabhi nahi." },
  Announcements: { group: "Tools", what: "Super Admin ke notices.", edit: "App se (Super Admin console)." },
  Quick_Links: { group: "Tools", what: "Quick access ke links.", edit: "App se." },
  Vault_Items: { group: "Tools", what: "Saved logins / passwords. Secret encrypted hai (column chhupa hua).", edit: "Kabhi nahi. App se (Vault)." },
  Vault_Access: { group: "Tools", what: "Vault ka access kisko diya gaya.", edit: "App se." },
  Saved_Filters: { group: "Tools", what: "Logon ke saved filters.", edit: "Kabhi nahi." },
  Notifications: { group: "Tools", what: "Har kisi ki bell notifications.", edit: "Kabhi nahi." },
  Settings: { group: "Rules", what: "Company ke rules: working hours, late time, camera / laptop rule, salary rules, email.", edit: "App se (Settings). Sheet me value badal sakte ho par app se behtar." },
  Audit_Log: { group: "Rules", what: "Har badlav ka record: kisne, kab, kya badla, kis laptop / IP se.", edit: "Kabhi nahi." },
};

/** Columns that are huge or secret: folded away (right-click → "Show column" brings them back). */
const FOLD_KEYS = new Set(["pinHash", "image", "tokenHash", "secretEnc"]);

const rgb = ([r, g, b]: [number, number, number]) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const widthOf = (key: string, header: string, type: string): number => {
  if (FOLD_KEYS.has(key)) return 40;
  if (/Json$/.test(key) || /JSON/.test(header)) return 240;
  if (/^(note|notes|reason|text|message|description|body|remarks|reply|lastError|subject|label|what|title|name|dataJson)$/i.test(key)) return key === "name" || key === "title" ? 180 : 260;
  if (/Id$/.test(key) || key === "empCode") return 130;
  if (/(date|Date|At|at|Time|time|stamp|checkIn|checkOut|actual|planned|due)$/.test(key)) return 130;
  if (/status|role|kind|type|source|freq|group/i.test(key)) return 110;
  if (type === "n" || type === "nn") return 90;
  return 150;
};

export function tabIndexOf(tab: string): number { return TABLE_ORDER.indexOf(tab) + 1; } // Guide is 0

/** Requests that make one tab clear and easy to manage. Safe to run again and again. */
export function tabRequests(sheetId: number, tab: string): unknown[] {
  const def = TABLES[tab];
  const info = TAB_INFO[tab];
  const colors = GROUP_COLOR[info?.group ?? "Rules"];
  const n = def.cols.length;
  const freezeCols = tab === "Users" || tab === "Flows" || tab === "Checklist_Tasks" ? 2 : 1;
  const out: unknown[] = [
    { updateSheetProperties: { properties: { sheetId, tabColor: rgb(colors.tab), gridProperties: { frozenRowCount: 1, frozenColumnCount: freezeCols } }, fields: "tabColor,gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    // the data: smaller text, one line per row (long text is cut off, not stretched), centred vertically
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { textFormat: { fontSize: 10, bold: false, foregroundColor: rgb([0x1f, 0x29, 0x37]) }, wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)" } },
    // the header: light group colour, dark readable bold text, wraps, a clear line below
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { backgroundColor: rgb(colors.header), textFormat: { bold: true, fontSize: 10, foregroundColor: rgb([0x11, 0x18, 0x27]) }, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE", horizontalAlignment: "LEFT", borders: { bottom: { style: "SOLID_MEDIUM", color: rgb(colors.tab) } } } }, fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment,horizontalAlignment,borders)" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: "pixelSize" } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: n } } } },
  ];
  def.cols.forEach(([key, header, type], i) => {
    out.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: widthOf(key, header, type), hiddenByUser: FOLD_KEYS.has(key) }, fields: "pixelSize,hiddenByUser" } });
  });
  return out;
}

/** The text of the Guide tab (values and formulas); `ids` = sheetId of every tab. */
export function guideRows(ids: Map<string, number>, company = "Parag Unify Crafts"): (string | number)[][] {
  const rows: (string | number)[][] = [
    [`${company} — data sheet guide`, "", "", "", ""],
    ["Ye sheet app ka database hai. Roz ka kaam app se hota hai; yahan data dekhne, filter karne aur export karne ke liye aao.", "", "", "", ""],
    ["Zaroori: seedha edit karne se app me galat data aa sakta hai. Row badalni ho to app ka Super Admin console use karo. Hide kiye hue columns (photo, PIN, secret) ko mat chhedo.", "", "", "", ""],
    ["Har tab me: pehli row (header) hamesha upar rehti hai · header ke filter se search / sort karo · rang = tab ka group.", "", "", "", ""],
    ["", "", "", "", ""],
    ["Group (rang)", "Tab (click karo)", "Isme kya hai", "Rows", "Edit kaise karein"],
  ];
  for (const t of TABLE_ORDER) {
    const info = TAB_INFO[t];
    const id = ids.get(t);
    rows.push([
      `${info.group} — ${GROUP_COLOR[info.group].name}`,
      id === undefined ? t : `=HYPERLINK("#gid=${id}","${t}")`,
      info.what,
      `=MAX(0,COUNTA('${t}'!A:A)-1)`,
      info.edit,
    ]);
  }
  return rows;
}

/** Requests for the Guide tab's look (title, header row, widths, colours per group). */
export function guideRequests(sheetId: number): unknown[] {
  const rowsN = 6 + TABLE_ORDER.length;
  const out: unknown[] = [
    { updateSheetProperties: { properties: { sheetId, index: 0, tabColor: rgb([0x11, 0x18, 0x27]), gridProperties: { frozenRowCount: 6, hideGridlines: true } }, fields: "index,tabColor,gridProperties.frozenRowCount,gridProperties.hideGridlines" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowsN, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { fontSize: 10, foregroundColor: rgb([0x1f, 0x29, 0x37]) }, verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { fontSize: 16, bold: true, foregroundColor: rgb([0x11, 0x18, 0x27]) }, wrapStrategy: "OVERFLOW_CELL" } }, fields: "userEnteredFormat(textFormat,wrapStrategy)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: rgb([0xe5, 0xe7, 0xeb]), textFormat: { bold: true, fontSize: 10 }, borders: { bottom: { style: "SOLID_MEDIUM", color: rgb([0x6b, 0x72, 0x80]) } } } }, fields: "userEnteredFormat(backgroundColor,textFormat,borders)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 6, endRowIndex: rowsN, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat.horizontalAlignment" } },
    { repeatCell: { range: { sheetId, startRowIndex: 6, endRowIndex: rowsN, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, underline: true, foregroundColor: rgb([0x1d, 0x4e, 0xd8]) } } }, fields: "userEnteredFormat.textFormat" } },
  ];
  for (const m of [[1, 4], [2, 4]]) out.push({ mergeCells: { range: { sheetId, startRowIndex: m[0], endRowIndex: m[0] + 1, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } }, { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: m[0], endIndex: m[0] + 1 }, properties: { pixelSize: 36 }, fields: "pixelSize" } });
  out.push({ mergeCells: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } });
  TABLE_ORDER.forEach((t, i) => {
    const c = GROUP_COLOR[TAB_INFO[t].group];
    out.push({ repeatCell: { range: { sheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(c.header), textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
    out.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 6 + i, endIndex: 7 + i }, properties: { pixelSize: 36 }, fields: "pixelSize" } });
  });
  [[0, 170], [1, 150], [2, 520], [3, 70], [4, 330]].forEach(([i, w]) => out.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: "pixelSize" } }));
  return out;
}

/** Light zebra stripes under the header (replaces stripes made by an earlier run). */
export function bandingRequests(sheetId: number, tab: string, existing: number[]): unknown[] {
  const n = TABLES[tab].cols.length;
  return [
    ...existing.map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } })),
    { addBanding: { bandedRange: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }, rowProperties: { firstBandColor: rgb([0xff, 0xff, 0xff]), secondBandColor: rgb([0xf3, 0xf4, 0xf6]) } } } },
  ];
}
