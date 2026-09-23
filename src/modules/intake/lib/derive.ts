// Georgia 2.0 — pure derivation logic (unit-testable)
// Copy & routing per "Georgia Interactive Questionnaire Scripts & Micro-Copy" spec.

export type Domain = "corporate" | "personal";

export type CorporateCatalyst = "founder_exit" | "growth_stage_founder";
export type PersonalCatalyst =
  | "inheritance"
  | "executive_exit"
  | "divorce_restructuring"
  | "insurance_settlement"
  | "sudden_windfall";
export type Catalyst = CorporateCatalyst | PersonalCatalyst;

export type RiskKey = "tax" | "structure" | "noise" | "readiness";

export type OptionId = string;
export type Answers = Record<string, OptionId>;
// Legacy alias for state typing
export type Answer = OptionId | null;

export const VELVET_ROPE = 1_000_000;
export const SCALE_MIN = 100_000;
export const SCALE_MAX = 10_000_000;
export const SCALE_STEP = 100_000;

export const CATALYST_LABELS: Record<Catalyst, string> = {
  founder_exit: "Business Exit Planning",
  growth_stage_founder: "Growth-Stage Founder Planning",
  inheritance: "Inheritance Planning",
  executive_exit: "Executive Retirement Planning",
  divorce_restructuring: "Divorce Financial Planning",
  insurance_settlement: "Sudden Wealth Planning",
  sudden_windfall: "Sudden Wealth Planning",
};

export const CATALYST_DESCRIPTIONS: Record<Catalyst, string> = {
  founder_exit: "M&A, liquidation, or third-party transitions.",
  growth_stage_founder: "Restructure, venture influx, or long-horizon exit prep.",
  inheritance: "Legacy transfers, estate & trust windfalls.",
  executive_exit: "Vesting options, severance, retiring allowance.",
  divorce_restructuring: "Matrimonial division, asset splitting.",
  insurance_settlement: "Insurance or legal settlement payouts.",
  sudden_windfall:
    "Lottery, insurance or legal settlement, real estate, equity/bonus, crypto, or gift.",
};

/** Public Academy article for each catalyst (opened in a new tab). */
export const CATALYST_ACADEMY: Record<Catalyst, { title: string; url: string }> = {
  founder_exit: {
    title: "The Liquidity Event",
    url: "https://www.prosperwise.ca/academy/liquidity-event",
  },
  growth_stage_founder: {
    title: "The Velocity Surge",
    url: "https://www.prosperwise.ca/academy/velocity-surge",
  },
  inheritance: {
    title: "Navigating the Inheritance",
    url: "https://www.prosperwise.ca/academy/navigating-the-inheritance",
  },
  executive_exit: {
    title: "The Transition Cliff",
    url: "https://www.prosperwise.ca/academy/transition-cliff",
  },
  divorce_restructuring: {
    title: "The Settlement Gap",
    url: "https://www.prosperwise.ca/academy/settlement-gap",
  },
  insurance_settlement: {
    title: "Sudden Wealth Syndrome",
    url: "https://www.prosperwise.ca/academy/sudden-wealth-syndrome",
  },
  sudden_windfall: {
    title: "Sudden Wealth Syndrome",
    url: "https://www.prosperwise.ca/academy/sudden-wealth-syndrome",
  },
};

export const CORPORATE_CATALYSTS: CorporateCatalyst[] = [
  "founder_exit",
  "growth_stage_founder",
];
// Matches the site's four personal service pages exactly.
export const PERSONAL_CATALYSTS: PersonalCatalyst[] = [
  "inheritance",
  "divorce_restructuring",
  "executive_exit",
  "sudden_windfall",
];


export const DOMAIN_GREETING: Record<Domain, string> = {
  corporate:
    "Building a company takes intense focus. Stepping out of that momentum — or preparing to — can feel like stepping off a fast-moving train. Let's look at the structure of your transition so we can protect what you have built.",
  personal:
    "Sudden personal wealth — whether from loss, transition, or luck — carries a quiet weight. Before we look at any numbers, remember: you do not need to make any irreversible decisions today. This is a safe space to map out your sequence.",
};

