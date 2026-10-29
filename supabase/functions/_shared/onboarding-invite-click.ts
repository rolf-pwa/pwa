// onboarding-invite-click.ts: what a click on an invitation link does. Called from intake-portal's public `invite_click` action.
// First click only: record it, switch Georgia's onboarding on for the household (the same Transition Survey onboarding a paid client
// gets), open or wake her case, and email the head of household (and the spouse, if they have an email) their portal link at once.
// Later clicks just count. Georgia's mode is respected: in shadow mode nothing is sent, and when she is off nothing starts.

import { sendServiceEmailDetailed } from "./service-email.ts";
import { AGENT_SENDER } from "./onboarding-agent.ts";
import { APP_URL, inviteUsable, inviteWelcomeEmail, welcomeRecipients, type InviteContact } from "./onboarding-invite.ts";

// deno-lint-ignore no-explicit-any
export async function recordInviteClick(db: any, token: string): Promise<{ ok: boolean; started?: boolean; reason?: string }> {
  if (!token || token.length < 20) return { ok: false, reason: "invalid" };
  const { data: inv } = await db.from("onboarding_invites").select("*").eq("token", token).maybeSingle();
  if (!inv) return { ok: false, reason: "invalid" };

  const now = new Date().toISOString();
  await db.from("onboarding_invites").update({ click_count: (inv.click_count ?? 0) + 1, last_clicked_at: now }).eq("id", inv.id);
  if (!inviteUsable(inv, Date.now())) return { ok: true, started: false, reason: inv.revoked_at ? "revoked" : "expired" };

  // Claim the first click: only one request can win, so a double click or a scanner plus a person starts onboarding once.
  const { data: claimed } = await db.from("onboarding_invites").update({ first_clicked_at: now }).eq("id", inv.id).is("first_clicked_at", null).select("id").maybeSingle();
  if (!claimed) return { ok: true, started: false, reason: "already_clicked" };

  const { data: cfg } = await db.from("onboarding_agent_config").select("mode").eq("id", true).maybeSingle();
  const mode = cfg?.mode as "off" | "shadow" | "live" | undefined;
  const event = (kind: string, detail: Record<string, unknown> = {}, caseId: string | null = null) =>
    db.from("onboarding_agent_events").insert({ household_id: inv.household_id, case_id: caseId, mode: mode ?? "off", kind, detail });
  await event("invite_clicked", { clicks: (inv.click_count ?? 0) + 1 });

  if (!mode || mode === "off") return { ok: true, started: false, reason: "georgia_off" };

  // The invited household gets the same onboarding as a paid Survey client.
  await db.from("households").update({ onboarding_enabled: true }).eq("id", inv.household_id);
  const { data: existing } = await db.from("onboarding_cases").select("id, status").eq("household_id", inv.household_id).eq("mode", mode).maybeSingle();
  let caseId: string | null = existing?.id ?? null;
  if (existing) {
    if (existing.status === "paused") await db.from("onboarding_cases").update({ status: "active", updated_at: now }).eq("id", existing.id);
  } else {
    const { data: created } = await db.from("onboarding_cases").insert({ household_id: inv.household_id, mode }).select("id").maybeSingle();
    caseId = created?.id ?? null;
  }

  const { data: people } = await db.from("contacts").select("id, first_name, email, family_role, household_id, is_minor, no_automated_email").eq("household_id", inv.household_id);
  const invitee = ((people ?? []) as InviteContact[]).find((p) => p.id === inv.contact_id);
  const recipients = invitee ? welcomeRecipients(invitee, ((people ?? []) as any[]).map((p) => (p.no_automated_email ? { ...p, email: null } : p)) as InviteContact[]) : [];

  if (mode === "shadow") {
    await event("welcome_would_send", { to: recipients.length }, caseId);
    await db.from("onboarding_invites").update({ started_at: now }).eq("id", inv.id);
    return { ok: true, started: true };
  }

  // The portal's guided onboarding only opens for a household with a qualifying (paid or not-required) Survey booking, so an invited
  // household needs a no-charge one, exactly as "Enroll in Guided Intake" creates for an existing client.
  await ensureNoChargeBooking(db, (people ?? []).map((p: any) => p.id), inv.contact_id);

  let sent = 0;
  for (const r of recipients) {
    // A fresh portal link for each person, the same kind the paid onboarding email uses (7 days, then they sign in with their email).
    const { data: minted } = await db.from("portal_tokens").insert({ contact_id: r.contactId, created_by: r.contactId }).select("token").maybeSingle();
    if (!minted?.token) continue;
    const { subject, html } = inviteWelcomeEmail(r.firstName, `${APP_URL}/portal/${minted.token}/intake`);
    const res = await sendServiceEmailDetailed(db, { to: r.email, subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
    if (res.ok) sent++;
  }
  await db.from("onboarding_invites").update({ started_at: now, welcome_sent_to: sent }).eq("id", inv.id);
  await event(sent ? "welcome_sent" : "welcome_failed", { to: sent, of: recipients.length }, caseId);
  return { ok: true, started: true };
}

/** Makes sure someone in the household has a qualifying booking so the portal's guided onboarding switches on. Idempotent. */
export async function ensureNoChargeBooking(db: any, memberIds: string[], contactId: string): Promise<void> {
  if (!memberIds.length) return;
  const { data: existing } = await db.from("service_bookings").select("id").in("contact_id", memberIds).in("payment_status", ["paid", "not_required"]).limit(1);
  if (existing?.length) return;
  const { data: service } = await db.from("services").select("id").ilike("name", "%sovereignty%audit%").limit(1).maybeSingle();
  await db.from("service_bookings").insert({
    contact_id: contactId, service_id: service?.id ?? null, status: "confirmed", payment_status: "not_required", amount: 0, total: 0, currency: "CAD",
    paid_at: new Date().toISOString(), notes: "Invited by Rolf: Transition Survey onboarding. No payment required.",
  });
}
