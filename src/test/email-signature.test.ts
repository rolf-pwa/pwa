import { describe, it, expect } from "vitest";
import { buildSignature, alreadySigned } from "../../supabase/functions/_shared/email-signature";

const ROLF = "Thanks,\nRolf\n\nRolf Issler, BMGT, CLU\nSudden Wealth Specialist | ProsperWise Advisors\n\n(778) 721-5208 | Kelowna, BC | www.prosperwise.ca";

describe("email signature", () => {
  it("keeps the text as typed and normalises line endings", () => {
    const sig = buildSignature(ROLF.replace(/\n/g, "\r\n"))!;
    expect(sig.text).toBe(ROLF);
  });
  it("links web addresses (with or without scheme) and escapes html", () => {
    const sig = buildSignature("A <b>&</b>\nwww.prosperwise.ca.\nhttps://example.com/x?y=1")!;
    expect(sig.html).toContain('<a href="https://www.prosperwise.ca">www.prosperwise.ca</a>.');
    expect(sig.html).toContain('<a href="https://example.com/x?y=1">https://example.com/x?y=1</a>');
    expect(sig.html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(sig.html).not.toContain("<b>");
  });
  it("is empty for blank or missing signatures", () => {
    expect(buildSignature("")).toBeNull();
    expect(buildSignature("  \n ")).toBeNull();
    expect(buildSignature(null)).toBeNull();
    expect(buildSignature(undefined)).toBeNull();
  });
  it("does not double up when the draft already carries it", () => {
    const sig = buildSignature(ROLF)!;
    expect(alreadySigned("Hi\n\nThanks,\nRolf\n\nRolf Issler, BMGT, CLU", sig)).toBe(true);
    expect(alreadySigned("Hi Herman, the file is in your portal.", sig)).toBe(false);
  });
});
