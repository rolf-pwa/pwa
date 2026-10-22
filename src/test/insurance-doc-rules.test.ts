import { describe, expect, it } from "vitest";
import { CASL_MARKER, checkSignature, cleanTemplate, fillTemplate, footerVersion, joinNames, nameMatches, sha256Hex, signedPdfBlocks } from "../../supabase/functions/_shared/insurance-doc-rules";
import { buildBrandedPdf, wrap } from "../../supabase/functions/_shared/simple-pdf";

// A cut of the real disclosure as Drive exports it (Markdown, with escaped punctuation).
const SAMPLE = [
  "**ADVISOR DISCLOSURE**", "***Licensing***", "I, Rolf Issler am licensed as a life insurance broker.",
  "***Acknowledgement:***",
  "I, \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ have been informed of, and understand the implications of, this disclosure.",
  "x\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_   x\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_",
  "**Client Signature                Client Signature     Date**",
  "**My Contact Information:**", "**\\<\\>**", "**\\<\\>**",
  "# **Privacy Statement and Consent**", "1.  **Accountability** – We abide by PIPEDA.",
  "**CANADA\\`S ANTI-SPAM LEGISLATION (CASL) CONSENT  ", "**", "Canada’s anti-spam legislation came into effect on July 1, 2014.",
  "       Yes, I agree to receive commercial electronic messages.   ", "Client Initial(s): \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ Email Address: \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_",
  " No, I do not agree to receive commercial electronic messages.     \\[image\\]", "Client initial(s): \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_",
  "x\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_   x\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_",
  "**Client Signature             Client Signature     Date**", "Ver. 2023-2",
].join("\n");

