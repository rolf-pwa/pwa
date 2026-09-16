// Client Service Tier metadata (Phase A, staff-only). Mirrors the six-tier
// classification in supabase/functions/_shared/service-tiering.ts exactly --
// keep both in sync if the tier definitions ever change.
// Source: "Legacy Client Service Tier & Review Cadence Matrix" (Google Doc,
// id 1uE1h4OYRVZKRzZD3k4PLh_O1BluWZV3iwTZrFPOk9P0).

export type ServiceTier = "tier_0" | "tier_1" | "tier_2a" | "tier_2b" | "tier_3" | "tier_4";

export const SERVICE_TIER_ORDER: ServiceTier[] = ["tier_0", "tier_1", "tier_2b", "tier_2a", "tier_3", "tier_4"];

export const SERVICE_TIER_LABEL: Record<ServiceTier, string> = {
  tier_0: "Tier 0 · Insurance Only",
  tier_1: "Tier 1 · Foundational",
  tier_2a: "Tier 2A · Chartered Legacy",
  tier_2b: "Tier 2B · Traditional Legacy",
  tier_3: "Tier 3 · Virtual Family Office",
  tier_4: "Tier 4 · Sovereign Enterprise",
};

export const SERVICE_TIER_BAND: Record<ServiceTier, string> = {
  tier_0: "Nil AUM, risk products only",
  tier_1: "Under $250,000 CAD",
  tier_2a: "$250,000–$750,000 CAD, active Charter",
  tier_2b: "$250,000–$750,000 CAD, no Charter",
  tier_3: "$750,000–$2,000,000 CAD",
  tier_4: "$2,000,000+ CAD",
};

export const SERVICE_TIER_CADENCE: Record<ServiceTier, string> = {
  tier_0: "No scheduled review — $249 CAD ad-hoc",
  tier_1: "1 annual review — $249 CAD ad-hoc",
  tier_2a: "2 semi-annual reviews (Governance + Planning)",
  tier_2b: "2 semi-annual reviews (Allocation + Review)",
  tier_3: "Semi-annual or 3 seasonal sessions",
  tier_4: "4 Quarterly Strategic Audit Meetings",
};
