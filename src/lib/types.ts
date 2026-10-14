export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "STAFF";

export interface User {
  userId: string; name: string; role: Role; mobile: string; email: string; status: "Active" | "Inactive"; department?: string;
}

export const ROLE_LABEL: Record<Role, string> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", MANAGER: "Manager", STAFF: "Team Member" };

export interface ApiResult<T = unknown> {
  ok: boolean; data?: T; changes?: Record<string, Record<string, unknown>[]>; removed?: Record<string, string[]>;
  warnings?: string[]; error?: string; code?: string; extra?: Record<string, unknown> | null;
}
