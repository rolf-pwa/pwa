// causal-dag-evaluator.ts — the deterministic "Causal Logic Backend" from
// the ProsperWise Causal AI Platform blueprint (architectural-blueprint-
// document.md §1.2, §4, §5.3). Pure functions only: no LLM calls, no I/O,
// no database access — mirrors _shared/sovereignty-diagnostics.ts's and
// _shared/governance-audit-drift.ts's own "computed in code, never by the
// AI" discipline exactly. Field shapes here are the single source of truth
// for what lives inside household_ontology_assessments' JSONB columns —
// keep the migration's own comment in sync if these change.
//
// Rules are a small registry (not hardcoded if/else) so adding a 4th rule
// later is a one-entry change, not a new branch buried in a growing
// function. Every rule only fires once ALL of its required inputs are
// present — missing data means "not enough information," never a false
// negative dressed up as a clean pass.

// ---- Hub (blueprint §4.1) ---------------------------------------------

export interface HubFinancialState {
  liquid_capital_cad?: number;
  illiquid_capital_cad?: number;
  monthly_burn_rate_cad?: number;
  /** 1-10 */
  financial_literacy_score?: number;
  tax_liability_identified?: boolean;
  existing_fiduciary_team?: boolean;
}

export type PressureIndex = "Low" | "Moderate" | "High" | "Critical";

export interface HubRelationalState {
  /** 1-10 */
  spousal_alignment_score?: number;
  begging_hand_pressure_index?: PressureIndex;
  /** 1-10 */
  secrecy_isolation_score?: number;
  dependents_count?: number;
}

export interface HubEmotionalState {
  ticker_shock_vulnerability?: "Low" | "Moderate" | "High";
  decision_behavior_type?: "Paralysis" | "Balanced" | "Impulsive";
  /** 1-10 */
  guilt_survivor_index?: number;
  /** 1-10 */
  imposter_syndrome_score?: number;
  psychological_stage_goldbart?: "Honeymoon" | "Wealth_Acceptance" | "Identity_Consolidation" | "Stewardship";
  transition_phase_bradley?: "Anticipation" | "Ending" | "Passage" | "New_Normal";
}

// ---- Spokes (blueprint §4.2) -------------------------------------------

export type EventSpokeType = "inheritance" | "business_exit" | "executive_retirement" | "pre_exit_growth";

export interface InheritanceSpoke {
  bereavement_stage?: "Acute_Grief" | "Early_Processing" | "Acceptance" | "Complicated_Grief";
  /** 1-10 */
  blood_money_custodianship_score?: number;
  /** 1-10 */
  sibling_equity_friction_score?: number;
  executor_role_conflict?: boolean;
  legacy_asset_concentration_pct?: number;
  bc_probate_exposure?: boolean;
}

export interface BusinessExitSpoke {
  /** 1-10 */
  identity_detachment_score?: number;
  /** 1-10 */
  daily_purpose_void_score?: number;
  /** Blueprint's own example only names "Pure_Builder" — kept as free text
   *  (staff-entered) rather than guessing at an unstated full enum. */
  builder_vs_steward_mindset?: string;
  /** 1-10 */
  need_for_control_score?: number;
  angel_investment_urgency_index?: PressureIndex;
  earn_out_obligations?: boolean;
}

export interface ExecutiveRetirementSpoke {
  /** 1-10 */
  company_stock_loyalty_score?: number;
  equity_concentration_pct?: number;
  /** 1-10 */
  corporate_status_deprivation_score?: number;
  tax_acceleration_vulnerability_index?: PressureIndex;
  /** 1-10 */
  expense_account_decoupling_index?: number;
}

export interface PreExitGrowthSpoke {
  paper_vs_liquid_ratio?: number;
  /** Blueprint's own example only names "Term_Sheet_Signed" — free text. */
  anticipation_phase_stage?: string;
  premature_commitment_index?: PressureIndex;
  transaction_probability?: number;
  qsbs_or_estate_staging_completed?: boolean;
}

export type EventSpokeData = InheritanceSpoke | BusinessExitSpoke | ExecutiveRetirementSpoke | PreExitGrowthSpoke;

export interface OntologyAssessmentPayload {
  financial_state?: HubFinancialState | null;
  relational_state?: HubRelationalState | null;
  emotional_state?: HubEmotionalState | null;
  event_spoke_type?: EventSpokeType | null;
  event_spoke_data?: EventSpokeData | null;
}

// ---- Causal DAG rules (blueprint §5.3) ----------------------------------

export interface RiskFlag {
  rule_id: string;
  risk_name: string;
  severity: "Low" | "Moderate" | "High" | "Critical";
  action: string;
}

interface DagRule {
  id: string;
  /** One-line description of what the rule checks, for a future staff UI. */
  description: string;
  evaluate(payload: OntologyAssessmentPayload): RiskFlag | null;
}

const RULES: DagRule[] = [
  {
    id: "inheritance_asset_freeze",
    description: "Inheritance: high guilt/survivor feelings + high custodianship burden.",
    evaluate(payload) {
      if (payload.event_spoke_type !== "inheritance") return null;
      const spoke = payload.event_spoke_data as InheritanceSpoke | null | undefined;
      const guilt = payload.emotional_state?.guilt_survivor_index;
      const custodianship = spoke?.blood_money_custodianship_score;
      if (guilt == null || custodianship == null) return null;
      if (guilt >= 7 && custodianship >= 8) {
        return {
          rule_id: "inheritance_asset_freeze",
          risk_name: "Legacy Asset Liquidation Paralysis",
          severity: "High",
          action: "Enforce 6-Month Decision Free Zone in Holding Tank.",
        };
      }
      return null;
    },
  },
  {
    id: "business_exit_angel_depletion",
    description: "Business Exit: low identity detachment + a Pure Builder mindset.",
    evaluate(payload) {
      if (payload.event_spoke_type !== "business_exit") return null;
      const spoke = payload.event_spoke_data as BusinessExitSpoke | null | undefined;
      const detachment = spoke?.identity_detachment_score;
      const mindset = spoke?.builder_vs_steward_mindset;
      if (detachment == null || !mindset) return null;
      if (detachment <= 4 && mindset === "Pure_Builder") {
        return {
          rule_id: "business_exit_angel_depletion",
          risk_name: "Reckless Private Equity Capital Depletion",
          severity: "Critical",
          action: "Enforce 5% Liquid Capital Cap on Angel Investments during Stabilization Period.",
        };
      }
      return null;
    },
  },
  {
    id: "executive_tax_acceleration",
    description: "Executive Retirement: critical tax-acceleration exposure + no tax liability identified yet.",
    evaluate(payload) {
      if (payload.event_spoke_type !== "executive_retirement") return null;
      const spoke = payload.event_spoke_data as ExecutiveRetirementSpoke | null | undefined;
      const vulnerability = spoke?.tax_acceleration_vulnerability_index;
      const taxIdentified = payload.financial_state?.tax_liability_identified;
      if (!vulnerability || taxIdentified == null) return null;
      if (vulnerability === "Critical" && taxIdentified === false) {
        return {
          rule_id: "executive_tax_acceleration",
          risk_name: "Single-Year Tax Spike Depletion",
          severity: "Critical",
          action: "Lock equity exercise until CPA Tax Staging is completed.",
        };
      }
      return null;
    },
  },
];

export function evaluateCausalDag(payload: OntologyAssessmentPayload): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const rule of RULES) {
    const flag = rule.evaluate(payload);
    if (flag) flags.push(flag);
  }
  return flags;
}
