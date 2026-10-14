/** Check-in / check-out reminders, sent by the scheduler. A person who forgets is told — once a day, in the app (and by email / WhatsApp if connected). */
import { Ctx } from "./ctx.ts";
import { checklistCalendar } from "./checklist.ts";
import { addDays, isOffDay } from "./time.ts";

export async function attendanceTick(ctx: Ctx): Promise<{ checkIn: number; checkOut: number }> {
  const out = { checkIn: 0, checkOut: 0 };
  const now = ctx.clock;
  const cal = await checklistCalendar(ctx);
  if (isOffDay(now.date, cal)) return out;
  const hm = now.time.slice(0, 5);
  const wantIn = hm >= ctx.setting("ATT_REMIND_CHECKIN", "09:45") && hm < "13:00";
  const wantOut = hm >= ctx.setting("ATT_REMIND_CHECKOUT", "18:30");
  if (!wantIn && !wantOut) return out;
  await ctx.tx.load("Users", "Attendance", "Leaves", "Notifications");
  const rows = (await ctx.tx.rows("Attendance")).filter((r) => r.deleted !== "Y");
  const leaves = (await ctx.tx.rows("Leaves")).filter((l) => l.status === "Approved" && String(l.startDate) <= now.date && String(l.endDate) >= now.date);
  const sent = new Set((await ctx.tx.rows("Notifications")).filter((n) => (n.type === "checkin-reminder" || n.type === "checkout-reminder") && String(n.createdAt).slice(0, 10) === now.date).map((n) => `${n.type}|${n.userId}`));
  const since = addDays(now.date, -45);
  for (const u of await ctx.tx.rows("Users")) {
    if (u.status !== "Active") continue;
    const uid = String(u.userId);
    const mine = rows.filter((r) => r.userId === uid);
    if (!u.empCode && !mine.some((r) => String(r.date) >= since)) continue; // not part of the attendance system
    const today = mine.filter((r) => r.date === now.date);
    if (wantIn && !today.length && !leaves.some((l) => l.userId === uid && (l.type === "Full Day"))) {
      if (sent.has(`checkin-reminder|${uid}`)) continue;
      ctx.notice({ userId: uid, type: "checkin-reminder", title: "You have not checked in yet", body: ctx.setting("ATT_SELF_PUNCH", "Y") === "N" ? "Please check in at the office kiosk." : "Open the app and tap Check in. If you are not working today, apply for leave.", link: "/flows/attendance", dedupeKey: `attin|${uid}|${now.date}`, self: true });
      out.checkIn++;
    } else if (wantOut && today.some((r) => !r.checkOut)) {
      if (sent.has(`checkout-reminder|${uid}`)) continue;
      ctx.notice({ userId: uid, type: "checkout-reminder", title: "Still checked in — did you forget to check out?", body: "Tap Check out when you leave, so your hours are right.", link: "/flows/attendance", dedupeKey: `attout|${uid}|${now.date}`, self: true });
      out.checkOut++;
    }
  }
  return out;
}
