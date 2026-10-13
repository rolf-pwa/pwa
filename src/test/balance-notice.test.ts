import { describe, it, expect } from "vitest";
import { balanceEmail, monthLabel, noticeBody, planNotices } from "../../supabase/functions/_shared/balance-notice";

describe("the balances-updated note", () => {
  it("says only that balances are current, with no figures, and comes from Georgia", () => {
    const { subject, html } = balanceEmail("Sam", "2026-09-30");
    expect(subject).toBe("Your balances have been updated");
    expect(html).toContain("as of September 30, 2026");
    expect(html).toContain("Georgia, Rolf's AI Assistant");
    expect(html).toContain("just reply to this email");
    expect(html).toContain("https://app.prosperwise.ca/portal");
    expect(html).not.toMatch(/balance of|account number/i);
    expect(html).not.toMatch(/\$\s?\d/);
    expect(noticeBody("2026-09-30")).toBe("Your accounts are up to date as of September 30, 2026. Sign in to review them.");
  });
  it("escapes the name and formats the date without timezone drift", () => {
    expect(balanceEmail("<b>x</b>", "2026-09-30").html).not.toContain("<b>x</b>");
    expect(monthLabel("2026-01-01")).toBe("January 1, 2026");
  });
});

describe("who gets the note", () => {
  const contacts = [
    { id: "a", firstName: "Ann", lastName: "Lee", email: "ann@example.com", household: "Lee" },
    { id: "b", firstName: "Bob", lastName: "Lee", email: null, household: "Lee" },
    { id: "c", firstName: "Cy", lastName: "Fox", email: "cy@example.com", household: "Fox" },
    { id: "d", firstName: "Di", lastName: "Fox", email: "  ", household: "Fox" },
  ];
  it("notifies each person once for their own accounts, lists people with no email, and skips those already told", () => {
    const plan = planNotices({ snapshotContactIds: ["a", "a", "a", "b", "c", "d", "zzz"], contacts, alreadyNotified: new Set(["c"]) });
    expect(plan.send).toEqual([{ contactId: "a", name: "Ann Lee", firstName: "Ann", email: "ann@example.com", household: "Lee", accounts: 3 }]);
    expect(plan.noEmail.map((n) => n.name)).toEqual(["Bob Lee", "Di Fox"]);
    expect(plan.alreadyNotified.map((n) => n.name)).toEqual(["Cy Fox"]);
  });
  it("is empty when nothing was updated", () => {
    expect(planNotices({ snapshotContactIds: [], contacts, alreadyNotified: new Set() })).toEqual({ send: [], noEmail: [], alreadyNotified: [] });
  });
});
