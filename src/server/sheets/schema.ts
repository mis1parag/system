/**
 * Sheet tabs and their columns. Row 1 of every tab is the header; data starts at row 2.
 * Column = [recordKey, headerText, type]   s = text · n = number (blank → 0) · nn = number (blank → null)
 * Keep in sync with src/lib/flow-types.ts.
 */
export type ColType = "s" | "n" | "nn";
export type Col = [key: string, header: string, type: ColType];
export interface TableDef {
  name: string;
  idKey: string | null;
  prefix: string;
  cols: Col[];
  /** rows are never physically deleted (that would shift row numbers under concurrent writers): they get deleted = "Y" */
  softDelete?: boolean;
}

export const TABLES: Record<string, TableDef> = {
  Users: {
    name: "Users", idKey: "userId", prefix: "USR", softDelete: true,
    cols: [
      ["userId", "User ID", "s"], ["name", "Name", "s"], ["role", "Role", "s"], ["mobile", "Mobile", "s"], ["email", "Email", "s"],
      ["status", "Status", "s"], ["managerId", "Reporting Manager", "s"], ["notify", "Notify via", "s"], ["pinHash", "PIN Hash", "s"],
      ["failCount", "Failed Logins", "n"], ["lockedUntil", "Locked Until", "s"], ["createdAt", "Created", "s"], ["department", "Department", "s"],
      ["empCode", "Employee ID", "s"], ["leaveAllot", "Leave Allotted (days / year)", "n"], ["photoVer", "Profile Photo Version", "s"],
      ["roleId", "Custom Role", "s"], ["permsJson", "Personal Access Overrides (JSON)", "s"],
      ["exitDate", "Last working day (exit)", "s"], ["exitType", "Exit type", "s"], ["exitReason", "Exit note", "s"], ["exitHandover", "Work handed over to", "s"],
      ["exitBy", "Exit recorded by", "s"], ["exitAt", "Exit recorded at", "s"], ["exitDone", "Exit applied (Y)", "s"], ["deleted", "Deleted", "s"],
    ],
  },
  /** One small profile picture per person (JPEG data). Served by /api/avatar/<id>, never part of the page data. */
  Profile_Photos: {
    name: "Profile_Photos", idKey: "userId", prefix: "PRF",
    cols: [["userId", "User", "s"], ["image", "Image (JPEG data)", "s"], ["updatedAt", "Updated", "s"]],
  },
  /** Personal details of an employee. Only the person, their reporting line and people allowed to see employee details can read a row. */
  Employee_Details: {
    name: "Employee_Details", idKey: "userId", prefix: "EMP",
    cols: [
      ["userId", "User", "s"], ["designation", "Designation", "s"], ["joinDate", "Date of Joining", "s"], ["employmentType", "Employment Type", "s"], ["workLocation", "Work Location", "s"],
      ["dob", "Date of Birth", "s"], ["gender", "Gender", "s"], ["bloodGroup", "Blood Group", "s"], ["address", "Address", "s"], ["personalEmail", "Personal Email", "s"],
      ["emergencyName", "Emergency Contact", "s"], ["emergencyPhone", "Emergency Phone", "s"], ["notes", "Notes (HR)", "s"], ["updatedAt", "Updated", "s"], ["updatedBy", "Updated By", "s"],
    ],
  },
  Flows: {
    name: "Flows", idKey: "flowId", prefix: "FLW",
    cols: [
      ["flowId", "Flow ID", "s"], ["name", "Name", "s"], ["description", "Description", "s"], ["status", "Status", "s"],
      ["anchorField", "Anchor Field", "s"], ["titleFields", "Title Fields", "s"], ["groupField", "Group By Field", "s"],
      ["openLabel", "Open Label", "s"], ["doneLabel", "Done Label", "s"], ["weeklyOff", "Weekly Off (0=Sun)", "s"],
      ["workStart", "Work Start", "s"], ["workEnd", "Work End", "s"], ["slaDays", "SLA (working days)", "n"],
      ["intakeToken", "Intake Token", "s"], ["recurrenceJson", "Recurrence (JSON)", "s"], ["lastRunAt", "Last Recurrence Run", "s"],
      ["fieldsJson", "Fields (JSON)", "s"], ["stepsJson", "Steps (JSON)", "s"], ["createdAt", "Created", "s"], ["createdBy", "Created By", "s"],
      ["updatedAt", "Updated", "s"], ["departments", "Visible to departments (blank = all)", "s"], ["allowedUsers", "Visible to these people (user ids)", "s"],
    ],
  },
  Flow_Items: {
    name: "Flow_Items", idKey: "itemId", prefix: "FIT",
    cols: [
      ["itemId", "Item ID", "s"], ["flowId", "Flow", "s"], ["title", "Title", "s"], ["dataJson", "Data (JSON)", "s"],
      ["anchorDate", "Anchor Date", "s"], ["originalAnchor", "Original Anchor", "s"], ["postponeCount", "Postponed Times", "n"],
      ["postponeReason", "Postpone Reason", "s"], ["priority", "Priority", "s"], ["tags", "Tags", "s"], ["source", "Source", "s"],
      ["status", "Status", "s"], ["createdAt", "Created", "s"], ["createdBy", "Created By", "s"], ["updatedAt", "Updated", "s"],
      ["completedAt", "Completed At", "s"], ["visibility", "Who can see (assigned / department / users / management)", "s"], ["visibleTo", "Visible to (user ids)", "s"], ["department", "Department", "s"],
    ],
  },
  Flow_Tasks: {
    name: "Flow_Tasks", idKey: "taskId", prefix: "FTK",
    cols: [
      ["taskId", "Task ID", "s"], ["itemId", "Item", "s"], ["flowId", "Flow", "s"], ["stepId", "Step", "s"], ["seq", "Seq", "n"],
      ["assigneeId", "Assignee", "s"], ["status", "Status", "s"], ["planned", "Planned", "s"], ["origPlanned", "Original Planned", "s"],
      ["actual", "Actual", "s"], ["doneBy", "Done By", "s"], ["remarks", "Remarks", "s"], ["dataJson", "Step Data (JSON)", "s"],
      ["extCount", "Extensions", "n"], ["remindedAt", "Reminded At", "s"], ["overdueAt", "Overdue Notified At", "s"],
      ["escalatedAt", "Escalated At", "s"], ["updatedAt", "Updated", "s"],
    ],
  },
  Comments: {
    name: "Comments", idKey: "commentId", prefix: "CMT", softDelete: true,
    cols: [["commentId", "Comment ID", "s"], ["itemId", "Item", "s"], ["flowId", "Flow", "s"], ["userId", "User", "s"], ["text", "Text", "s"], ["createdAt", "Created", "s"], ["deleted", "Deleted", "s"]],
  },
  Requests: {
    name: "Requests", idKey: "requestId", prefix: "REQ",
    cols: [
      ["requestId", "Request ID", "s"], ["taskId", "Task", "s"], ["itemId", "Item", "s"], ["flowId", "Flow", "s"], ["requestedBy", "Requested By", "s"],
      ["newPlanned", "New Planned", "s"], ["reason", "Reason", "s"], ["status", "Status", "s"], ["decidedBy", "Decided By", "s"],
      ["decidedAt", "Decided At", "s"], ["note", "Decision Note", "s"], ["createdAt", "Created", "s"], ["kind", "Kind (blank = FMS step, checklist = checklist task)", "s"],
    ],
  },
  Notifications: {
    name: "Notifications", idKey: "notifId", prefix: "NTF",
    cols: [
      ["notifId", "Notification ID", "s"], ["userId", "User", "s"], ["type", "Type", "s"], ["title", "Title", "s"], ["body", "Body", "s"],
      ["link", "Link", "s"], ["itemId", "Item", "s"], ["taskId", "Task", "s"], ["dedupeKey", "Dedupe Key", "s"], ["channels", "Sent Via", "s"],
      ["createdAt", "Created", "s"], ["readAt", "Read At", "s"],
    ],
  },
  Holidays: {
    name: "Holidays", idKey: "holidayId", prefix: "HOL", softDelete: true,
    cols: [["holidayId", "Holiday ID", "s"], ["date", "Date", "s"], ["label", "Label", "s"], ["flowId", "Flow (blank = all)", "s"], ["deleted", "Deleted", "s"], ["published", "Published (N = draft, only admins see it)", "s"], ["note", "Note", "s"]],
  },
  Absences: {
    name: "Absences", idKey: "absenceId", prefix: "ABS", softDelete: true,
    cols: [
      ["absenceId", "Absence ID", "s"], ["userId", "User", "s"], ["fromDate", "From", "s"], ["toDate", "To", "s"], ["backupUserId", "Backup User", "s"],
      ["reason", "Reason", "s"], ["createdBy", "Created By", "s"], ["createdAt", "Created", "s"], ["deleted", "Deleted", "s"],
    ],
  },
  Checklist_Tasks: {
    name: "Checklist_Tasks", idKey: "ctId", prefix: "CLT",
    cols: [
      ["ctId", "Checklist Task ID", "s"], ["title", "Task", "s"], ["doerId", "Doer", "s"], ["backupId", "Buddy (covers when doer is away)", "s"],
      ["department", "Department", "s"], ["freq", "Frequency (D W F M Q H Y O)", "s"], ["startDate", "Start / Day-Date", "s"], ["endDate", "End Date", "s"],
      ["proof", "Proof Required (Y/N)", "s"], ["kra", "KRA / Notes", "s"], ["status", "Status", "s"], ["lastGenerated", "Generated Until", "s"],
      ["createdAt", "Created", "s"], ["createdBy", "Created By", "s"], ["updatedAt", "Updated", "s"],
    ],
  },
  Checklist_Log: {
    name: "Checklist_Log", idKey: "clId", prefix: "CLG",
    cols: [
      ["clId", "Checklist Entry ID", "s"], ["ctId", "Checklist Task", "s"], ["doerId", "Doer", "s"], ["plannedDate", "Planned", "s"],
      ["status", "Status", "s"], ["actual", "Actual", "s"], ["doneBy", "Done By", "s"], ["proof", "Proof / Link", "s"], ["remarks", "Remarks", "s"],
      ["remindedAt", "Reminded At", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["origDate", "Original Planned", "s"], ["movedBy", "Moved By", "s"],
    ],
  },
  Attendance: {
    name: "Attendance", idKey: "attId", prefix: "ATT", softDelete: true,
    cols: [
      ["attId", "Attendance ID", "s"], ["userId", "User", "s"], ["date", "Date", "s"], ["checkIn", "Check In", "s"], ["checkOut", "Check Out", "s"],
      ["lat", "Latitude", "nn"], ["lng", "Longitude", "nn"], ["outLat", "Check-out Latitude", "nn"], ["outLng", "Check-out Longitude", "nn"],
      ["note", "Note", "s"], ["source", "Source", "s"], ["createdBy", "Created By", "s"], ["createdAt", "Created", "s"], ["deleted", "Deleted", "s"],
      ["inPhoto", "Check-in Photo ID", "s"], ["outPhoto", "Check-out Photo ID", "s"], ["inDevice", "Check-in laptop / phone (Devices ID)", "s"], ["outDevice", "Check-out laptop / phone (Devices ID)", "s"],
    ],
  },
  /** The laptops / phones people check in from. A device is known by a random token kept in that browser (only its hash is stored here). Approved = may be used for check-in. */
  Devices: {
    name: "Devices", idKey: "deviceId", prefix: "DEV",
    cols: [
      ["deviceId", "Device ID", "s"], ["userId", "Owner", "s"], ["tokenHash", "Token hash", "s"], ["label", "Name (browser · system)", "s"],
      ["status", "Status (Approved / Pending / Blocked)", "s"], ["via", "How it was added (first use / request / admin)", "s"], ["createdAt", "First seen", "s"],
      ["decidedBy", "Decided by", "s"], ["decidedAt", "Decided", "s"], ["lastUsedAt", "Last used", "s"], ["lastIp", "Last IP", "s"],
    ],
  },
  /** People who are excused from the laptop rule and / or the compulsory camera. Everybody else follows the rules. */
  Att_Exempt: {
    name: "Att_Exempt", idKey: "userId", prefix: "AEX",
    cols: [["userId", "Person", "s"], ["device", "Any laptop is fine (Y)", "s"], ["camera", "Camera not needed (Y)", "s"], ["reason", "Reason", "s"], ["by", "Set by", "s"], ["at", "Set", "s"]],
  },
  /** Small selfie taken with a punch. Kept out of the page data; fetched one at a time. */
  Attendance_Photos: {
    name: "Attendance_Photos", idKey: "photoId", prefix: "PHO",
    cols: [["photoId", "Photo ID", "s"], ["attId", "Attendance ID", "s"], ["userId", "User", "s"], ["kind", "In / Out", "s"], ["takenAt", "Taken", "s"], ["image", "Image (JPEG data)", "s"]],
  },
  Leaves: {
    name: "Leaves", idKey: "leaveId", prefix: "LVE",
    cols: [
      ["leaveId", "Leave ID", "s"], ["userId", "User", "s"], ["type", "Leave Type", "s"], ["startDate", "From", "s"], ["endDate", "To", "s"], ["days", "Days", "n"],
      ["reason", "Reason", "s"], ["backupUserId", "Backup", "s"], ["status", "Status", "s"], ["decidedBy", "Decided By", "s"], ["decidedAt", "Decided At", "s"],
      ["note", "Decision Note", "s"], ["createdAt", "Created", "s"],
    ],
  },
  /** Leave rules of one calendar year: yearly allowance, how much may be carried to the next year and until when. */
  Leave_Policy: {
    name: "Leave_Policy", idKey: "year", prefix: "LPO",
    cols: [["year", "Year", "s"], ["allot", "Leave days for the year", "n"], ["carryMax", "Carry forward at most (days)", "n"], ["carryUntil", "Carried days can be used until (MM-DD)", "s"], ["note", "Note", "s"], ["updatedBy", "Updated By", "s"], ["updatedAt", "Updated", "s"]],
  },
  /** One person's own allowance for a year (when it differs from the policy) and manual +/- adjustments. Never deleted: a correction is a new row. */
  Leave_Adjust: {
    name: "Leave_Adjust", idKey: "adjId", prefix: "LAD", softDelete: true,
    cols: [["adjId", "ID", "s"], ["userId", "User", "s"], ["year", "Year", "s"], ["allot", "Own allowance (blank = follow the policy)", "nn"], ["delta", "Adjustment (+/- days)", "n"], ["note", "Reason", "s"], ["createdBy", "By", "s"], ["createdAt", "Created", "s"], ["deleted", "Deleted", "s"]],
  },
  /** Salary slips. Read only through the payroll actions, which check that the slip is yours (published) or that you run payroll. */
  Salary_Slips: {
    name: "Salary_Slips", idKey: "slipId", prefix: "SLP", softDelete: true,
    cols: [
      ["slipId", "Slip ID", "s"], ["userId", "Employee", "s"], ["period", "Month (YYYY-MM)", "s"], ["daysPaid", "Days paid", "nn"], ["earningsJson", "Earnings (JSON)", "s"], ["deductionsJson", "Deductions (JSON)", "s"],
      ["gross", "Gross", "n"], ["totalDeductions", "Total deductions", "n"], ["net", "Net pay", "n"], ["note", "Note", "s"], ["status", "Status (Draft / Published)", "s"],
      ["createdBy", "Created By", "s"], ["createdAt", "Created", "s"], ["publishedBy", "Published By", "s"], ["publishedAt", "Published", "s"], ["viewedAt", "Employee first opened", "s"], ["deleted", "Deleted", "s"], ["attJson", "Attendance summary (JSON)", "s"], ["emailedAt", "E-mailed to the employee", "s"],
    ],
  },
  /** The monthly pay of one person (what payroll prepares slips from). Only payroll people can read it; the person themselves only gets the finished slip. */
  Salary_Structure: {
    name: "Salary_Structure", idKey: "userId", prefix: "SST",
    cols: [["userId", "Employee", "s"], ["earningsJson", "Monthly earnings (JSON)", "s"], ["deductionsJson", "Fixed monthly deductions (JSON)", "s"], ["note", "Note", "s"], ["updatedBy", "Updated By", "s"], ["updatedAt", "Updated", "s"]],
  },
  /** A day of absence / half day / late arrival that payroll chose NOT to deduct for ("waived off"). */
  Pay_Waivers: {
    name: "Pay_Waivers", idKey: "waiverId", prefix: "PWV", softDelete: true,
    cols: [["waiverId", "ID", "s"], ["userId", "Employee", "s"], ["period", "Month (YYYY-MM)", "s"], ["date", "Day", "s"], ["kind", "absent / late", "s"], ["reason", "Reason", "s"], ["by", "Waived by", "s"], ["at", "At", "s"], ["deleted", "Deleted", "s"]],
  },
  /** A person asks payroll for a salary slip (a month that is missing). */
  Slip_Requests: {
    name: "Slip_Requests", idKey: "reqId", prefix: "SRQ",
    cols: [["reqId", "ID", "s"], ["userId", "Employee", "s"], ["period", "Month (YYYY-MM)", "s"], ["note", "Note", "s"], ["status", "Status (Pending / Done / Declined)", "s"], ["createdAt", "Asked", "s"], ["handledBy", "Handled by", "s"], ["handledAt", "Handled", "s"], ["reply", "Reply", "s"]],
  },
  /** Private notepad. A note belongs to one person and is never part of any list, report or dashboard of anyone else. */
  Notes: {
    name: "Notes", idKey: "noteId", prefix: "NOT", softDelete: true,
    cols: [["noteId", "Note ID", "s"], ["userId", "Owner", "s"], ["text", "Text", "s"], ["done", "Done", "s"], ["dueDate", "Due date", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["convertedTo", "Became official task", "s"], ["deleted", "Deleted", "s"]],
  },
  /** Reminders a manager sent. The person also gets a notification; this log records who sent what to whom. */
  Reminders: {
    name: "Reminders", idKey: "remId", prefix: "REM",
    cols: [
      ["remId", "Reminder ID", "s"], ["batchId", "Batch (one send)", "s"], ["sendKey", "Send key (stops double sends)", "s"], ["fromId", "From", "s"], ["toId", "To", "s"], ["message", "Message", "s"],
      ["relatedType", "About (fms / checklist / leave / other)", "s"], ["relatedId", "Related record", "s"], ["relatedTitle", "Related title", "s"], ["link", "Link", "s"], ["dueDate", "Due", "s"],
      ["status", "Status", "s"], ["createdAt", "Sent", "s"], ["readAt", "Read", "s"],
    ],
  },
  /** Notices from the Super Admin to everyone, a department or chosen people. */
  Announcements: {
    name: "Announcements", idKey: "annId", prefix: "ANN", softDelete: true,
    cols: [["annId", "ID", "s"], ["title", "Title", "s"], ["body", "Message", "s"], ["audience", "Audience (all / dept:Name / users:id,id)", "s"], ["tone", "Tone (info / important)", "s"], ["startDate", "Show from", "s"], ["endDate", "Show until", "s"], ["createdBy", "By", "s"], ["createdAt", "Created", "s"], ["deleted", "Deleted", "s"]],
  },
  /** Every e-mail the app must deliver (salary slips). No salary figure is stored here — the document is built from the slip when it is sent. dedupeKey stops the same slip being mailed twice. */
  Mail_Log: {
    name: "Mail_Log", idKey: "mailId", prefix: "MAL",
    cols: [
      ["mailId", "ID", "s"], ["kind", "Kind", "s"], ["refId", "Slip / record", "s"], ["dedupeKey", "Dedupe key (one mail per slip version)", "s"], ["userId", "Employee", "s"], ["toEmail", "Sent to", "s"], ["subject", "Subject", "s"],
      ["status", "Status (Pending / Sending / Sent / Failed / Cancelled)", "s"], ["attempts", "Attempts", "n"], ["lastError", "Last error", "s"], ["nextTry", "Next try", "s"], ["claimedAt", "Being sent since", "s"],
      ["createdAt", "Queued", "s"], ["sentAt", "Sent", "s"], ["createdBy", "Queued by", "s"],
    ],
  },
  Settings: {
    name: "Settings", idKey: "key", prefix: "SET",
    cols: [["key", "Key", "s"], ["value", "Value", "s"], ["description", "Description", "s"], ["group", "Group", "s"]],
  },
  Audit_Log: {
    name: "Audit_Log", idKey: null, prefix: "AUD",
    cols: [
      ["timestamp", "Timestamp", "s"], ["user", "User", "s"], ["action", "Action", "s"], ["entity", "Entity", "s"], ["recordId", "Record ID", "s"],
      ["oldValue", "Old Value", "s"], ["newValue", "New Value", "s"], ["module", "Module", "s"], ["ip", "IP", "s"], ["device", "Device", "s"],
    ],
  },
  /** Custom roles, and edited templates of the built-in roles (roleId = ADMIN / MANAGER / STAFF). */
  Roles: {
    name: "Roles", idKey: "roleId", prefix: "ROL", softDelete: true,
    cols: [["roleId", "Role ID", "s"], ["name", "Name", "s"], ["description", "Description", "s"], ["base", "Behaves like (STAFF / MANAGER / ADMIN)", "s"], ["permsJson", "Permissions (JSON)", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["deleted", "Deleted", "s"]],
  },
  Quick_Links: {
    name: "Quick_Links", idKey: "linkId", prefix: "QLK", softDelete: true,
    cols: [["linkId", "Link ID", "s"], ["ownerId", "Owner (blank = whole company)", "s"], ["title", "Title", "s"], ["url", "URL", "s"], ["category", "Category", "s"], ["favorite", "Favorite", "s"], ["sortOrder", "Order", "n"], ["createdBy", "Created By", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["deleted", "Deleted", "s"]],
  },
  /** Logins. The secret is stored encrypted (AES-256-GCM); the sheet never holds it in clear. */
  Vault_Items: {
    name: "Vault_Items", idKey: "vaultId", prefix: "VLT", softDelete: true,
    cols: [["vaultId", "Vault ID", "s"], ["service", "Service", "s"], ["username", "Username", "s"], ["loginUrl", "Login URL", "s"], ["category", "Category", "s"], ["secretEnc", "Secret (encrypted)", "s"], ["notes", "Notes (not secret)", "s"], ["createdBy", "Created By", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["deleted", "Deleted", "s"]],
  },
  Vault_Access: {
    name: "Vault_Access", idKey: "accessId", prefix: "VAC", softDelete: true,
    cols: [["accessId", "Access ID", "s"], ["vaultId", "Vault ID", "s"], ["userId", "User", "s"], ["canReveal", "May reveal / copy (Y/N)", "s"], ["grantedBy", "Granted By", "s"], ["grantedAt", "Granted", "s"], ["deleted", "Deleted", "s"]],
  },
  Saved_Filters: {
    name: "Saved_Filters", idKey: "filterId", prefix: "FLT", softDelete: true,
    cols: [["filterId", "Filter ID", "s"], ["userId", "Owner", "s"], ["page", "Page", "s"], ["name", "Name", "s"], ["paramsJson", "Filter (JSON)", "s"], ["isDefault", "Default (Y/N)", "s"], ["shared", "Shared (Y/N)", "s"], ["createdAt", "Created", "s"], ["updatedAt", "Updated", "s"], ["deleted", "Deleted", "s"]],
  },
};

export const TABLE_ORDER = ["Users", "Flows", "Flow_Items", "Flow_Tasks", "Comments", "Requests", "Notifications", "Holidays", "Absences", "Checklist_Tasks", "Checklist_Log", "Attendance", "Attendance_Photos", "Leaves", "Profile_Photos", "Employee_Details", "Roles", "Quick_Links", "Vault_Items", "Vault_Access", "Saved_Filters", "Leave_Policy", "Leave_Adjust", "Salary_Slips", "Salary_Structure", "Pay_Waivers", "Slip_Requests", "Notes", "Reminders", "Announcements", "Mail_Log", "Devices", "Att_Exempt", "Settings", "Audit_Log"];

/** [key, default, description] */
export const DEFAULT_SETTINGS: [string, string, string][] = [
  ["COMPANY_NAME", "MIDAP", "Shown in the app header and notifications"],
  ["LEAVE_BLOCK_OVERDRAW", "N", "Y = a leave request that goes beyond the balance is refused (N = it is allowed with a warning)"],
  ["TIMEZONE", "Asia/Kolkata", "IANA timezone for 'now' and 'today' (planned / actual times)"],
  ["REMINDER_MINUTES", "60", "Remind the doer this many minutes before a step is due (a step can override it)"],
  ["ESCALATE_AFTER_MINUTES", "240", "Tell the doer's manager when a step is this many minutes overdue (a step can override it)"],
  ["DIGEST_ENABLED", "N", "Y = send each person a morning summary of their steps (email / WhatsApp if configured)"],
  ["DIGEST_HOUR", "9", "Hour of the day (0-23, in TIMEZONE) for the morning summary"],
  ["WEEKLY_OFF", "0", "Weekly-off days for checklists, comma separated (0 = Sunday). Holidays you add also skip checklist tasks"],
  ["CHECKLIST_REMIND_HOUR", "17", "Hour (0-23) to remind people of checklist tasks still pending today; 24 = never"],
  ["SCORE_BENCHMARK", "10", "Scorecard: up to this % of work not done / not done on time is green"],
  ["ATT_LATE_AFTER", "09:30", "Attendance: a first check-in after this time counts as late"],
  ["ATT_EARLY_BEFORE", "17:00", "Attendance: a last check-out before this time counts as early"],
  ["ATT_FULL_HOURS", "6", "Attendance: this many hours worked = a full day"],
  ["ATT_HALF_HOURS", "4", "Attendance: this many hours worked = a half day (less = absent)"],
  ["ATT_STD_HOURS", "9", "Attendance: normal working hours per day (for the employment-hours %)"],
  ["PAY_LATE_MARKS", "0", "Salary: every this many late arrivals (not waived) cost half a day of pay. 0 = late arrivals never cost pay"],
  ["PAY_EMAIL_SLIPS", "Y", "Salary: Y = a salary slip is e-mailed to the employee when it is published (needs SMTP_URL and the person's email)"],
  ["PAY_EMAIL_ATTACH", "Y", "Salary: Y = the e-mail also carries the slip as an attachment, N = only a private link (opens after sign-in as the employee)"],
  ["ATT_SELF_PUNCH", "Y", "Attendance: Y = people can check in / out from their own phone or PC, N = only at the office kiosk"],
  ["ATT_GATE", "required", "Attendance: what happens when someone opens the app without having checked in on a working day — required = a check-in screen they must complete, prompt = the same screen but they can postpone it, off = nothing"],
  ["ATT_GATE_FROM", "08:00", "Attendance: the check-in screen appears from this time of the day"],
  ["ATT_REMIND_CHECKIN", "09:45", "Attendance: people who have not checked in by this time get a reminder"],
  ["ATT_REMIND_CHECKOUT", "18:30", "Attendance: people still checked in after this time get a reminder to check out"],
  ["PERMISSIONS", "{}", "Edited templates of the built-in roles (set on the Access & roles page)"],
  ["ATT_PHOTO", "N", "Attendance: N = no photo, Y = a selfie is offered, R = a camera photo is COMPULSORY with every check-in / out (except people excused under Devices & camera)"],
  ["ATT_DEVICE_CHECK", "N", "Attendance: Y = people can check in only from a registered (approved) laptop / phone; their first device registers itself, others wait for approval (except people excused under Devices & camera)"],
];
