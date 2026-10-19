// FMS (flow) types shared by the server (src/server) and the browser. Times are wall-clock strings "yyyy-MM-dd HH:mm".
import type { Cap, ModuleId, PermSet } from "./permissions.ts";
import type { User } from "./types.ts";

export type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "select" | "checkbox" | "url" | "phone";
export interface FlowField { key: string; label: string; type: FieldType; required?: boolean; unique?: boolean; options?: string[] }

export type RuleBase = "none" | "anchor" | "field" | "created" | "prev_actual";
export interface FlowRule { base: RuleBase; field?: string; offsetDays?: number; offsetHours?: number; timeOfDay?: string }

/** Who gets a step: a fixed person, a person chosen by a field's value (e.g. location → person), or a pool (round robin / least loaded). */
export interface AssignRule { type: "fixed" | "field" | "pool"; field?: string; map?: Record<string, string>; pool?: string[]; poolMode?: "round_robin" | "least_load" }
/** A step only applies when this holds; otherwise it is skipped ("N/A") for that entry. */
export interface StepCondition { field: string; op: "eq" | "neq" | "in" | "gt" | "lt" | "filled" | "empty"; value?: string }

export interface FlowStep {
  stepId: string; name: string; assigneeId: string; backupId: string; how: string; whenText: string; rule: FlowRule;
  sequential: boolean; autoDone: boolean;
  assign?: AssignRule; condition?: StepCondition;
  /** Extra data the doer must / may enter when marking the step done (docket no., POD received?, …). */
  completionFields?: FlowField[];
  /** 0 / undefined = use the Settings default. */
  reminderMinutes?: number; escalateAfterMinutes?: number; escalateToId?: string;
}

export interface Recurrence {
  enabled: boolean; freq: "daily" | "weekly" | "monthly"; time: string; weekdays?: number[]; monthDay?: number;
  data: Record<string, string>; skipOffDays?: boolean;
}

/** Row as stored in the Flows tab (definition is JSON). */
export interface FlowRec {
  flowId: string; name: string; description: string; status: "Active" | "Archived"; anchorField: string; titleFields: string;
  groupField: string; openLabel: string; doneLabel: string; weeklyOff: string; workStart: string; workEnd: string; slaDays: number;
  intakeToken: string; recurrenceJson: string; lastRunAt: string; fieldsJson: string; stepsJson: string; createdAt: string; createdBy: string; updatedAt: string;
  /** comma separated department names that may see this FMS; blank = every department */ departments: string;
  /** comma separated user ids who may use it besides those departments */ allowedUsers: string;
}
export interface Flow {
  rec: FlowRec; flowId: string; name: string; description: string; archived: boolean; anchorField: string; titleFields: string[]; groupField: string;
  openLabel: string; doneLabel: string; weeklyOff: number[]; workStart: string; workEnd: string; slaDays: number; intakeToken: string;
  recurrence: Recurrence | null; fields: FlowField[]; steps: FlowStep[]; departments: string[]; allowedUsers: string[];
}

export type Priority = "Low" | "Normal" | "High" | "Urgent";
export const PRIORITIES: Priority[] = ["Urgent", "High", "Normal", "Low"];
export type ItemStatus = "Open" | "Completed" | "Cancelled";
export interface FlowItem {
  itemId: string; flowId: string; title: string; dataJson: string; anchorDate: string; originalAnchor: string; postponeCount: number;
  postponeReason: string; priority: Priority; tags: string; source: string; status: ItemStatus; createdAt: string; createdBy: string;
  updatedAt: string; completedAt: string;
  /** who may see it besides the people working on it: assigned · department · users · management */ visibility: string; visibleTo: string; department: string;
}
export type TaskStatus = "Pending" | "Done" | "Skipped";
export interface FlowTask {
  taskId: string; itemId: string; flowId: string; stepId: string; seq: number; assigneeId: string; status: TaskStatus; planned: string;
  origPlanned: string; actual: string; doneBy: string; remarks: string; dataJson: string; extCount: number; remindedAt: string;
  overdueAt: string; escalatedAt: string; updatedAt: string;
}
export interface FlowComment { commentId: string; itemId: string; flowId: string; userId: string; text: string; createdAt: string }
export type RequestStatus = "Pending" | "Approved" | "Rejected";
export interface FlowRequest {
  requestId: string; taskId: string; itemId: string; flowId: string; requestedBy: string; newPlanned: string; reason: string;
  status: RequestStatus; decidedBy: string; decidedAt: string; note: string; createdAt: string; kind?: string;
}
export interface Notification {
  notifId: string; userId: string; type: string; title: string; body: string; link: string; itemId: string; taskId: string;
  dedupeKey: string; channels: string; createdAt: string; readAt: string;
}
/** Recurring personal work ("checklist"): D daily · W weekly · F fortnightly · M monthly · Q quarterly · H half-yearly · Y yearly · O one-time. */
export type ChecklistFreq = "D" | "W" | "F" | "M" | "Q" | "H" | "Y" | "O";
export const CHECKLIST_FREQ: { id: ChecklistFreq; label: string; group: "DC" | "NDC" | "OT" }[] = [
  { id: "D", label: "Daily", group: "DC" }, { id: "W", label: "Weekly", group: "NDC" }, { id: "F", label: "Every 2 weeks", group: "NDC" }, { id: "M", label: "Monthly", group: "NDC" },
  { id: "Q", label: "Quarterly", group: "NDC" }, { id: "H", label: "Half-yearly", group: "NDC" }, { id: "Y", label: "Yearly", group: "NDC" }, { id: "O", label: "One time", group: "OT" },
];
export interface ChecklistTask {
  ctId: string; title: string; doerId: string; backupId: string; department: string; freq: ChecklistFreq; startDate: string; endDate: string; proof: string;
  kra: string; status: "Active" | "Paused" | "Archived"; lastGenerated: string; createdAt: string; createdBy: string; updatedAt: string;
}
export type ChecklistStatus = "Pending" | "Done" | "Skipped" | "Cancelled";
export interface ChecklistEntry {
  clId: string; ctId: string; doerId: string; plannedDate: string; status: ChecklistStatus; actual: string; doneBy: string; proof: string; remarks: string;
  remindedAt: string; createdAt: string; updatedAt: string; origDate: string; movedBy: string;
}
export interface Holiday { holidayId: string; date: string; label: string; flowId: string }
export interface Absence { absenceId: string; userId: string; fromDate: string; toDate: string; backupUserId: string; reason: string; createdBy: string; createdAt: string }
export interface FlowUser { userId: string; name: string; role: string; status: string; managerId?: string; notify?: string; mobile?: string; email?: string; department?: string; empCode?: string; leaveAllot?: number; photoVer?: string; exitDate?: string; exitType?: string; exitDone?: string; exitReason?: string; exitHandover?: string; exitBy?: string; deleted?: string }
export interface QuickLink { linkId: string; ownerId: string; title: string; url: string; category: string; favorite: string; sortOrder: number; createdBy: string; createdAt: string; updatedAt: string }
export interface SavedFilter { filterId: string; userId: string; page: string; name: string; paramsJson: string; isDefault: string; shared: string; createdAt: string; updatedAt: string }
export interface RoleInfo { roleId: string; name: string; description: string; base: string; system: boolean; customized: boolean; perms: PermSet; people: number }

