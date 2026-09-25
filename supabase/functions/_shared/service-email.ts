// Sends a system email through the shared service Google account (the same
// mailbox georgia2-lead and send-admin-email use). Best-effort by design:
// returns false instead of throwing, so a Gmail problem never fails the
// caller's real work (enrollment, a cron batch).

import { getServiceGoogleAccessToken } from "./google-token.ts";
import { buildRawEmail, base64UrlEncode } from "./gmail-mime.ts";

export const SERVICE_SENDER = "ProsperWise <rolf@prosperwise.ca>";
export const GEORGIA_SENDER = "Georgia · ProsperWise <rolf@prosperwise.ca>";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendServiceEmail(
  client: any,
  opts: { to: string; subject: string; html: string; from?: string },
): Promise<boolean> {
  try {
    const raw = buildRawEmail({
      from: opts.from ?? SERVICE_SENDER,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    });
    const accessToken = await getServiceGoogleAccessToken(client);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64UrlEncode(raw) }),
    });
    if (!res.ok) {
      console.error(`[service-email] send failed [${res.status}]: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[service-email] send threw:", e);
    return false;
  }
}
