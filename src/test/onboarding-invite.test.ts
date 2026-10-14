import { describe, it, expect } from "vitest";
import { inviteUrl, inviteState, inviteUsable, newInviteToken, inviteWelcomeEmail, pickInvitee, welcomeRecipients, WEBSITE_URL, type InviteContact } from "../../supabase/functions/_shared/onboarding-invite";

const NOW = Date.parse("2026-10-14T18:00:00Z");
const c = (o: Partial<InviteContact> & { id: string }): InviteContact => ({ first_name: o.id, email: `${o.id}@x.com`, family_role: "head_of_household", household_id: "h1", is_minor: false, ...o });

describe("the invitation link", () => {
  it("is a short link on our own domain carrying only a token", () => {
    expect(inviteUrl("abc")).toBe("https://app.prosperwise.ca/welcome/abc");
    const t = newInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(newInviteToken()).not.toBe(t);
    expect(WEBSITE_URL).toBe("https://www.prosperwise.ca/sovereignty-operating-system");
  });
  it("reports where an invitation stands", () => {
    const base = { expires_at: "2026-11-01T00:00:00Z", revoked_at: null, first_clicked_at: null };
    expect(inviteState(base, NOW)).toBe("active");
    expect(inviteState({ ...base, expires_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(inviteState({ ...base, first_clicked_at: "2026-10-14T00:00:00Z" }, NOW)).toBe("clicked");
    expect(inviteState({ ...base, revoked_at: "2026-10-13T00:00:00Z" }, NOW)).toBe("revoked");
  });
  it("honours a click only while it is neither expired nor revoked", () => {
    expect(inviteUsable({ expires_at: "2026-11-01T00:00:00Z", revoked_at: null }, NOW)).toBe(true);
    expect(inviteUsable({ expires_at: "2026-10-01T00:00:00Z", revoked_at: null }, NOW)).toBe(false);
    expect(inviteUsable({ expires_at: "2026-11-01T00:00:00Z", revoked_at: "x" }, NOW)).toBe(false);
  });
});

describe("Georgia's first message to an invited household", () => {
  const e = inviteWelcomeEmail("Kaelen", "https://app.prosperwise.ca/portal/TOKEN/intake");
  it("welcomes them, says what happens next and carries the portal link", () => {
    expect(e.subject).toBe("Welcome to ProsperWise: your portal is ready");
    expect(e.html).toContain("Hi Kaelen,");
    expect(e.html).toContain("https://app.prosperwise.ca/portal/TOKEN/intake");
    expect(e.html).toContain("choose a time for your Survey Session with Rolf");
    expect(e.html).toContain("Georgia, Rolf's AI Assistant");
    expect(e.html).toContain("just reply to this email");
  });
  it("never mentions a payment, a fee or a confirmation of purchase", () => {
    expect(e.html).not.toMatch(/payment|paid|fee|invoice|confirmed|purchase|\$/i);
  });
  it("escapes the name", () => {
    expect(inviteWelcomeEmail("<b>x</b>", "l").html).not.toContain("<b>x</b>");
    expect(inviteWelcomeEmail("", "l").html).toContain("Hi there,");
  });
});

describe("who an invitation is for", () => {
  it("picks the head of household, then the head of family, then the first adult with an email", () => {
    expect(pickInvitee([c({ id: "spouse", family_role: "spouse" }), c({ id: "hoh" })])?.id).toBe("hoh");
    expect(pickInvitee([c({ id: "spouse", family_role: "spouse" }), c({ id: "hof", family_role: "head_of_family" })])?.id).toBe("hof");
    expect(pickInvitee([c({ id: "kid", family_role: "beneficiary", is_minor: true }), c({ id: "adult", family_role: "beneficiary", email: "a@x.com" })])?.id).toBe("adult");
    expect(pickInvitee([])).toBeNull();
  });
  it("writes to the head of household and the spouse in the same household, when they have an email", () => {
    const hoh = c({ id: "hoh" });
    const out = welcomeRecipients(hoh, [hoh, c({ id: "sp", family_role: "spouse" }), c({ id: "other", family_role: "spouse", household_id: "h2" }), c({ id: "kid", family_role: "spouse", is_minor: true })]);
    expect(out.map((r) => r.contactId)).toEqual(["hoh", "sp"]);
  });
  it("skips someone with no email, and never writes to the same address twice", () => {
    const hoh = c({ id: "hoh" });
    expect(welcomeRecipients(hoh, [hoh, c({ id: "sp", family_role: "spouse", email: null })]).map((r) => r.contactId)).toEqual(["hoh"]);
    expect(welcomeRecipients(hoh, [hoh, c({ id: "sp", family_role: "spouse", email: "HOH@x.com" })]).map((r) => r.contactId)).toEqual(["hoh"]);
    expect(welcomeRecipients(c({ id: "none", email: null }), [])).toEqual([]);
  });
});