// ---- Question schema -------------------------------------------------------

export interface QOption {
  id: OptionId;
  label: string;
  risks: Partial<Record<RiskKey, 1 | 2 | 3>>;
}

export interface Question {
  key: string;
  text: string;
  tooltip: string;
  options: QOption[];
}

export const CATALYST_QUESTIONS: Record<Catalyst, Question[]> = {
  founder_exit: [
    {
      key: "jurisdiction",
      text: "Where is your operating company legally registered and active?",
      tooltip:
        "Tax optimization sequences depend heavily on provincial jurisdiction. BC has unique rules regarding corporate capital distributions.",
      options: [
        { id: "bc", label: "British Columbia", risks: { tax: 1 } },
        { id: "other_ca", label: "Other Canadian Province", risks: { tax: 2 } },
        { id: "cross_border", label: "Cross-Border / Multi-Jurisdictional", risks: { tax: 3 } },
      ],
    },
    {
      key: "lcge",
      text: "Have you or your co-founders utilized your Lifetime Capital Gains Exemption (LCGE) yet?",
      tooltip:
        "For BC founders, the LCGE represents over $1M of completely tax-sheltered capital per shareholder if structured correctly before the sale.",
      options: [
        { id: "intact", label: "No — it is fully intact", risks: { tax: 1 } },
        { id: "used", label: "Yes — it has been used", risks: { tax: 1 } },
        { id: "unsure", label: "Unsure / not structured yet", risks: { tax: 3, readiness: 2 } },
      ],
    },
    {
      key: "holdco",
      text: "Are the proceeds of your active business held within, or passing through, a HoldCo?",
      tooltip:
        "Without a HoldCo, direct capital liquidation triggers immediate personal tax at the highest marginal rate.",
      options: [
        { id: "yes", label: "Yes — we have a HoldCo structure", risks: { structure: 1 } },
        { id: "no", label: "No — paid directly to me", risks: { structure: 3, tax: 2 } },
        { id: "unsure", label: "Unsure of the flow", risks: { structure: 2, readiness: 2 } },
      ],
    },
  ],
  growth_stage_founder: [
    {
      key: "purification",
      text: "Are you currently using your active business accounts to hold passive investments or excess cash?",
      tooltip:
        "To qualify for a tax-free sale later, your business must be 'purified' — at least 90% of assets actively used in the business.",
      options: [
        { id: "yes", label: "Yes — most cash sits in the OpCo", risks: { structure: 3, tax: 2 } },
        { id: "no", label: "No — we run a purified structure", risks: { structure: 1 } },
        { id: "unsure", label: "Unsure / basic corporate account", risks: { structure: 2, readiness: 2 } },
      ],
    },
    {
      key: "shareholder_agreement",
      text: "Do you have a current, signed Shareholder Agreement addressing sudden exits or forced transition events?",
      tooltip:
        "In growth phases, the lack of an updated agreement is the single biggest cause of paralyzing shareholder deadlocks.",
      options: [
        { id: "yes", label: "Yes — up to date", risks: { readiness: 1 } },
        { id: "no", label: "No — or severely outdated", risks: { readiness: 3, structure: 2 } },
        { id: "unsure", label: "Unsure", risks: { readiness: 2 } },
      ],
    },
  ],
  inheritance: [
    {
      key: "capital_location",
      text: "Where is the inherited capital currently sitting?",
      tooltip:
        "Capital sitting in an estate account is often subject to BC Probate delays and administrative drag before it can be safely integrated.",
      options: [
        { id: "estate", label: "Held in the deceased's estate account", risks: { structure: 2 } },
        { id: "personal", label: "Already transferred to my personal accounts", risks: { structure: 3 } },
        { id: "trust", label: "Held in an active trust structure", risks: { structure: 1 } },
      ],
    },
    {
      key: "probate",
      text: "Is the transfer subject to British Columbia's flat 1.4% Probate fees?",
      tooltip:
        "BC Probate is a flat 1.4% tax drag on all assets over $50k passing through a will. It is entirely legal to structure around this.",
      options: [
        { id: "yes", label: "Yes — currently going through probate", risks: { tax: 3 } },
        { id: "no", label: "No — structured to bypass it", risks: { tax: 1 } },
        { id: "unsure", label: "Unsure", risks: { tax: 2, readiness: 2 } },
      ],
    },
    {
      key: "noise",
      text: "Are family expectations or unsolicited opinions adding pressure to how you manage this money?",
      tooltip:
        "We call this Noise Exposure. Emotional and familial expectations often force sudden inheritors into fast, regretful investment commitments.",
      options: [
        { id: "yes", label: "Yes — meaningful pressure or conflict", risks: { noise: 3 } },
        { id: "moderate", label: "Moderate — everyone is watching closely", risks: { noise: 2 } },
        { id: "no", label: "No — I am navigating this privately", risks: { noise: 1 } },
      ],
    },
  ],
  executive_exit: [
    {
      key: "comp_structure",
      text: "What is the primary structure of your transition compensation?",
      tooltip:
        "Vesting schedules and concentrated corporate stock carry massive market downside risks if not systematically hedged or liquidated.",
      options: [
        { id: "lump", label: "Lump-sum severance payout", risks: { structure: 2 } },
        { id: "stock", label: "Vesting options / concentrated stock", risks: { structure: 3 } },
        { id: "retiring", label: "Retiring allowance / deferred payouts", risks: { structure: 1 } },
      ],
    },
    {
      key: "tax_deferral",
      text: "Do you have a plan to roll your retirement allowance or severance into tax-deferred structures?",
      tooltip:
        "In BC, failure to use specialized rollover provisions for retiring allowances can cost up to 53.5% of your payout to immediate taxation.",
      options: [
        { id: "no", label: "No — I expect a massive tax bill this year", risks: { tax: 3 } },
        { id: "yes", label: "Yes — my accounts are optimized", risks: { tax: 1 } },
        { id: "unsure", label: "Unsure of my contribution limits", risks: { tax: 2, readiness: 2 } },
      ],
    },
  ],
  divorce_restructuring: [
    {
      key: "integration_status",
      text: "Are the assets currently divided, or are you in active negotiations?",
      tooltip:
        "Dividing complex portfolios or business shares under the BC Family Law Act requires deep structural forensic valuation before signing.",
      options: [
        { id: "active", label: "Active legal negotiations / contested", risks: { noise: 3, readiness: 3 } },
        { id: "signed", label: "Separation agreement is signed & complete", risks: { readiness: 1 } },
        { id: "beginning", label: "Just beginning the separation process", risks: { readiness: 2, noise: 2 } },
      ],
    },
    {
      key: "splitting_method",
      text: "How will the capital transition to you?",
      tooltip:
        "Cash is simple. Splitting investment assets or private corporate shares carries hidden capital gains liabilities that can devastate net value.",
      options: [
        { id: "cash", label: "Lump-sum cash settlement", risks: { tax: 1 } },
        { id: "portfolios", label: "Investment portfolios & real estate", risks: { tax: 2 } },
        { id: "shares", label: "Corporate shares / HoldCo equity", risks: { tax: 3, structure: 2 } },
      ],
    },
  ],
  // Legacy key retained for historical session data; folded into sudden_windfall.
  insurance_settlement: [
    {
      key: "allocation",
      text: "How is your settlement capital structured to support your long-term needs?",
      tooltip:
        "Lump sums carry extreme long-term management pressure. If you deplete the capital early, you cannot renegotiate the settlement.",
      options: [
        { id: "lump", label: "All cash paid as a single lump sum", risks: { structure: 3 } },
        { id: "annuity", label: "Structured annuity (scheduled payouts)", risks: { structure: 1 } },
        { id: "unsure", label: "Unsure of the final payout structure", risks: { structure: 2, readiness: 2 } },
      ],
    },
  ],
  sudden_windfall: [
    {
      key: "windfall_type",
      text: "What kind of windfall are we working with?",
      tooltip:
        "Each windfall type carries a different tax and structural sequence — a settlement behaves nothing like a crypto gain or an equity payout.",
      options: [
        { id: "settlement", label: "Insurance or legal settlement", risks: { structure: 2 } },
        { id: "lottery", label: "Lottery or prize", risks: { structure: 2, noise: 3 } },
        { id: "real_estate", label: "Real estate sale", risks: { tax: 2 } },
        { id: "equity", label: "Equity, bonus, or stock payout", risks: { tax: 3 } },
        { id: "crypto", label: "Crypto or digital assets", risks: { tax: 3, structure: 2 } },
        { id: "gift", label: "Gift from family", risks: { noise: 2 } },
      ],
    },
    {
      key: "safe_harbor",
      text: "Where does this windfall capital currently reside?",
      tooltip:
        "We recommend establishing a 'Quiet Period.' Keeping new wealth in your primary chequing account creates subconscious pressure to make rapid decisions.",
      options: [
        { id: "chequing", label: "My standard, everyday chequing account", risks: { structure: 3, noise: 2 } },
        { id: "separate", label: "Separate holding or high-interest account", risks: { structure: 1 } },
        { id: "wallets", label: "Still held in digital wallets / brokerages", risks: { structure: 2 } },
      ],
    },
  ],
};

