import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { flaggedAreas, georgiaFactLines } from "../../supabase/functions/_shared/georgia-diagnostic-facts";
import { summarizeAnswers } from "@/modules/intake/lib/diagnostic-summary";
import { GeorgiaDiagnosticView, type GeorgiaDiagnosticLead } from "@/modules/intake/components/GeorgiaDiagnosticCard";

const lead: GeorgiaDiagnosticLead = {
  id: "1",
  first_name: "Pat",
  catalyst: "inheritance",
  chosen_pathway: "survey",
  submitted_at: "2026-09-26T12:00:00Z",
  answers: { nervous_system: "overload", governance: "legal_only", advisory: "siloed", friction: "guilt", probate: "yes" },
  risk_scores_calculated: { tax_drag_risk: 88, structure_safety: 31, noise_strain: 91, readiness_score: 22 },
  diagnostic_payload: {
    emotional_state: "guilt",
    relational_state: "small_circle",
    timeline_urgency: "under_30_days",
    primary_friction: "internal_paralysis",
  },
  unstructured_stress_quote: "I keep thinking dad would hate what I'm doing with it.",
  freeform_extraction: { threat_detected: false },
  validation_text: "Receiving an inheritance is rarely just a financial event. Feeling guilt is common.",
};

describe("Georgia facts for the Survey narrative", () => {
  const lines = georgiaFactLines(lead).join("\n");

  it("describes the client's situation in plain words", () => {
    expect(lines).toContain("your inheritance");
    expect(lines).toContain("feeling guilt");
    expect(lines).toContain("feeling stuck");
    expect(lines).toContain("heavy outside pressure");
    expect(lines).toContain("a small circle");
    expect(lines).toContain("lands within 30 days");
    expect(lines).toContain("written charter");
    expect(lines).toContain("professional coordination: professionals work in silos");
  });

  it("never carries raw scores, field names, or the client's own words", () => {
    expect(lines).not.toMatch(/\b(88|31|91|22)\b/); // none of the gauge values
    expect(lines).not.toMatch(/_score|tax_drag|structure_safety|noise_strain|nervous_system|primary_friction/);
    expect(lines).not.toContain("dad would hate");
  });

  it("lists flagged areas by the results-screen thresholds", () => {
    expect(georgiaFactLines(lead)[1]).toContain("decision readiness");
    expect(flaggedAreas({ tax_drag_risk: 30, structure_safety: 90, noise_strain: 20, readiness_score: 95 })).toEqual([]);
    expect(flaggedAreas(null)).toEqual([]);
  });

  it("returns nothing when there is no diagnostic to use", () => {
    expect(georgiaFactLines(null)).toEqual([]);
    expect(georgiaFactLines({ catalyst: "inheritance", answers: {}, diagnostic_payload: null, risk_scores_calculated: null })).toEqual([]);
  });
});

describe("summarizeAnswers", () => {
  it("uses the visitor's own event-specific wording and keeps unknown keys", () => {
    const { rows, other } = summarizeAnswers("inheritance", { governance: "legal_only", advisory: "siloed", old_key: "x" });
    expect(rows.find((r) => r.key === "governance")?.value).toContain("estate paperwork");
    expect(rows.find((r) => r.key === "advisory")?.question).toContain("Estate Lawyer");
    expect(other).toEqual([{ key: "old key", value: "x" }]);
  });
});

describe("GeorgiaDiagnosticView", () => {
  it("shows staff the free text, hub, answers, gauges and the acknowledgment", () => {
    render(<GeorgiaDiagnosticView lead={lead} />);
    expect(screen.getByText(/dad would hate/)).toBeTruthy();
    expect(screen.getByText("Guilt")).toBeTruthy();
    expect(screen.getByText("Feeling stuck")).toBeTruthy();
    expect(screen.getByText(/Only a standard will and basic estate paperwork/)).toBeTruthy();
    expect(screen.getByText(/Tax drag 88/)).toBeTruthy();
    expect(screen.getByText(/Acknowledgment shown to them/)).toBeTruthy();
    expect(screen.getByText(/Staff-only/)).toBeTruthy();
  });
});
