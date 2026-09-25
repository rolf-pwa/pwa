import { describe, expect, it } from "vitest";
import {
  computeGauges,
  deriveResult,
  bcContextNotes,
  georgiaInsights,
  questionsFor,
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
  it("lowers structure safety when no HoldCo", () => {
    const safe = computeGauges("corporate", "founder_exit", { holdco: "yes" });
    const risky = computeGauges("corporate", "founder_exit", { holdco: "no" });
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
  it("asks the person-first questions before any catalyst-specific ones", () => {
    const qs = questionsFor("inheritance");
    expect(qs.slice(0, 3).map((q) => q.key)).toEqual(["nervous_system", "governance", "advisory"]);
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