// ---- Routing ---------------------------------------------------------------

/**
 * The only commitment this tool drives to is the Sovereignty Survey.
 * The Sovereignty Operating System™ Build is a later-stage commitment and is
 * intentionally out of scope here.
 */
export type Pathway =
  | "survey"
  | "academy_guide"
  // Lower-commitment path (Causal AI Platform Phase 0 / "Ask Georgia"):
  // email-gated roadmap delivery, no purchase or call required.
  | "confidential_roadmap"
  // Legacy values retained so historical lead rows still type-check.
  | "vfo_stabilization"
  | "vfo_catalyst_guide"
  | "standalone_build"
  | "academy_pass";

export const SURVEY_PRICE: Record<Domain, number> = {
  personal: 750,
  corporate: 1_500,
};

export interface DerivedResult {
  surveyPrice: number;
  domainLabel: string;
  headline: string;
}

export function deriveResult(domain: Domain, _scale?: number): DerivedResult {
  const surveyPrice = SURVEY_PRICE[domain];
  return {
    surveyPrice,
    domainLabel: domain === "corporate" ? "corporate" : "personal",
    headline: `The Sovereignty Survey is your next step — ${formatCAD(surveyPrice)} for ${
      domain === "corporate" ? "corporate" : "personal"
    } situations.`,
  };
}


