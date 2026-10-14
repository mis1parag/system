/**
 * Optional outside delivery of notifications (in-app ones are always stored in the Notifications tab):
 *  - email through any SMTP server        SMTP_URL=smtps://user:pass@smtp.gmail.com  MAIL_FROM="MIDAP <you@gmail.com>"
 *  - WhatsApp through a webhook of your gateway   WHATSAPP_WEBHOOK_URL=https://…  [WHATSAPP_WEBHOOK_TOKEN=…]
 * The webhook receives POST JSON { to, phone, number, text, message } (all carrying the same values) so most gateways work as they are.
 * Each person chooses their channels under Profile (Users.notify = "app,email,whatsapp").
 */
import type { Rec } from "../sheets/db.ts";
import type { Outbox } from "./ctx.ts";

export interface DeliveryConfig { smtpUrl?: string; mailFrom?: string; whatsappUrl?: string; whatsappToken?: string; appUrl?: string; countryCode?: string }

export function deliveryFromEnv(env: Record<string, string | undefined> = process.env): DeliveryConfig {
  return {
    smtpUrl: env.SMTP_URL?.trim() || undefined, mailFrom: env.MAIL_FROM?.trim() || undefined,
    whatsappUrl: env.WHATSAPP_WEBHOOK_URL?.trim() || undefined, whatsappToken: env.WHATSAPP_WEBHOOK_TOKEN?.trim() || undefined,
    appUrl: env.APP_URL?.trim().replace(/\/$/, "") || undefined, countryCode: env.WHATSAPP_COUNTRY_CODE?.trim() || "91",
  };
}

interface Mailer { sendMail(m: { from?: string; to: string; subject: string; text: string }): Promise<unknown> }
let mailer: { url: string; t: Mailer } | null = null;

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

/** Send queued notifications outside the app. Never throws: returns the problems so callers can log them. */
export async function deliver(cfg: DeliveryConfig, items: Outbox[], users: Rec[], company: string): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  if (!cfg.smtpUrl && !cfg.whatsappUrl) return { sent, errors };
  const byId = new Map(users.map((u) => [String(u.userId), u]));
  for (const n of items) {
    const u = byId.get(n.userId);
    if (!u || u.status !== "Active") continue;
    const channels = String(u.notify || "app").split(",").map((x) => x.trim());
    const link = n.link ? (cfg.appUrl ? `${cfg.appUrl}${n.link}` : n.link) : "";
    const text = `${n.title}${n.body ? `\n${n.body}` : ""}${link ? `\n${link}` : ""}`;
    if (cfg.smtpUrl && channels.includes("email") && u.email) {
      try {
        if (!mailer || mailer.url !== cfg.smtpUrl) {
          const nm = await import("nodemailer");
          mailer = { url: cfg.smtpUrl, t: nm.createTransport(cfg.smtpUrl) as unknown as Mailer };
        }
        await withTimeout(mailer.t.sendMail({ from: cfg.mailFrom, to: String(u.email), subject: `[${company}] ${n.title}`, text }), 8000, "email");
        sent++;
      } catch (e) { errors.push(`email to ${u.name}: ${e instanceof Error ? e.message : e}`); }
    }
    if (cfg.whatsappUrl && channels.includes("whatsapp") && u.mobile) {
      try {
        const to = `${cfg.countryCode}${String(u.mobile).replace(/\D/g, "").slice(-10)}`;
        const res = await withTimeout(fetch(cfg.whatsappUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(cfg.whatsappToken ? { Authorization: `Bearer ${cfg.whatsappToken}` } : {}) },
          body: JSON.stringify({ to, phone: to, number: to, text: `*${company}*\n${text}`, message: `*${company}*\n${text}` }),
        }), 8000, "WhatsApp");
        if (!res.ok) throw new Error(`gateway answered ${res.status}`);
        sent++;
      } catch (e) { errors.push(`WhatsApp to ${u.name}: ${e instanceof Error ? e.message : e}`); }
    }
  }
  return { sent, errors };
}
