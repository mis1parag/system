// Who counts as an EMPLOYEE. A Super Admin can be marked "Super Admin only": that person runs the company in the app but is not an employee —
// no attendance, no leave, no tasks, not in any team list, report, ranking or salary. Everybody else is an employee (a normal Super Admin too, unless marked).
export const isEmployee = (u: Record<string, unknown> | null | undefined): boolean => !(u && String(u.role) === "SUPER_ADMIN" && String(u.notEmployee ?? "") === "Y");
export const NOT_EMPLOYEE_MSG = "This account is a Super Admin only — not an employee. It does not mark attendance, apply for leave, get tasks or appear in team lists and reports.";
