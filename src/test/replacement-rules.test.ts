import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateModelFacts, type Evidence } from "../../supabase/functions/_shared/fact-find-rules";
import { EXPLANATION_TITLE, LIRD_AGENT_STATEMENT, LIRD_CLIENT_STATEMENT, LIRD_MD, REPL_ASKS, REPL_FIELDS, assembleReplacement, explanationMarkdown, policyFacts } from "../../supabase/functions/_shared/replacement-rules";

describe("the Declaration wording", () => {
  it("has every question from the form, word for word", () => {
    for (const q of [
      "Do not cancel your existing policy until the new policy is in force and you accept it.",
      "Why do you want to replace your policy? Is the new policy better for you? How?",
      "Should you just buy more insurance or change your policy? How much will these changes cost?",
      "When should you cancel your present policy? When will your next annual dividend be paid? Will the timing affect your cancellation charges?",
      "Will you pay more income tax if you cancel your present policy?",
      "Do you understand the type of insurance policy you are buying? Is it a term life, whole life, or universal life insurance policy? You should know the differences.",
      "Are there times when the new policy will not pay all the benefits that your present policy does? Examples are suicide and contestable periods and contractual exclusions.",
      "Will the new policy pay as much as your present policy? Examples are death benefits, cash values, and dividends.",
      "Does the new policy have the same extra, or optional, benefits as your present policy? Examples are waiver of premium, guaranteed insurability, accidental death, and family member riders.",
      "Are there cancellation charges on the new policy?",
      "What guarantees apply to your present and proposed policies? Which policy has the best guarantees?",
      "Will either of the policy premiums (payments) increase? For how long will the premiums stay the same? How much will they increase?",
      "Please ensure that the agent or broker provides you with copies of the written explanation of the advantages and disadvantages of replacing your life insurance policy with a new policy.",
      "If the policy is not satisfactory for any reason you may have a right to reject it and receive a full refund of premiums, under provincial or territorial law or under contract. Check the policy and the law for the right of rejection and the time limit for rejection.",
    ]) expect(LIRD_MD, q).toContain(q);
  });
  it("uses the form's own signature statements", () => {
    expect(LIRD_CLIENT_STATEMENT).toContain("I confirm that I have received this Life Insurance Replacement Declaration.");
    expect(LIRD_AGENT_STATEMENT).toBe("I have given the client this document and a written explanation of the advantages and disadvantages of replacing their life insurance policy, before starting the application for a new policy.");
  });
});

describe("the written explanation", () => {
  const present = { carrier: "Sun Life", policy_type: "whole_life", policy_number: "WL123", coverage_amount: 250000, premium_amount: 210, premium_frequency: "monthly", cash_value: 41000 };
  const next = { product: "20-year term", carrier: "iA Financial Group", coverage: 500000, premium: 85, frequency: "monthly" };
  const ev: Evidence[] = [{ id: "E1", type: "meeting", label: "Review meeting", date: "2026-10-20", text: "She said the whole life premiums are too high and she wants more cover for less. We talked about keeping the old policy." }];
  const model = validateModelFacts([{ key: "p_why", value: "Premiums on the whole life policy are too high; she wants more cover for less", evidence_id: "E1", quote: "the whole life premiums are too high and she wants more cover for less" }, { key: "n_riders", value: "Same", evidence_id: "E1", quote: "invented words that are not in the meeting notes" }], ev, REPL_FIELDS);
  const facts = assembleReplacement(policyFacts(present, next), model.facts);
  it("describes both policies from the file and what Rolf entered", () => {
    expect(facts.find((f) => f.key === "present_policy")!.value).toBe("whole life with Sun Life, policy WL123, $250,000 of coverage, premium $210 a month, cash value $41,000");
    expect(facts.find((f) => f.key === "new_policy")!.value).toBe("20-year term with iA Financial Group, $500,000 of coverage, premium $85 a month");
  });
  it("takes a quoted fact from the notes, drops an invented one, and lists what is missing to add", () => {
    expect(facts.find((f) => f.key === "p_why")!.value).toContain("Premiums on the whole life policy are too high");
    expect(model.dropped).toBe(1);
    const asks = REPL_ASKS(facts);
    expect(asks).toContain("Death benefit, cash values and dividends, new compared with present");
    expect(asks).toContain("Premium increases on either policy: when and how much");
    expect(asks.length).toBe(REPL_FIELDS.length - 3);
  });
  it("answers every question on the Declaration, under the client's first names", () => {
    const filled = facts.map((f) => (f.value.trim() ? f : { ...f, value: "Not applicable." }));
    const md = explanationMarkdown("Thomas and Sarah", filled);
    expect(md).toContain("Hi Thomas and Sarah,");
    expect(md).toContain("Do not cancel your present policy until the new policy is in force");
    for (const f of REPL_FIELDS.filter((x) => x.origin === "model")) expect(md).toContain(f.label);
    expect(md).toContain("**Present policy.**  whole life with Sun Life");
    expect(EXPLANATION_TITLE).toBe("Your Life Insurance Replacement Explanation");
  });
});

