import { describe, expect, it } from "vitest";
import {
  fallbackValidation,
  keywordThreat,
  validateValidationText,
} from "../../supabase/functions/_shared/georgia-safety";

describe("keywordThreat", () => {
  it("flags explicit threat, harm, coercion, theft and legal-action language", () => {
    for (const text of [
      "My ex has threatened to hurt me if I don't sign.",
      "My brother says he will sue me over the will.",
      "He is stalking me and I'm scared.",
      "They tried to blackmail me.",
      "I think my accountant stole from the account.",
      "I've been having thoughts of suicide.",
      "I want to kill myself",
      "There is a lawsuit over the estate.",
      "He's been violent before.",
    ]) {
      expect(keywordThreat(text), text).toBe(true);
    }
  });

  it("does not flag ordinary distress, family friction, or a person named Sue", () => {
    for (const text of [
      "I'm overwhelmed by my father's estate and don't know where to start.",
      "My brother and I disagree about the cottage.",
      "I sold my company and feel lost.",
      "Everyone keeps calling with investment ideas.",
      "My sister Sue is helping me sort out mom's things.",
      "I feel guilty spending any of it.",
      "The bank keeps pushing me to move everything to them.",
    ]) {
      expect(keywordThreat(text), text).toBe(false);
    }
  });
});

describe("validateValidationText", () => {
  const ok =
    "Receiving an inheritance is rarely just a financial event. Feeling guilt alongside it is more common than most people admit.";

  it("accepts a short, plain acknowledgment", () => {
    expect(validateValidationText(ok)).toBe(true);
  });

  it("rejects numbers, money, links, exclamations, advice, and bad lengths", () => {
    expect(validateValidationText("Too short. Really.")).toBe(false);
    expect(validateValidationText(ok + " You have 90 days.")).toBe(false);
    expect(validateValidationText(ok + " Keep it under $5 million.")).toBe(false);
    expect(validateValidationText(ok + " See https://example.com for more.")).toBe(false);
    expect(validateValidationText(ok + " You've got this!")).toBe(false);
    expect(validateValidationText(ok + " You should invest it carefully.")).toBe(false);
    expect(validateValidationText(ok + " I recommend waiting.")).toBe(false);
    expect(validateValidationText("Only one long sentence that goes on and on without stopping for a full breath at all here")).toBe(false);
    expect(validateValidationText(undefined)).toBe(false);
    expect(validateValidationText("x".repeat(500))).toBe(false);
  });
});

describe("fallbackValidation", () => {
  const spokes = [
    "Business_Exit",
    "Pre_Exit_Growth",
    "Inheritance",
    "Divorce",
    "Executive_Retirement",
    "Financial_Windfall",
    null,
  ];
  const emotions = ["relief", "anxiety", "guilt", "grief", "loss_of_identity", "euphoria", null];
  const frictions = [
    "family_pressure",
    "professional_pressure",
    "internal_paralysis",
    "operational_overload",
    "liquidity_gap",
    "no_friction",
    null,
  ];

  it("always produces text that would pass its own validator", () => {
    for (const spoke of spokes)
      for (const emotion of emotions)
        for (const friction of frictions) {
          const text = fallbackValidation(spoke, emotion, friction);
          expect(validateValidationText(text), `${spoke}/${emotion}/${friction}: ${text}`).toBe(true);
        }
  });

  it("speaks to the visitor's event", () => {
    expect(fallbackValidation("Inheritance", "guilt", null)).toContain("inheritance");
    expect(fallbackValidation("Divorce", null, null)).toContain("separation");
  });
});
