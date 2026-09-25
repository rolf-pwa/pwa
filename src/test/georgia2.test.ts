import { describe, expect, it } from "vitest";
import {
  computeGauges,
  deriveResult,
  bcContextNotes,
  georgiaInsights,
  questionsFor,
  TRANSITION_CATALYSTS,
  CATALYST_SPOKE,
  domainForCatalyst,
  deriveDiagnosticPayload,
  actionPlanFor,
} from "@/modules/intake/lib/derive";

describe("georgia2 derive", () => {
  it("prices the personal Survey at $750", () => {
    expect(deriveResult("personal").surveyPrice).toBe(750);
  });
  it("prices the corporate Survey at $1,500", () => {
    expect(deriveResult("corporate").surveyPrice).toBe(1_500);
  });
  it("headline always points at the Survey regardless of scale", () => {
    expect(deriveResult("personal").headline).toContain("Sovereignty Survey");
    expect(deriveResult("personal").headline).toContain("Sovereignty Survey");
  });

  it("spikes tax drag when LCGE unsure", () => {
    const low = computeGauges("corporate", "founder_exit", { lcge: "intact" });
    const high = computeGauges("corporate", "founder_exit", { lcge: "unsure" });
    expect(high.taxDragRisk).toBeGreaterThan(low.taxDragRisk);
  });
  it("lowers structure safety when passive cash sits in the OpCo", () => {
    const safe = computeGauges("corporate", "growth_stage_founder", { purification: "no" });
    const risky = computeGauges("corporate", "growth_stage_founder", { purification: "yes" });
    expect(safe.structureSafety).toBeGreaterThan(risky.structureSafety);
  });
  it("returns BC context bullets", () => {
    const notes = bcContextNotes("personal", "divorce_restructuring", {});
    expect(notes.some((n) => n.includes("BC Family Law Act"))).toBe(true);
  });
  it("emits the Survey next-step insight once answers exist", () => {
    const ins = georgiaInsights("personal", "inheritance", { probate: "yes" });
    expect(ins.some((i) => i.tag === "Your Next Step")).toBe(true);
  });
  it("holds back the next-step insight before any answers", () => {
    const ins = georgiaInsights("personal", "inheritance", {});
    expect(ins.some((i) => i.tag === "Your Next Step")).toBe(false);
  });

  it("emits noise exposure insight for contested divorce", () => {
    const ins = georgiaInsights(
      "personal",
      "divorce_restructuring",
      { integration_status: "active" }
    );
    expect(ins.some((i) => i.tag === "Noise Exposure")).toBe(true);
  });

  it("orders directives Decision Readiness, Governance Readiness, Noise Exposure, then Tax Exposure", () => {
    const ins = georgiaInsights("personal", "inheritance", {
      nervous_system: "overload",
      governance: "none",
      advisory: "siloed",
      probate: "yes",
    });
    const tags = ins.map((i) => i.tag).filter((t) => t !== "Your Next Step");
    expect(tags).toEqual(["Decision Readiness", "Governance Readiness", "Noise Exposure", "Tax Exposure"]);
  });
  it("folds probate into Tax Exposure instead of a separate BC note", () => {
    expect(bcContextNotes("personal", "inheritance", { probate: "yes" }).some((n) => n.includes("Probate"))).toBe(false);
    const tax = georgiaInsights("personal", "inheritance", { probate: "yes" }).find((i) => i.tag === "Tax Exposure");
    expect(tax?.body).toContain("probate");
  });
  it("gives every catalyst a directives section, even when nothing is triggered", () => {
    const healthy = { nervous_system: "grounded", governance: "charter", advisory: "vfo" };
    for (const catalyst of ["founder_exit", "growth_stage_founder"] as const) {
      const tags = georgiaInsights("corporate", catalyst, healthy).map((i) => i.tag).filter((x) => x !== "Your Next Step");
      expect(tags).toEqual(["Foundations in Good Standing"]);
    }
    for (const catalyst of [
      "inheritance",
      "executive_exit",
      "divorce_restructuring",
      "insurance_settlement",
      "sudden_windfall",
    ] as const) {
      const tags = georgiaInsights("personal", catalyst, healthy).map((i) => i.tag).filter((x) => x !== "Your Next Step");
      expect(tags.length).toBeGreaterThan(0);
    }
  });
  it("keeps every flow to about seven questions", () => {
    for (const c of TRANSITION_CATALYSTS) {
      expect(questionsFor(c).length).toBeLessThanOrEqual(8);
    }
    expect(questionsFor("inheritance").length).toBe(7);
  });
  it("maps every transition tile to a spoke and derives the domain from it", () => {
    expect(TRANSITION_CATALYSTS).toHaveLength(6);
    expect(new Set(TRANSITION_CATALYSTS.map((c) => CATALYST_SPOKE[c])).size).toBe(6);
    expect(CATALYST_SPOKE.insurance_settlement).toBe("Financial_Windfall");
    expect(domainForCatalyst("founder_exit")).toBe("corporate");
    expect(domainForCatalyst("growth_stage_founder")).toBe("corporate");
    expect(domainForCatalyst("inheritance")).toBe("personal");
  });
  it("derives the Hub payload deterministically from answers, leaving unanswered values null", () => {
    expect(deriveDiagnosticPayload("inheritance", {})).toEqual({
      spoke: "Inheritance",
      emotional_state: null,
      relational_state: null,
      timeline_urgency: null,
      primary_friction: null,
    });
    expect(
      deriveDiagnosticPayload("growth_stage_founder", {
        friction: "paper_wealth",
        relational: "small_circle",
        timeline: "pre_liquidity",
      })
    ).toEqual({
      spoke: "Pre_Exit_Growth",
      emotional_state: "anxiety",
      relational_state: "small_circle",
      timeline_urgency: "pre_liquidity",
      primary_friction: "liquidity_gap",
    });
  });
  it("gives every transition a friction question whose options all set a friction and emotion", () => {
    for (const c of TRANSITION_CATALYSTS) {
      const f = questionsFor(c)[2];
      expect(f.key).toBe("friction");
      for (const o of f.options) {
        expect(o.hub?.primary_friction).toBeTruthy();
        expect(o.hub?.emotional_state).toBeTruthy();
      }
    }
  });
  it("expands Governance Readiness with detail from the visitor's own answers", () => {
    const gov = georgiaInsights("personal", "inheritance", { governance: "none", advisory: "vfo" }).find(
      (i) => i.tag === "Governance Readiness"
    );
    expect(gov?.details?.map((d) => d.label)).toEqual(["Written charter", "Professional coordination"]);
    expect(gov?.details?.[0]).toMatchObject({ value: "No written charter", status: "gap" });
    expect(gov?.details?.[1].status).toBe("strong");
    expect(gov?.nextMove).toContain("Sovereignty Charter");
  });
  it("points the next move at professional coordination when the charter is already in place", () => {
    const gov = georgiaInsights("personal", "inheritance", { governance: "charter", advisory: "siloed" }).find(
      (i) => i.tag === "Governance Readiness"
    );
    expect(gov?.nextMove).toContain("Family CFO");
  });
  it("still shows Governance Readiness for a partial profile, not only the worst case", () => {
    const gov = georgiaInsights("personal", "inheritance", { governance: "legal_only", advisory: "bank" }).find(
      (i) => i.tag === "Governance Readiness"
    );
    expect(gov).toBeTruthy();
    expect(gov?.details).toHaveLength(2);
  });
  it("states the 2026 LCGE limit ($1,275,000) everywhere it is shown", () => {
    const lcgeQuestion = questionsFor("founder_exit").find((q) => q.key === "lcge");
    expect(lcgeQuestion?.tooltip).toContain("$1,275,000");
    expect(bcContextNotes("corporate", "founder_exit", {}).join(" ")).toContain("$1,275,000");
    expect(bcContextNotes("corporate", "founder_exit", {}).join(" ")).not.toContain("1,250,000");
  });
  describe("event-specific language", () => {
    const worst = { governance: "legal_only", advisory: "siloed", nervous_system: "overload", probate: "yes" };
    const allCopy = (c: (typeof TRANSITION_CATALYSTS)[number]) => {
      const parts: string[] = [];
      for (const q of questionsFor(c)) {
        parts.push(q.text, q.tooltip);
        for (const o of q.options) parts.push(o.label, o.description ?? "");
      }
      for (const i of georgiaInsights(domainForCatalyst(c), c, worst)) {
        parts.push(i.tag, i.body, i.nextMove ?? "", ...(i.details ?? []).flatMap((d) => [d.value, d.note]));
      }
      for (const a of actionPlanFor(c)) parts.push(a.title, a.detail);
      return parts.join("\n");
    };
    const BUSINESS_TERMS = /corporate|minute book|shareholder|holdco|opco|founder|cap table/i;

    it("never leaves an unfilled {token} in any flow", () => {
      for (const c of TRANSITION_CATALYSTS) expect(allCopy(c)).not.toMatch(/\{[A-Za-z]+\}/);
    });
    it("keeps business vocabulary out of the personal flows", () => {
      for (const c of ["inheritance", "divorce_restructuring", "executive_exit", "sudden_windfall"] as const) {
        expect(allCopy(c), c).not.toMatch(BUSINESS_TERMS);
      }
    });
    it("names the right lawyer for each event", () => {
      const advisory = (c: (typeof TRANSITION_CATALYSTS)[number]) =>
        questionsFor(c).find((q) => q.key === "advisory")!;
      expect(advisory("inheritance").text).toContain("Estate Lawyer");
      expect(advisory("inheritance").options[0].description).toContain("estate lawyer");
      expect(advisory("divorce_restructuring").text).toContain("Family Lawyer");
      expect(advisory("executive_exit").text).toContain("Employment Lawyer");
      expect(advisory("founder_exit").text).toContain("Corporate Lawyer");
      expect(advisory("growth_stage_founder").options[0].description).toContain("corporate lawyer");
    });
    it("words the wills-only governance answer for the event", () => {
      const legalOnly = (c: (typeof TRANSITION_CATALYSTS)[number]) =>
        questionsFor(c).find((q) => q.key === "governance")!.options.find((o) => o.id === "legal_only")!.label;
      expect(legalOnly("inheritance")).toContain("estate paperwork");
      expect(legalOnly("founder_exit")).toContain("minute books");
      expect(legalOnly("divorce_restructuring")).toContain("separation agreement");
    });
    it("writes the action plan for the event, including a pre-exit founder with no proceeds yet", () => {
      const inheritance = actionPlanFor("inheritance");
      expect(inheritance[0].detail).toContain("inheritance");
      expect(inheritance[2].detail).toContain("probate");
      expect(inheritance[2].detail).not.toContain("corporate");
      const preExit = actionPlanFor("growth_stage_founder");
      expect(preExit[0].title).toBe("Prepare a secure Holding Account");
      expect(preExit[1].detail).toContain("ahead of the exit");
      expect(actionPlanFor("divorce_restructuring")[2].detail).toContain("separation agreement");
    });
    it("only mentions probate in the Tax Exposure directive for inheritance", () => {
      const tax = (c: (typeof TRANSITION_CATALYSTS)[number]) =>
        georgiaInsights(domainForCatalyst(c), c, { probate: "yes" }).find((i) => i.tag === "Tax Exposure");
      expect(tax("inheritance")?.body).toContain("probate");
      expect(tax("divorce_restructuring")?.body ?? "").not.toContain("probate");
    });
  });
  it("asks the person-first questions before any catalyst-specific ones", () => {
    const qs = questionsFor("inheritance");
    expect(qs.slice(0, 3).map((q) => q.key)).toEqual(["nervous_system", "governance", "friction"]);
    expect(qs.length).toBeGreaterThan(3);
  });
  it("raises noise strain and lowers readiness for nervous-system overload", () => {
    const overloaded = computeGauges("personal", "inheritance", { nervous_system: "overload" });
    const grounded = computeGauges("personal", "inheritance", { nervous_system: "grounded" });
    expect(overloaded.noiseStrain).toBeGreaterThan(grounded.noiseStrain);
    expect(overloaded.readiness).toBeLessThan(grounded.readiness);
  });
  it("lowers structure safety when no charter exists and advisors are siloed", () => {
    const exposed = computeGauges("personal", "inheritance", { governance: "none", advisory: "siloed" });
    const governed = computeGauges("personal", "inheritance", { governance: "charter", advisory: "vfo" });
    expect(exposed.structureSafety).toBeLessThan(governed.structureSafety);
  });
  it("emits a governance insight when structure safety is low", () => {
    const ins = georgiaInsights("personal", "inheritance", { governance: "none", advisory: "siloed" });
    expect(ins.some((i) => i.tag === "Governance Readiness")).toBe(true);
  });
});