describe("cleaning the master document", () => {
  const c = cleanTemplate(SAMPLE);
  it("drops blank signature lines and paper boxes, and keeps the wording", () => {
    expect(c.md).toContain("**ADVISOR DISCLOSURE**");
    expect(c.md).toContain("We abide by PIPEDA");
    expect(c.md).not.toMatch(/_{4,}/);
    expect(c.md).not.toMatch(/Client Signature/);
    expect(c.md).not.toMatch(/agree to receive commercial|Client initial/i);
    expect(c.md).not.toContain("[image]");
  });
  it("puts the client's name in the acknowledgement", () => { expect(fillTemplate(c.md, { names: ["Thomas Wolfe", "Sarah Wolfe"], advisorContact: "", date: "" })).toContain("I, Thomas Wolfe and Sarah Wolfe have been informed of"); });
  it("leaves one CASL marker where the choice goes, and one contact block", () => {
    expect(c.hasCasl).toBe(true);
    expect(c.md.split(CASL_MARKER)).toHaveLength(2);
    expect(c.md.match(/\{\{advisor_contact\}\}/g)).toHaveLength(1);
    expect(fillTemplate(c.md, { names: ["A B"], advisorContact: "Rolf Issler\nrolf@prosperwise.ca", date: "" })).toContain("Rolf Issler  \nrolf@prosperwise.ca");
  });
  it("reads the version line and fingerprints the wording", async () => {
    expect(footerVersion(SAMPLE)).toBe("2023-2");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("names and signatures", () => {
  it("joins names", () => { expect(joinNames(["A"])).toBe("A"); expect(joinNames(["A", "B", "C"])).toBe("A, B and C"); });
  it("accepts the full name in any case, with a middle name", () => {
    expect(nameMatches("sarah wolfe", "Sarah Elizabeth Wolfe")).toBe(true);
    expect(nameMatches("Sarah Elizabeth Wolfe", "Sarah Wolfe")).toBe(true);
    expect(nameMatches("Sarah", "Sarah Wolfe")).toBe(false);
    expect(nameMatches("Thomas Wolfe", "Sarah Wolfe")).toBe(false);
  });
  it("needs the box ticked, the name, and a CASL choice with initials", () => {
    const ok = { typedName: "Sarah Wolfe", agree: true, caslChoice: "yes", caslInitials: "sw", caslEmail: "s@x.ca" };
    expect(checkSignature(ok, "Sarah Wolfe", true)).toMatchObject({ ok: true, caslInitials: "SW", caslEmail: "s@x.ca" });
    expect(checkSignature({ ...ok, agree: false }, "Sarah Wolfe", true)).toMatchObject({ ok: false });
    expect(checkSignature({ ...ok, caslChoice: undefined }, "Sarah Wolfe", true)).toMatchObject({ ok: false });
    expect(checkSignature({ ...ok, caslInitials: "" }, "Sarah Wolfe", true)).toMatchObject({ ok: false });
    expect(checkSignature({ ...ok, caslEmail: "nope" }, "Sarah Wolfe", true)).toMatchObject({ ok: false });
    expect(checkSignature({ ...ok, caslChoice: "no", caslEmail: "" }, "Sarah Wolfe", true)).toMatchObject({ ok: true, caslEmail: null });
    expect(checkSignature({ typedName: "Sarah Wolfe", agree: true }, "Sarah Wolfe", false)).toMatchObject({ ok: true, caslChoice: null });
  });
});

describe("the frozen PDF", () => {
  const blocks = () => signedPdfBlocks({ md: cleanTemplate(SAMPLE).md, hash: "abc123", templateModified: "2026-10-22", templateVersion: "2023-2", sentAt: "2026-10-22T20:00:00Z", signers: [{ name: "Sarah Wolfe", typedName: "Sarah Wolfe", signedAt: "2026-10-23T18:00:00Z", ip: "1.2.3.4", caslChoice: "yes", caslInitials: "SW", caslEmail: "s@x.ca" }] });
  it("wraps long lines", () => { expect(wrap("word ".repeat(60), 10.5, false, 200).length).toBeGreaterThan(3); });
  it("carries the document, the signatures and the fingerprint", () => {
    const text = JSON.stringify(blocks());
    for (const t of ["Sarah Wolfe", "1.2.3.4", "abc123", "We abide by PIPEDA", "CASL"]) expect(text).toContain(t);
    expect(blocks().some((b) => b.kind === "h" && b.text === "ADVISOR DISCLOSURE")).toBe(true);
  });
  it("builds a well-formed branded PDF: every xref entry points at its object, with the logo and the ProsperWise Advisors line", () => {
    const bytes = buildBrandedPdf({ eyebrow: "ProsperWise Advisors", title: "Advisor Disclosure and Privacy Consent", subtitle: "Signed electronically", footer: "\u00A9 2026 ProsperWise Advisors", blocks: [...blocks(), ...blocks(), ...blocks()] });
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("PROSPERWISE ADVISORS");
    expect(s).toContain("/Logo Do");
    expect(s).toMatch(/Page 1 of [2-9]/);
    const xrefAt = Number(s.match(/startxref\n(\d+)\n%%EOF$/)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(10);
    entries.forEach((off, i) => expect(s.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});

import { alternativesParagraph, costParagraph, fillReasonWhy, needsParagraph, statementFor } from "../../supabase/functions/_shared/insurance-doc-rules";
// The "Reason Why: Life" master as Drive exports it.
const RW = [
  "Hi Edna", "Thanks for entrusting me with your life insurance needs. ", "You indicated that you wanted coverage that would provide coverage for \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_.",
  "The \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ policy offered by \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_is a great option for your needs. It provides the following benefits:",
  "  - \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_", "  - \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_", "  - \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_",
  "If you need to update any of your personal information in the future, please let me know right away.", "Regards, ", "Rolf Issler, BMgt, CLU", "ProsperWise Advisors",
].join("\n");

describe("the letter in the PDF", () => {
  it("sets a bold lead-in on its own bold line", () => {
    const b = signedPdfBlocks({ md: "**What it costs.** The premium is $85 a month.", hash: "h", templateModified: null, templateVersion: null, sentAt: "2026-10-22T00:00:00Z", signers: [] });
    expect(b[0]).toEqual({ kind: "p", text: "What it costs.", bold: true });
    expect(b[1]).toEqual({ kind: "p", text: "The premium is $85 a month." });
  });
});

describe("the reason-why letter", () => {
  const v = { firstNames: ["Thomas", "Sarah"], need: "your family's income, the mortgage and final expenses.", product: "20-year term", carrier: "iA Financial Group", benefits: ["Level premiums for 20 years", "Convertible to permanent"], extra: ["**What it costs.** $85 a month."] };
  const r = fillReasonWhy(RW, v);
  it("fills the greeting, the three blanks and the benefits", () => {
    expect(r.md).toContain("Hi Thomas and Sarah,");
    expect(r.md).toContain("provide coverage for your family's income, the mortgage and final expenses.");
    expect(r.md).toContain("The 20-year term policy offered by iA Financial Group is a great option");
    expect(r.md).toContain("- Level premiums for 20 years\n- Convertible to permanent");
    expect(r.md).not.toMatch(/_{3,}/);
    expect(r.missing).toEqual([]);
  });
  it("puts the extra paragraphs after the benefits and before the closing", () => {
    expect(r.md.indexOf("Convertible to permanent")).toBeLessThan(r.md.indexOf("What it costs"));
    expect(r.md.indexOf("What it costs")).toBeLessThan(r.md.indexOf("If you need to update"));
  });
  it("says what could not be filled", () => { expect(fillReasonWhy(RW, { ...v, carrier: "", benefits: [] }).missing).toEqual(["benefits", "the carrier"]); });
  it("builds the needs, cost and alternatives paragraphs", () => {
    const n = needsParagraph([{ name: "Thomas", need: 1500000, available: 552500, shortfall: 947500, surplus: 0, percentMet: 37 }], 1000000);
    expect(n).toContain("a total need of $1,500,000, against $552,500");
    expect(n).toContain("a shortfall of $947,500");
    expect(n).toContain("recommended here is $1,000,000");
    expect(needsParagraph([], null)).toBe("");
    expect(costParagraph(85, "monthly", "20-year term")).toBe("**What it costs.** The premium for the 20-year term is $85 a month.");
    expect(costParagraph(null, null, "x")).toBe("");
    expect(alternativesParagraph("  ")).toBe("");
  });
  it("has its own statement for a letter", () => { expect(statementFor("reason_why")).toMatch(/received and read this letter/); expect(statementFor("disclosure_privacy")).toMatch(/read this document/); });
});
