import { describe, it, expect } from "vitest";
import { signatureFor, alreadySigned } from "../../supabase/functions/_shared/email-signature";

describe("email signature", () => {
  it("returns Rolf's signature for his login email, case-insensitively", () => {
    const sig = signatureFor("Rolf@ProsperWise.ca");
    expect(sig?.text).toContain("Rolf Issler, BMGT, CLU");
    expect(sig?.text).toContain("(778) 721-5208 | Kelowna, BC | www.prosperwise.ca");
    expect(sig?.text.startsWith("Thanks,\nRolf")).toBe(true);
  });
  it("links the website and escapes html", () => {
    const sig = signatureFor("rolf@prosperwise.ca")!;
    expect(sig.html).toContain('<a href="https://www.prosperwise.ca">www.prosperwise.ca</a>');
    expect(sig.html).not.toContain("<script");
  });
  it("has no signature for other senders", () => {
    expect(signatureFor("someone@prosperwise.ca")).toBeNull();
    expect(signatureFor(undefined)).toBeNull();
  });
  it("does not double up when the draft already carries it", () => {
    const sig = signatureFor("rolf@prosperwise.ca")!;
    expect(alreadySigned("Hi Herman\n\nThanks,\nRolf\n\nRolf Issler, BMGT, CLU", sig)).toBe(true);
    expect(alreadySigned("Hi Herman, the file is in your portal.", sig)).toBe(false);
  });
});
