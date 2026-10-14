// onboarding-invite.ts: the invitation link for a household Rolf onboards personally. Pure helpers (testable) plus the click handler.
// The link carries only a random token. A click records itself, starts Georgia's onboarding for the household, and Georgia emails the
// head of household (and the spouse, if they have an email) at the addresses already on file, so a link opened by a mail scanner
// can only make Georgia write to the right people a little early; it never hands out access.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const APP_URL = "https://app.prosperwise.ca";
export const WEBSITE_URL = "https://www.prosperwise.ca/sovereignty-operating-system";
export const INVITE_TTL_DAYS = 30;
export const UNCLICKED_TASK_AFTER_DAYS = 7;

export const inviteUrl = (token: string) => `${APP_URL}/welcome/${token}`;

/** Where an invitation stands. */
export type InviteState = "active" | "clicked" | "expired" | "revoked";
export function inviteState(i: { expires_at: string; revoked_at: string | null; first_clicked_at: string | null }, now: number): InviteState {
  if (i.revoked_at) return "revoked";
  if (i.first_clicked_at) return "clicked";
  return Date.parse(i.expires_at) <= now ? "expired" : "active";
}
/** May a click on this invitation be honoured? (A link already used still redirects, but starts nothing new.) */
export const inviteUsable = (i: { expires_at: string; revoked_at: string | null }, now: number) => !i.revoked_at && Date.parse(i.expires_at) > now;

export const newInviteToken = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Georgia's first message to someone Rolf has invited. It is written for a person who has just read about the Sovereignty
 * Operating System after a personal note from Rolf: it says what happens next, carries the portal link, and never mentions a payment.
 */
export function inviteWelcomeEmail(firstName: string, portalLink: string): { subject: string; html: string } {
  return {
    subject: "Welcome to ProsperWise: your portal is ready",
    html: `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:24px;color:#1e293b;margin:4px 0 16px;">Welcome to ProsperWise</h2>
      <p style="font-size:14px;line-height:1.6;">Hi ${escapeHtml(firstName || "there")},</p>
      <p style="font-size:14px;line-height:1.6;">Thank you for taking a look at the Sovereignty Operating System. I'm Georgia, Rolf's AI assistant, and I'll help you get started.</p>
      <p style="font-size:14px;line-height:1.6;">Your private portal is ready. Your first steps take about ten minutes: confirm your household, tell us a little about what matters to you, add the documents you have to hand, and choose a time for your Survey Session with Rolf.</p>
      <p style="margin:24px 0;"><a href="${portalLink}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Start your onboarding</a></p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This link is personal to you and works for 7 days. After that you can always sign in at <a href="${APP_URL}/portal" style="color:#a37c58;">${APP_URL}/portal</a> with this email address.</p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This is an automated email from Georgia, Rolf's AI Assistant. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}

export interface InviteContact { id: string; first_name: string | null; email: string | null; family_role: string | null; household_id: string | null; is_minor?: boolean | null }

/** Who the invitation is for: head of household first (then head of family), else the first adult with an email. */
export function pickInvitee(contacts: InviteContact[]): InviteContact | null {
  const adults = contacts.filter((c) => !c.is_minor);
  const order = ["head_of_household", "head_of_family"];
  for (const role of order) { const hit = adults.find((c) => c.family_role === role); if (hit) return hit; }
  return adults.find((c) => c.email) ?? adults[0] ?? null;
}

/** Georgia writes to the invitee and, if they have an email, the spouse in the same household. Each person once, only with an email. */
export function welcomeRecipients(invitee: InviteContact, household: InviteContact[]): { contactId: string; firstName: string; email: string }[] {
  const seen = new Set<string>();
  const out: { contactId: string; firstName: string; email: string }[] = [];
  const candidates = [invitee, ...household.filter((c) => c.id !== invitee.id && c.family_role === "spouse" && c.household_id === invitee.household_id && !c.is_minor)];
  for (const c of candidates) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push({ contactId: c.id, firstName: c.first_name ?? "", email: (c.email ?? "").trim() });
  }
  return out;
}
