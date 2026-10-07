// Quarterly Governance Audit -- tax/contribution/risk-profile reference
// data, ported directly from the Review Agent prototype's
// config/tax_tables.yaml, config/contribution_rules.yaml, and
// config/risk_profile_ranges.yaml (a working standalone Python CLI at
// /Users/admin/Downloads/Review Agent, not part of this repo).
//
// *** PLACEHOLDER VALUES -- MUST BE VERIFIED/UPDATED BY ROLF BEFORE ANY
// REAL CLIENT USE, AND AGAIN AT THE START OF EACH CALENDAR YEAR. ***
// Bracket thresholds and contribution dollar limits are indexed annually
// by CRA/provincial governments; the figures below are seeded from the
// prototype's last-confirmed structure and are NOT guaranteed current for
// the tax year of any given audit. The prototype's own config files carry
// the identical disclosure -- carried forward unchanged here, not
// softened in translation.

export interface TaxBracket {
  upTo: number | null;
  rate: number;
}

export interface ProvinceTaxTable {
  name: string;
  /** Basic personal amount (a non-refundable credit claimed at the lowest bracket rate). */
  basicPersonalAmount?: number;
  brackets: TaxBracket[];
  combinedTopMarginalRate?: number;
}

export const TAX_TABLES: {
  asOfYear: number;
  capitalGainsInclusionRate: number;
  federal: { brackets: TaxBracket[]; basicPersonalAmount?: number };
  provinces: Record<string, ProvinceTaxTable>;
} = {
  asOfYear: 2024,
  capitalGainsInclusionRate: 0.50,
  federal: {
    basicPersonalAmount: 15705,
    brackets: [
      { upTo: 55867, rate: 0.15 },
      { upTo: 111733, rate: 0.205 },
      { upTo: 173205, rate: 0.26 },
      { upTo: 246752, rate: 0.29 },
      { upTo: null, rate: 0.33 },
    ],
  },
  provinces: {
    AB: {
      name: "Alberta",
      basicPersonalAmount: 21885,
      brackets: [
        { upTo: 148269, rate: 0.10 },
        { upTo: 177922, rate: 0.12 },
        { upTo: 237230, rate: 0.13 },
        { upTo: 355845, rate: 0.14 },
        { upTo: null, rate: 0.15 },
      ],
      combinedTopMarginalRate: 0.48,
    },
    BC: {
      name: "British Columbia",
      basicPersonalAmount: 12580,
      brackets: [
        { upTo: 47937, rate: 0.0506 },
        { upTo: 95875, rate: 0.077 },
        { upTo: 110076, rate: 0.105 },
        { upTo: 133664, rate: 0.1229 },
        { upTo: 181232, rate: 0.147 },
        { upTo: 252752, rate: 0.168 },
        { upTo: null, rate: 0.205 },
      ],
      combinedTopMarginalRate: 0.535,
    },
  },
};

export interface RiskProfileBand {
  profile: string;
  pointsMin: number;
  pointsMax: number;
  midpoint: { incomePct: number; equityPct: number };
  range: { incomePct: [number, number]; equityPct: [number, number] };
}

// Source: iA Financial Group "Your Investor Profile" form F51-122A(23-11).
// `midpoint` is the form's own illustrative split -- the actual target
// point within the range is selected per-client based on the tone/mission
// of that client's ratified Sovereignty Charter (see
// governance-audit-targets.ts); this config only supplies the raw bounds
// to pick within. If a client uses a different custodian's risk-profile
// questionnaire with different point bands, add another top-level key here
// rather than overwriting this one.
export const RISK_PROFILE_RANGES: Record<string, { formId: string; bands: RiskProfileBand[] }> = {
  iaFinancialF51122a: {
    formId: "F51-122A(23-11)",
    bands: [
      { profile: "Prudent", pointsMin: 8, pointsMax: 26, midpoint: { incomePct: 75, equityPct: 25 }, range: { incomePct: [65, 100], equityPct: [0, 35] } },
      { profile: "Moderate", pointsMin: 27, pointsMax: 55, midpoint: { incomePct: 60, equityPct: 40 }, range: { incomePct: [50, 70], equityPct: [30, 50] } },
      { profile: "Balanced", pointsMin: 56, pointsMax: 89, midpoint: { incomePct: 45, equityPct: 55 }, range: { incomePct: [35, 55], equityPct: [45, 65] } },
      { profile: "Growth", pointsMin: 90, pointsMax: 119, midpoint: { incomePct: 30, equityPct: 70 }, range: { incomePct: [20, 40], equityPct: [60, 80] } },
      { profile: "Aggressive", pointsMin: 120, pointsMax: 160, midpoint: { incomePct: 15, equityPct: 85 }, range: { incomePct: [0, 25], equityPct: [75, 100] } },
    ],
  },
};

export const CONTRIBUTION_RULES: {
  tfsa: { eligibilityStartAge: number; annualDollarLimits: Record<number, number> };
  rrsp: { earnedIncomeRate: number; annualDollarLimits: Record<number, number> };
} = {
  tfsa: {
    eligibilityStartAge: 18,
    annualDollarLimits: {
      2009: 5000, 2010: 5000, 2011: 5000, 2012: 5000, 2013: 5500, 2014: 5500,
      2015: 10000, 2016: 5500, 2017: 5500, 2018: 5500, 2019: 6000, 2020: 6000,
      2021: 6000, 2022: 6000, 2023: 6500, 2024: 7000, 2025: 7000,
    },
  },
  rrsp: {
    earnedIncomeRate: 0.18,
    annualDollarLimits: { 2023: 30780, 2024: 31560, 2025: 32490 },
  },
};