// ---- Risk gauges (0–100) ---------------------------------------------------

/** True once at least one diagnostic question has a real answer. */
export function hasDiagnosticInput(catalyst: Catalyst | null, answers: Answers): boolean {
  if (!catalyst) return false;
  return CATALYST_QUESTIONS[catalyst].some((q) => Boolean(answers[q.key]));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}


export interface Gauges {
  taxDragRisk: number;
  structureSafety: number;
  noiseStrain: number;
  readiness: number;
}

interface RiskTotals {
  tax: { sum: number; count: number };
  structure: { sum: number; count: number };
  noise: { sum: number; count: number };
  readiness: { sum: number; count: number };
}

function accumulateRisks(
  catalyst: Catalyst | null,
  answers: Answers
): RiskTotals {
  const totals: RiskTotals = {
    tax: { sum: 0, count: 0 },
    structure: { sum: 0, count: 0 },
    noise: { sum: 0, count: 0 },
    readiness: { sum: 0, count: 0 },
  };
  if (!catalyst) return totals;
  const qs = CATALYST_QUESTIONS[catalyst];
  for (const q of qs) {
    const chosen = answers[q.key];
    if (!chosen) continue;
    const opt = q.options.find((o) => o.id === chosen);
    if (!opt) continue;
    for (const [k, v] of Object.entries(opt.risks) as [RiskKey, 1 | 2 | 3][]) {
      totals[k].sum += v;
      totals[k].count += 1;
    }
  }
  return totals;
}

