// causal-model-v2.ts — the V2 causal graph over the Hub-and-Spoke ontology,
// built on causal-dag-engine.ts. It runs ALONGSIDE the existing rule registry
// in causal-dag-evaluator.ts (which is untouched and still drives V1
// behaviour); only households with v2_ai_engine_enabled use this.
//
// PROVISIONAL: the structure follows the blueprint's own examples (guilt ->
// difficulty saying no -> liquidity depletion; identity detachment ->
// founder-identity risk), but the weights below are first-draft judgement,
// NOT calibrated against outcomes. They need advisor review before any score
// is shown to a client as more than a relative indicator. Every weight lives
// in this one file on purpose, so tuning never touches engine code.

import {
  clamp01, weighted, type CausalModel, type NodeValue,
} from "./causal-dag-engine.ts";
import type { OntologyAssessmentPayload, PressureIndex } from "./causal-dag-evaluator.ts";

const PRESSURE: Record<PressureIndex, number> = { Low: 0.1, Moderate: 0.4, High: 0.7, Critical: 1 };
const pct = (v: number) => `${Math.round(v * 100)}`;

/** Months of runway at which liquidity stress is considered fully relieved. */
const RUNWAY_SAFE_MONTHS = 60;

export const CAUSAL_MODEL_V2: CausalModel = {
  nodes: [
    // ---- evidence (roots) ----
    { id: "guilt", label: "Survivor guilt", parents: [], equation: () => undefined, explain: () => "" },
    { id: "family_pressure", label: "Family request pressure", parents: [], equation: () => undefined, explain: () => "" },
    { id: "spousal_misalignment", label: "Spousal misalignment", parents: [], equation: () => undefined, explain: () => "" },
    { id: "runway_stress", label: "Runway stress", parents: [], equation: () => undefined, explain: () => "" },
    { id: "identity_attachment", label: "Identity attachment to the business", parents: [], equation: () => undefined, explain: () => "" },
    { id: "control_need", label: "Need for control", parents: [], equation: () => undefined, explain: () => "" },
    { id: "purpose_void", label: "Daily purpose void", parents: [], equation: () => undefined, explain: () => "" },
    // Intervention lever: 0 = no freeze, 1 = full 90-day capital freeze.
    { id: "capital_freeze", label: "90-day capital freeze", parents: [], equation: () => undefined, explain: () => "" },

    // ---- derived ----
    {
      id: "say_no_difficulty", label: "Difficulty saying no to family",
      parents: ["guilt", "family_pressure"],
      equation: (p) => weighted(p, [["guilt", 0.6], ["family_pressure", 0.4]], 1),
      explain: (v, p) => `Guilt (${pct(p.guilt!)}) and family pressure (${pct(p.family_pressure!)}) combine, weighted 60/40, to ${pct(v)}.`,
    },
    {
      id: "discretionary_outflow", label: "Discretionary capital outflow",
      parents: ["say_no_difficulty", "capital_freeze"],
      // A freeze blocks outflows regardless of how hard it is to say no.
      equation: (p) => (p.say_no_difficulty === undefined ? undefined : p.say_no_difficulty * (1 - (p.capital_freeze ?? 0))),
      explain: (v, p) => `Difficulty saying no (${pct(p.say_no_difficulty!)}) drives outflow, reduced by the capital freeze (${pct(p.capital_freeze ?? 0)}) to ${pct(v)}.`,
    },

    // ---- risks (outputs) ----
    {
      id: "liquidity_depletion_risk", label: "Liquidity Depletion Risk", isRisk: true,
      parents: ["discretionary_outflow", "runway_stress", "spousal_misalignment"],
      equation: (p) => weighted(p, [["discretionary_outflow", 0.5], ["runway_stress", 0.3], ["spousal_misalignment", 0.2]]),
      explain: (v, p) => {
        const parts = [
          p.discretionary_outflow !== undefined ? `outflow ${pct(p.discretionary_outflow)}` : null,
          p.runway_stress !== undefined ? `runway stress ${pct(p.runway_stress)}` : null,
          p.spousal_misalignment !== undefined ? `spousal misalignment ${pct(p.spousal_misalignment)}` : null,
        ].filter(Boolean).join(", ");
        return `Weighted blend (50/30/20) of ${parts} gives ${pct(v)}.`;
      },
    },
    {
      id: "founder_identity_risk", label: "Founder Identity Detachment Risk", isRisk: true,
      parents: ["identity_attachment", "control_need", "purpose_void"],
      equation: (p) => weighted(p, [["identity_attachment", 0.5], ["control_need", 0.25], ["purpose_void", 0.25]]),
      explain: (v, p) => `Identity attachment (${p.identity_attachment === undefined ? "n/a" : pct(p.identity_attachment)}), need for control and purpose void blend (50/25/25) to ${pct(v)}.`,
    },
  ],
};

/** Map the stored ontology payload onto the model's evidence nodes (missing stays undefined). */
export function evidenceFromOntology(payload: OntologyAssessmentPayload): Record<string, NodeValue> {
  const f = payload.financial_state ?? {};
  const r = payload.relational_state ?? {};
  const e = payload.emotional_state ?? {};
  const spoke = (payload.event_spoke_type === "business_exit" ? payload.event_spoke_data : null) as
    | { identity_detachment_score?: number; need_for_control_score?: number; daily_purpose_void_score?: number }
    | null;
  const score10 = (v: number | undefined) => (v === undefined || v === null ? undefined : clamp01(v / 10));
  const runway =
    f.liquid_capital_cad !== undefined && f.monthly_burn_rate_cad !== undefined && f.monthly_burn_rate_cad > 0
      ? clamp01(1 - f.liquid_capital_cad / f.monthly_burn_rate_cad / RUNWAY_SAFE_MONTHS)
      : undefined;
  const align = score10(r.spousal_alignment_score);
  return {
    guilt: score10(e.guilt_survivor_index),
    family_pressure: r.begging_hand_pressure_index ? PRESSURE[r.begging_hand_pressure_index] : undefined,
    spousal_misalignment: align === undefined ? undefined : 1 - align,
    runway_stress: runway,
    identity_attachment: spoke?.identity_detachment_score === undefined ? undefined : 1 - clamp01(spoke.identity_detachment_score / 10),
    control_need: score10(spoke?.need_for_control_score),
    purpose_void: score10(spoke?.daily_purpose_void_score),
    capital_freeze: 0,
  };
}

export const V2_INTERVENTIONS = [
  { id: "capital_freeze_90d", label: "Apply a 90-day capital freeze", do: { capital_freeze: 1 } },
];
