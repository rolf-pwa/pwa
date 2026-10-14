// Client Service Tier metadata (Phase A, staff-only). Mirrors the six-tier
// classification in supabase/functions/_shared/service-tiering.ts exactly --
// keep both in sync if the tier definitions ever change.
// Source: "Legacy Client Service Tier & Review Cadence Matrix" (Google Doc,
// id 1uE1h4OYRVZKRzZD3k4PLh_O1BluWZV3iwTZrFPOk9P0).

export type ServiceTier = "tier_0" | "tier_1" | "tier_2a" | "tier_2b" | "tier_3" | "tier_4";

export const SERVICE_TIER_ORDER: ServiceTier[] = ["tier_0", "tier_1", "tier_2a", "tier_2b", "tier_3", "tier_4"];

export const SERVICE_TIER_LABEL: Record<ServiceTier, string> = {
  tier_0: "Tier 0 · Insurance Only",
  tier_1: "Tier 1 · Foundational",
  tier_2a: "Tier 2A · Traditional Legacy",
  tier_2b: "Tier 2B · Chartered Legacy",
  tier_3: "Tier 3 · Virtual Family Office",
  tier_4: "Tier 4 · Sovereign Enterprise",
};

export const SERVICE_TIER_BAND: Record<ServiceTier, string> = {
  tier_0: "Nil AUM, risk products only",
  tier_1: "Under $250,000 CAD",
  tier_2a: "$250,000–$750,000 CAD, no Charter",
  tier_2b: "$250,000–$750,000 CAD, active Charter",
  tier_3: "$750,000–$2,000,000 CAD",
  tier_4: "$2,000,000+ CAD",
};

export const SERVICE_TIER_CADENCE: Record<ServiceTier, string> = {
  tier_0: "No scheduled review — $249 CAD ad-hoc",
  tier_1: "1 Portfolio Review (Q1) and a Q3 rebalancing — $249 CAD ad-hoc",
  tier_2a: "2 Portfolio Reviews (Q2, Q4)",
  tier_2b: "Portfolio Review (Q2) and Sovereignty Review (Q4)",
  tier_3: "Sovereignty Reviews (Q1–Q3) and a Governance Review (Q4)",
  tier_4: "Sovereignty Reviews (Q1–Q3) and a Governance Review (Q4)",
};