/** One check-in / check-out pair (a person can have several in a day). Times are wall-clock "yyyy-MM-dd HH:mm". */
export interface AttendanceRow {
  attId: string; userId: string; date: string; checkIn: string; checkOut: string; lat: number | null; lng: number | null; outLat: number | null; outLng: number | null;
  note: string; source: string; createdBy: string; createdAt: string; inPhoto: string; outPhoto: string;
}
export const LEAVE_TYPES = ["Full Day", "First Half Day", "Second Half Day", "Short Leave"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export interface LeaveRow {
  leaveId: string; userId: string; type: LeaveType; startDate: string; endDate: string; days: number; reason: string; backupUserId: string;
  status: LeaveStatus; decidedBy: string; decidedAt: string; note: string; createdAt: string;
}

export interface FlowBundle {
  /** Entry totals per flow across ALL history (the loaded items are only open + recent). */
  counts: Record<string, { open: number; completed: number; cancelled: number }>;
  serverDate: string; serverTime: string; me: User & { managerId?: string; notify?: string };
  flows: FlowRec[]; holidays: Holiday[]; absences: Absence[]; users: FlowUser[]; items: FlowItem[]; tasks: FlowTask[];
  requests: FlowRequest[]; notifications: Notification[]; unread: number;
  /** Checklist tasks, and their dated entries (pending ones + roughly the last 70 days). */
  checklistTasks: ChecklistTask[]; checklistLog: ChecklistEntry[];
  /** Attendance punches (everyone for admins, own for staff; last 120 days — the Super Admin gets all) and leave requests. */
  attendance: AttendanceRow[]; leaves: LeaveRow[];
  /** What the signed-in person must do to check in: a camera photo, a registered laptop (unless excused). */
  attRules?: { cameraRequired: boolean; deviceCheck: boolean };
  settings: Record<string, string>;
  /** What the signed-in person may do, module by module (Super Admin: everything). A module that is missing is not theirs. */
  perms: PermSet;
  /** The same as single words, for older screens. */
  can: Record<Cap, boolean>;
  /** Whose records the person may see in each module: everyone (all) or these people. */
  reach: Record<ModuleId, { all: boolean; ids: string[] }>;
  quickLinks: QuickLink[]; savedFilters: SavedFilter[];
  /** Super Admin only: the roles and everyone's personal access, to edit them. */
  roles?: RoleInfo[]; access?: { userId: string; role: string; roleId: string; overrides: PermSet }[];
  /** Departments in use (for pickers). */
  departments: string[];
  /** false when running on the built-in demo data instead of a real Google Sheet */
  live: boolean;
}

export const FLOW_TABLES = {
  Users: { key: "users", id: "userId" },
  Flows: { key: "flows", id: "flowId" },
  Flow_Items: { key: "items", id: "itemId" },
  Flow_Tasks: { key: "tasks", id: "taskId" },
  Requests: { key: "requests", id: "requestId" },
  Notifications: { key: "notifications", id: "notifId" },
  Attendance: { key: "attendance", id: "attId" },
  Leaves: { key: "leaves", id: "leaveId" },
  Checklist_Tasks: { key: "checklistTasks", id: "ctId" },
  Checklist_Log: { key: "checklistLog", id: "clId" },
  Holidays: { key: "holidays", id: "holidayId" },
  Absences: { key: "absences", id: "absenceId" },
  Quick_Links: { key: "quickLinks", id: "linkId" },
  Saved_Filters: { key: "savedFilters", id: "filterId" },
} as const;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