function avg(t: { sum: number; count: number }, fallback: number): number {
  return t.count === 0 ? fallback : t.sum / t.count;
}

export function computeGauges(
  domain: Domain | null,
  catalyst: Catalyst | null,
  answers: Answers,
  scale: number
): Gauges {
  const t = accumulateRisks(catalyst, answers);

  // Map 1..3 -> percentage. 1 = 20, 2 = 55, 3 = 90.
  const toRisk = (v: number) => 20 + (v - 1) * 35;
  const toSafety = (v: number) => 90 - (v - 1) * 35;

  const tax = toRisk(avg(t.tax, 1.5));
  const noise = toRisk(avg(t.noise, catalyst ? 1.5 : 1));
  const structure = toSafety(avg(t.structure, 2));
  let readiness = toSafety(avg(t.readiness, 2));

  // Scale nudges readiness upward once serious capital is on the table.
  if (scale >= VELVET_ROPE) readiness += 5;
  if (scale >= 5_000_000) readiness += 5;
  if (domain && catalyst) readiness += 5;

  return {
    taxDragRisk: clamp(tax),
    structureSafety: clamp(structure),
    noiseStrain: clamp(noise),
    readiness: clamp(readiness),
  };
}

// ---- Timeline milestones ---------------------------------------------------

export interface Milestone {
  label: string;
  detail: string;
}

export const CATALYST_TIMELINES: Record<Catalyst, Milestone[]> = {
  founder_exit: [
    { label: "LOI", detail: "Letter of intent signed" },
    { label: "Diligence", detail: "Financial & legal review" },
    { label: "Close", detail: "Transaction executes" },
    { label: "Stabilize", detail: "90-day sovereignty setup" },
  ],
  growth_stage_founder: [
    { label: "Assess", detail: "Corporate structure review" },
    { label: "Purify", detail: "Optimize HoldCo & shares" },
    { label: "Align", detail: "Shareholder agreements" },
    { label: "Govern", detail: "Ongoing oversight" },
  ],
  inheritance: [
    { label: "Notice", detail: "Estate initiates" },
    { label: "Probate", detail: "Court validation" },
    { label: "Transfer", detail: "Assets distributed" },
    { label: "Steward", detail: "Long-term stewardship" },
  ],
  executive_exit: [
    { label: "Vest", detail: "Options & equity crystallize" },
    { label: "Sever", detail: "Package finalized" },
    { label: "Deploy", detail: "Tax-aware allocation" },
    { label: "Stabilize", detail: "New income architecture" },
  ],
  divorce_restructuring: [
    { label: "File", detail: "Separation initiated" },
    { label: "Divide", detail: "Asset & debt split" },
    { label: "Rebuild", detail: "New financial foundation" },
    { label: "Protect", detail: "Fresh estate plan" },
  ],
  insurance_settlement: [
    { label: "Claim", detail: "Payout approved" },
    { label: "Receive", detail: "Funds land" },
    { label: "Shelter", detail: "Tax & structure protection" },
    { label: "Deploy", detail: "Long-term plan" },
  ],
  sudden_windfall: [
    { label: "Land", detail: "Capital arrives" },
    { label: "Pause", detail: "90-day Quiet Period" },
    { label: "Design", detail: "Sovereignty blueprint" },
    { label: "Deploy", detail: "Structured deployment" },
  ],
};

/**
 * Derive which timeline milestone the visitor currently sits at (0-based),
 * based on their diagnostic responses. Each answered question advances them
 * one stage along the catalyst's process, capped at the final milestone.
 * With no answers yet, they are at the very start (stage 0).
 */
