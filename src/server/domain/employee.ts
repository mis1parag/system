/** Profile picture and employee details. */
import { fail, forbid, pub, require_ } from "../sheets/db.ts";
import { Ctx } from "./ctx.ts";
import { isDate } from "./time.ts";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

// ---------------- profile picture ----------------

/** Everyone who is signed in may look at a profile picture (it is a name tag, not private data). */
export async function getAvatar(ctx: Ctx, d: Record<string, unknown>) {
  const row = (await ctx.tx.rows("Profile_Photos")).find((r) => r.userId === str(d.userId));
  require_(row && row.image, "No photo");
  return { image: String(row.image), updatedAt: row.updatedAt };
}

/** Your own picture, or — for people allowed to manage the team — someone in your reach. An empty image removes it. */
export async function saveProfilePhoto(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId) || ctx.actorId;
  if (userId !== ctx.actorId) { forbid(ctx.allow("employees", "edit") || ctx.allow("employees", "manage"), "You cannot change someone else's photo"); await ctx.requireInReach(userId, "employees"); }
  const user = await ctx.user(userId);
  require_(user, "Unknown person");
  const image = str(d.image);
  require_(image === "" || (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= 45000), "The photo must be a small JPEG (the app shrinks it for you)");
  const rows = await ctx.tx.rows("Profile_Photos");
  const row = rows.find((r) => r.userId === userId);
  if (row) { row.image = image; row.updatedAt = ctx.clock.stamp; }
  else if (image) ctx.tx.insert("Profile_Photos", { userId, image, updatedAt: ctx.clock.stamp });
  user.photoVer = image ? ctx.clock.stamp : "";
  ctx.tx.audit(image ? "Profile photo changed" : "Profile photo removed", "Users", userId);
  return { userId, photoVer: user.photoVer };
}

// ---------------- employee details ----------------

const SELF_FIELDS = ["dob", "gender", "bloodGroup", "address", "personalEmail", "emergencyName", "emergencyPhone"] as const;
const HR_FIELDS = ["designation", "joinDate", "employmentType", "workLocation", "notes"] as const;
export const EMPLOYMENT_TYPES = ["Full time", "Part time", "Contract", "Intern", "Consultant"] as const;

async function mayOpen(ctx: Ctx, userId: string): Promise<{ edit: boolean; editHr: boolean }> {
  if (ctx.isSuper) return { edit: true, editHr: true };
  if (userId === ctx.actorId) return { edit: true, editHr: false };
  ctx.require("employees", "view", "You cannot open this person's details");
  const r = await ctx.reach("employees");
  if (!(r.all || r.ids.has(userId))) fail("FORBIDDEN", "You cannot open this person's details");
  return { edit: ctx.allow("employees", "edit") || ctx.allow("employees", "manage"), editHr: ctx.allow("employees", "manage") };
}

export async function getEmployee(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId) || ctx.actorId;
  const user = await ctx.user(userId);
  require_(user, "Unknown person");
  const may = await mayOpen(ctx, userId);
  const row = (await ctx.tx.rows("Employee_Details")).find((r) => r.userId === userId);
  return { details: row ? pub("Employee_Details", row) : { userId }, canEdit: may.edit, canEditHr: may.editHr };
}

export async function saveEmployee(ctx: Ctx, d: Record<string, unknown>) {
  const userId = str(d.userId) || ctx.actorId;
  const user = await ctx.user(userId);
  require_(user, "Unknown person");
  const may = await mayOpen(ctx, userId);
  forbid(may.edit, "You cannot change these details");
  const rows = await ctx.tx.rows("Employee_Details");
  let row = rows.find((r) => r.userId === userId);
  const next: Record<string, string> = {};
  for (const k of SELF_FIELDS) if (d[k] !== undefined) next[k] = str(d[k]).slice(0, k === "address" ? 300 : 120);
  if (may.editHr) for (const k of HR_FIELDS) if (d[k] !== undefined) next[k] = str(d[k]).slice(0, k === "notes" ? 500 : 120);
  if (next.dob) require_(isDate(next.dob), "Date of birth must be a valid date");
  if (next.joinDate) require_(isDate(next.joinDate), "Date of joining must be a valid date");
  if (next.personalEmail) require_(/^\S+@\S+\.\S+$/.test(next.personalEmail), "Personal email is not valid");
  if (next.employmentType) require_((EMPLOYMENT_TYPES as readonly string[]).includes(next.employmentType), "Choose the employment type from the list");
  const before = row ? { ...row } : null;
  if (!row) row = ctx.tx.insert("Employee_Details", { userId });
  Object.assign(row, next, { updatedAt: ctx.clock.stamp, updatedBy: ctx.actorId });
  ctx.tx.audit("Employee details saved", "Employee_Details", userId, before ? { fields: Object.keys(next) } : null, { fields: Object.keys(next), by: ctx.actorId });
  return pub("Employee_Details", row);
}