describe("wiring", () => {
  it("has a migration with the grants, the new kinds and the agent columns", () => {
    const m = readFileSync("supabase/migrations/20261220120000_insurance_replacements.sql", "utf8");
    expect(m).toMatch(/GRANT ALL ON public\.insurance_replacements TO service_role;/);
    expect(m).toContain("'replacement_declaration'");
    expect(m).toContain("agent_signed_at");
  });
});

import { AGENT_STATEMENT, REPL_SECTIONS as CLIENT_SECTIONS } from "@/shared/lib/replacement";
import { REPL_SECTIONS as SERVER_SECTIONS } from "../../supabase/functions/_shared/replacement-rules";
import { DOC_ITEMS as CLIENT_ITEMS } from "@/shared/lib/insuranceDocuments";
import { DOC_ITEMS as SERVER_ITEMS, clientGet, clientSigned } from "../../supabase/functions/_shared/insurance-doc-client";
import { CHECKLIST, checklistFor } from "../../supabase/functions/_shared/insurance-file-rules";
import { ITEM_STAGE } from "@/shared/lib/insuranceRoadmap";
import { signedPdfBlocks, statementFor } from "../../supabase/functions/_shared/insurance-doc-rules";

describe("replacement wiring", () => {
  it("keeps the client's lists in step with the server's", () => {
    expect(CLIENT_SECTIONS).toEqual(SERVER_SECTIONS);
    expect(CLIENT_ITEMS).toEqual(SERVER_ITEMS);
    expect(AGENT_STATEMENT).toBe(LIRD_AGENT_STATEMENT);
  });
  it("makes the Declaration and the explanation required for a replacement, before the application", () => {
    const req = checklistFor("replacement").map((c) => c.kind);
    expect(req).toContain("replacement_disclosure");
    expect(req).toContain("replacement_explanation");
    expect(checklistFor("new_sale").map((c) => c.kind)).not.toContain("replacement_explanation");
    for (const k of ["replacement_disclosure", "replacement_explanation"]) expect(ITEM_STAGE[k]).toBe("recommendation");
    expect(CHECKLIST.find((c) => c.kind === "replacement_disclosure")!.label).toBe("Life Insurance Replacement Declaration");
  });
  it("uses the form's statement for the declaration and the letter statement for the explanation", () => {
    expect(statementFor("replacement_declaration")).toContain("I confirm that I have received this Life Insurance Replacement Declaration.");
    expect(statementFor("replacement_explanation")).toMatch(/received and read this letter/);
  });
  it("puts the agent's signature in the signed PDF", () => {
    const b = JSON.stringify(signedPdfBlocks({ agent: { typedName: "Rolf Issler", signedAt: "2026-10-23T18:00:00Z", ip: "203.0.113.5", statement: LIRD_AGENT_STATEMENT }, md: "x", hash: "h", templateModified: null, templateVersion: null, sentAt: "2026-10-22T00:00:00Z", signers: [] }));
    expect(b).toContain("Rolf Issler (agent)");
    expect(b).toContain("before starting the application for a new policy");
  });
  it("lists a person's signed documents with filed copies, and shows the agent's signature to the client", async () => {
    const tables: Record<string, any[]> = {
      insurance_document_signers: [{ id: "s1", document_id: "d1", contact_id: "c1", name: "Thomas Wolfe", status: "signed", signed_at: "2026-10-23T18:00:00Z" }, { id: "s2", document_id: "d2", contact_id: "c1", name: "Thomas Wolfe", status: "signed", signed_at: "2026-10-23T19:00:00Z" }],
      insurance_documents: [{ id: "d1", kind: "replacement_declaration", title: "Life Insurance Replacement Declaration", status: "signed", pdf_drive_id: "f1", body_md: "x", agent_typed_name: "Rolf Issler", agent_signed_at: "2026-10-23T17:00:00Z" }, { id: "d2", kind: "fact_find", title: "Your Fact Find", status: "signed", pdf_drive_id: null, body_md: "y" }],
      contacts: [{ id: "c1", email: "t@x.ca" }],
    };
    const fake = { from: (t: string) => { let rows = tables[t] ?? []; const q: any = { select: () => q, eq: (k: string, v: any) => { rows = rows.filter((r) => r[k] === v); return q; }, neq: (k: string, v: any) => { rows = rows.filter((r) => r[k] !== v); return q; }, in: (k: string, v: any[]) => { rows = rows.filter((r) => v.includes(r[k])); return q; }, maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }), then: (res: any) => Promise.resolve({ data: rows }).then(res) }; return q; } };
    expect((await clientSigned(fake, "c1")).map((d) => d.id)).toEqual(["d1"]);
    const g: any = await clientGet({ from: (t: string) => fake.from(t) }, "c1", "d1");
    expect(g.agent).toEqual({ name: "Rolf Issler", signedAt: "2026-10-23T17:00:00Z" });
  });
});
