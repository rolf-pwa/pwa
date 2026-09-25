// Turns a client's Georgia diagnostic into advisor-facing context lines for
// the Sovereignty Survey's AI narrative (stabilization-map-generate).
//
// Guardrails, matching how the Causal AI risk flags are handled: the lines
// describe the client's situation in plain words -- they never contain raw
// scores, field names, or the client's own free-text. (The free text stays
// on the lead for staff to read; passing it to a model that writes a
// client-facing document invites verbatim quoting.) The prompt additionally
// forbids quoting any of this back as a score or a direct client statement.

import { governanceDetails, vocabFor } from "./georgia-copy.ts";

export interface GeorgiaLeadFacts {
  catalyst: string;
  answers: Record<string, unknown> | null;
  diagnostic_payload: {
    emotional_state?: string | null;
    relational_state?: string | null;
    timeline_urgency?: string | null;
    primary_friction?: string | null;
  } | null;
  risk_scores_calculated: {
    tax_drag_risk?: number;
    structure_safety?: number;
    noise_strain?: number;
    readiness_score?: number;
  } | null;
}

const FEELING: Record<string, string> = {
  relief: "relief",
  anxiety: "anxiety about getting it right",
  guilt: "guilt",
  grief: "grief",
  loss_of_identity: "a sense of losing who they are",
  euphoria: "excitement",
};
const FRICTION: Record<string, string> = {
  family_pressure: "pressure from the people around them",
  professional_pressure: "being pulled in different directions by professionals",
  internal_paralysis: "feeling stuck",
  operational_overload: "being stretched too thin",
  liquidity_gap: "much of their wealth being tied up on paper",
  no_friction: "no major friction",
};
const RELATIONAL: Record<string, string> = {
  private: "very few people know about it (private)",
  small_circle: "a small circle of family and advisors knows",
  public_knowledge: "it is widely known among friends, colleagues and the community",
};
const TIMELINE: Record<string, string> = {
  pre_liquidity: "the capital has not landed yet (planning ahead)",
  under_30_days: "the capital has landed or lands within 30 days",
  one_to_six_months: "the event was one to six months ago",
  over_six_months: "the event was more than six months ago",
};
const NERVOUS: Record<string, string> = {
  overload: "reports feeling under heavy outside pressure with little decision buffer",
  cautious: "reports feeling cautious and uncertain, with no formal pause in place yet",
  grounded: "reports feeling calm and grounded, with temporary boundaries in place",
};

/** Areas the diagnostic flagged, by the same thresholds the results screen uses. */
export function flaggedAreas(risk: GeorgiaLeadFacts["risk_scores_calculated"]): string[] {
  if (!risk) return [];
  const areas: string[] = [];
  if ((risk.readiness_score ?? 100) <= 40) areas.push("decision readiness");
  if ((risk.structure_safety ?? 100) <= 55) areas.push("governance readiness");
  if ((risk.noise_strain ?? 0) >= 70) areas.push("noise exposure (outside pressure)");
  if ((risk.tax_drag_risk ?? 0) >= 70) areas.push("tax exposure");
  return areas;
}

export function georgiaFactLines(lead: GeorgiaLeadFacts | null | undefined): string[] {
  if (!lead) return [];
  const answers = lead.answers ?? {};
  const hub = lead.diagnostic_payload;
  const parts: string[] = [];

  const feeling = hub?.emotional_state ? FEELING[hub.emotional_state] : null;
  if (feeling) parts.push(`feeling ${feeling}`);
  const friction = hub?.primary_friction ? FRICTION[hub.primary_friction] : null;
  if (friction) parts.push(`the hardest part is ${friction}`);
  const nervous = typeof answers.nervous_system === "string" ? NERVOUS[answers.nervous_system] : null;
  if (nervous) parts.push(`the client ${nervous}`);
  const relational = hub?.relational_state ? RELATIONAL[hub.relational_state] : null;
  if (relational) parts.push(relational);
  const timeline = hub?.timeline_urgency ? TIMELINE[hub.timeline_urgency] : null;
  if (timeline) parts.push(timeline);

  const { details } = governanceDetails(lead.catalyst, answers);
  for (const d of details) parts.push(`${d.label.toLowerCase()}: ${d.value.toLowerCase()} (${d.status === "strong" ? "in place" : d.status})`);

  if (parts.length === 0) return [];
  const lines = [
    `Georgia diagnostic (self-reported by the client before engagement — context only; about ${vocabFor(lead.catalyst).eventPhrase}): ${parts.join("; ")}.`,
  ];
  const flagged = flaggedAreas(lead.risk_scores_calculated);
  if (flagged.length > 0) lines.push(`Areas the diagnostic flagged for attention: ${flagged.join(", ")}.`);
  return lines;
}
