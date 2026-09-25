// After a Sovereignty Survey is paid, the confirmation page normally forwards
// the buyer straight into their guided onboarding. If they closed the tab
// first, nothing brought them back -- this emails the same expiring portal
// link (7-day default on portal_tokens) so they can pick up where they left
// off. Best-effort: never blocks enrollment.

import { escapeHtml, sendServiceEmail } from "./service-email.ts";

const APP_URL = "https://app.prosperwise.ca";

export function onboardingLinkEmailHtml(firstName: string, link: string): string {
  return `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:24px;color:#1e293b;margin:4px 0 16px;">Your Sovereignty Survey is confirmed</h2>
      <p style="font-size:14px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:14px;line-height:1.6;">Thank you — your payment is confirmed and your private Sanctuary is ready. Your guided onboarding takes a few minutes: it sets up your household, confirms what brought you to us, and lets you book your session.</p>
      <p style="margin:24px 0;"><a href="${link}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Continue your onboarding</a></p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This link is personal to you and works for 7 days. After that, you can always sign in at <a href="${APP_URL}/portal" style="color:#a37c58;">${APP_URL}/portal</a> with this email address.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">— Rolf &amp; the ProsperWise team</p>
    </div>
  `.trim();
}

export async function sendOnboardingLinkEmail(
  client: any,
  opts: { contactId: string; email: string; firstName: string },
): Promise<boolean> {
  try {
    const { data: minted, error } = await client
      .from("portal_tokens")
      .insert({ contact_id: opts.contactId, created_by: opts.contactId })
      .select("token")
      .maybeSingle();
    if (error || !minted?.token) {
      console.error("[onboarding-link-email] portal token mint failed:", error?.message);
      return false;
    }
    const link = `${APP_URL}/portal/${minted.token}/intake`;
    return await sendServiceEmail(client, {
      to: opts.email,
      subject: "Your Sovereignty Survey is confirmed — continue your onboarding",
      html: onboardingLinkEmailHtml(opts.firstName, link),
    });
  } catch (e) {
    console.error("[onboarding-link-email] failed (non-fatal):", e);
    return false;
  }
}
