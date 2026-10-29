// balance-notice.ts: Georgia's "your balances are updated" note after the monthly import. Pure (no I/O) so it can be
// unit-tested. It never contains a balance, a figure or an account detail: only that balances are current, and where to look.

import { PORTAL_URL } from "./onboarding-agent.ts";

export const FROM_LINE = "Georgia, Rolf's AI Assistant";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function monthLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

export const NOTICE_TITLE = "Your balances have been updated";
export const noticeBody = (isoDate: string) => `Your accounts are up to date as of ${monthLabel(isoDate)}. Sign in to review them.`;

export function balanceEmail(firstName: string, isoDate: string): { subject: string; html: string } {
  return {
    subject: "Your balances have been updated",
    html: `
    <div style="font-family:Inter,sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5A6A80;">Sovereignty Operating System™</p>
      <p style="font-size:14px;line-height:1.6;">Hi ${escape(firstName || "there")},</p>
      <p style="font-size:14px;line-height:1.6;">Your account balances have been updated as of ${escape(monthLabel(isoDate))}. You can review them in your portal.</p>
      <p style="margin:20px 0;"><a href="${PORTAL_URL}" style="background:#0A192F;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Open your portal</a></p>
      <p style="font-size:13px;line-height:1.6;color:#5A6A80;">This is an automated email from ${FROM_LINE}. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#5A6A80;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}

export interface NoticeContact { id: string; firstName: string | null; lastName: string | null; email: string | null; household: string | null }
export interface NoticePlan {
  send: { contactId: string; name: string; firstName: string; email: string; household: string | null; accounts: number }[];
  noEmail: { contactId: string; name: string; household: string | null; accounts: number }[];
  alreadyNotified: { contactId: string; name: string }[];
}

/** Who gets the note: each person whose own accounts were updated on that date, once. People with no email are listed, not skipped silently. */
export function planNotices(i: { snapshotContactIds: string[]; contacts: NoticeContact[]; alreadyNotified: Set<string> }): NoticePlan {
  const counts = new Map<string, number>();
  for (const id of i.snapshotContactIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const byId = new Map(i.contacts.map((c) => [c.id, c]));
  const plan: NoticePlan = { send: [], noEmail: [], alreadyNotified: [] };
  for (const [id, accounts] of counts) {
    const c = byId.get(id);
    if (!c) continue;
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed contact";
    if (i.alreadyNotified.has(id)) { plan.alreadyNotified.push({ contactId: id, name }); continue; }
    const email = (c.email ?? "").trim();
    if (!email) { plan.noEmail.push({ contactId: id, name, household: c.household, accounts }); continue; }
    plan.send.push({ contactId: id, name, firstName: c.firstName ?? "", email, household: c.household, accounts });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  plan.send.sort(byName); plan.noEmail.sort(byName); plan.alreadyNotified.sort(byName);
  return plan;
}