export function timelineStageIndex(
  catalyst: Catalyst | null,
  answers: Answers,
  milestoneCount: number
): number {
  if (!catalyst || milestoneCount <= 0) return 0;
  const answered = CATALYST_QUESTIONS[catalyst].filter((q) => Boolean(answers[q.key])).length;
  return Math.max(0, Math.min(answered, milestoneCount - 1));
}


// ---- Georgia Insights (dynamic quotes) ------------------------------------

export interface GeorgiaInsight {
  tag: string;
  body: string;
}

export function georgiaInsights(
  domain: Domain | null,
  catalyst: Catalyst | null,
  answers: Answers,
  scale: number
): GeorgiaInsight[] {
  const insights: GeorgiaInsight[] = [];
  const gauges = computeGauges(domain, catalyst, answers, scale);

  if (domain && hasDiagnosticInput(catalyst, answers)) {
    insights.push({
      tag: "Your Next Step",
      body:
        "The Sovereignty Survey is a 90-minute working session built around exactly what you've told me — you leave with a Stabilization Map, an Immediate Risk Scan, and a 30-Day Action Framework. No pitch, no commitment beyond the session itself.",
    });
  }


  if (gauges.noiseStrain >= 70) {
    insights.push({
      tag: "Noise Exposure",
      body:
        "With many eyes on this transition, the noise level around you is incredibly high. You have a legal and emotional right to step back. The single best decision right now is to declare a Quiet Period while we sort the sequence.",
    });
  }

  if (gauges.taxDragRisk >= 70) {
    insights.push({
      tag: "Tax Exposure",
      body:
        "There are structural tax drags apparent in your profile. In British Columbia, the sequence of how you receive and shelter capital dictates what you keep. Let's address tax exposures before any money moves.",
    });
  }

  if (gauges.readiness <= 40) {
    insights.push({
      tag: "Decision Readiness",
      body:
        "It is completely normal to feel paralyzed right now. Your nervous system is catching up with a massive life change. We will prioritize reducing your cognitive overhead — no major plans are needed today.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      tag: "Georgia's Note",
      body: domain
        ? DOMAIN_GREETING[domain]
        : "Answer a few grounded questions and your private blueprint will render live on this side of the screen.",
    });
  }

  return insights;
}

// ---- BC context notes ------------------------------------------------------

export function bcContextNotes(
  domain: Domain | null,
  catalyst: Catalyst | null,
  answers: Answers
): string[] {
  const notes: string[] = [];
  if (domain === "corporate") {
    notes.push(
      "BC-registered CCPCs may access the Lifetime Capital Gains Exemption (LCGE): $1,250,000 per shareholder."
    );
    if (answers.holdco && answers.holdco !== "yes") {
      notes.push("Without an active HoldCo, retained earnings face full corporate + personal tax on distribution.");
    }
    if (answers.lcge === "unsure") {
      notes.push("Multiplying the LCGE through family trusts requires 24-month share holding rules — plan early.");
    }
    if (answers.purification === "yes") {
      notes.push("Excess passive cash inside the OpCo can disqualify the LCGE — purification is the first move.");
    }
  }
  if (domain === "personal") {
    if (catalyst === "inheritance") {
      notes.push(
        "BC Probate fees: ~1.4% on estates over $50,000. Assets in joint tenancy or trust may bypass probate."
      );
    }
    if (catalyst === "divorce_restructuring") {
      notes.push("BC Family Law Act: family property is presumed 50/50 unless a cohabitation or marriage agreement applies.");
    }
    if (catalyst === "executive_exit" && answers.tax_deferral === "no") {
      notes.push("Retiring allowance rollovers into RRSP room can shelter significant severance from immediate BC tax.");
    }
    if (catalyst === "sudden_windfall") {
      notes.push("A 90-day Quiet Period in a separate high-interest account is the strongest first structural move.");
    }
  }
  if (notes.length === 0) {
    notes.push("Complete Steps 1–3 to reveal your BC-specific context.");
  }
  return notes;
}

export function formatCAD(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
