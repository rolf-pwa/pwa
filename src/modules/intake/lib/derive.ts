// Georgia 2.0 — pure derivation logic (unit-testable)
// Copy & routing per "Georgia Interactive Questionnaire Scripts & Micro-Copy" spec.

import {
  actionPlanFor,
  fillVocab,
  GOVERNANCE_SHOW_AT,
  governanceDetails,
  taxExposureBody,
  type InsightDetail,
} from "../../../../supabase/functions/_shared/georgia-copy";

export { actionPlanFor, GOVERNANCE_SHOW_AT };
export type { DetailStatus, InsightDetail } from "../../../../supabase/functions/_shared/georgia-copy";

export type Domain = "corporate" | "personal";

export type CorporateCatalyst = "founder_exit" | "growth_stage_founder";
export type PersonalCatalyst =
  | "inheritance"
  | "executive_exit"
  | "divorce_restructuring"
  | "insurance_settlement"
  | "sudden_windfall";
export type Catalyst = CorporateCatalyst | PersonalCatalyst;

/**
 * The doc's 7-value spoke enum (Georgia strategy blueprint, 2026-09-25).
 * Internal catalysts stay finer-grained (both windfall catalysts map to
 * Financial_Windfall); Emergency_Override is reserved for the future
 * threat-detection protocol and is never selectable in the diagnostic.
 */
export type Spoke =
  | "Business_Exit"
  | "Pre_Exit_Growth"
  | "Inheritance"
  | "Divorce"
  | "Executive_Retirement"
  | "Financial_Windfall"
  | "Emergency_Override";

export const CATALYST_SPOKE: Record<Catalyst, Spoke> = {
  founder_exit: "Business_Exit",
  growth_stage_founder: "Pre_Exit_Growth",
  inheritance: "Inheritance",
  divorce_restructuring: "Divorce",
  executive_exit: "Executive_Retirement",
  insurance_settlement: "Financial_Windfall",
  sudden_windfall: "Financial_Windfall",
};

// Hub variables -- the universal, event-independent facts about the person.
export type EmotionalState = "relief" | "anxiety" | "guilt" | "grief" | "loss_of_identity" | "euphoria";
export type RelationalState = "private" | "small_circle" | "public_knowledge";
export type TimelineUrgency = "pre_liquidity" | "under_30_days" | "one_to_six_months" | "over_six_months";
export type PrimaryFriction =
  | "family_pressure"
  | "professional_pressure"
  | "internal_paralysis"
  | "operational_overload"
  | "liquidity_gap"
  | "no_friction";

export interface HubValues {
  emotional_state?: EmotionalState;
  relational_state?: RelationalState;
  timeline_urgency?: TimelineUrgency;
  primary_friction?: PrimaryFriction;
}

export type RiskKey = "tax" | "structure" | "noise" | "readiness";

export type OptionId = string;
export type Answers = Record<string, OptionId>;
// Legacy alias for state typing
export type Answer = OptionId | null;


/**
 * Lifetime Capital Gains Exemption limit per individual. Indexed annually --
 * verify against CRA each January. Also hardcoded in
 * supabase/functions/georgia2-lead/index.ts (LCGE_LIMIT_LABEL): update both.
 */
export const LCGE_LIMIT = 1_275_000; // 2026
export const LCGE_LIMIT_LABEL = "$1,275,000";

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

/** The six tiles of the opening question, in display order. */
export const TRANSITION_CATALYSTS: Catalyst[] = [
  "founder_exit",
  "growth_stage_founder",
  "inheritance",
  "divorce_restructuring",
  "executive_exit",
  "sudden_windfall",
];

export function domainForCatalyst(catalyst: Catalyst): Domain {
  return (CORPORATE_CATALYSTS as Catalyst[]).includes(catalyst) ? "corporate" : "personal";
}

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
  description?: string;
  risks: Partial<Record<RiskKey, 1 | 2 | 3>>;
  /** Hub value this answer implies (feeds the diagnostic payload, not the gauges). */
  hub?: HubValues;
}

export interface Question {
  key: string;
  text: string;
  tooltip: string;
  options: QOption[];
}

/**
 * Person-first questions asked of every spoke -- how the visitor is holding
 * the moment (nervous system), whether their intentions are written down
 * (governance), who knows (relational noise), where they are on the
 * timeline, and whether their professionals work as one team (advisory).
 * Risk weights use the same scale as the catalyst questions (1 = low,
 * 3 = high risk) and feed the same four gauges. Order is applied in
 * questionsFor(): nervous_system and governance first, then the spoke's
 * own friction question, then the rest.
 */
export const PERSON_QUESTIONS: Question[] = [
  {
    key: "nervous_system",
    text: "How is your personal nervous system and decision buffer right now?",
    tooltip:
      "Decisions made under pressure are the most expensive ones. Where you are right now tells us how much protection your first 90 days need.",
    options: [
      {
        id: "overload",
        label: "Nervous-System Overload & High Pressure",
        description: "Multiple advisors, banks, friends, or relatives are already reaching out with demands and proposals.",
        risks: { noise: 3, readiness: 3 },
      },
      {
        id: "cautious",
        label: "Cautious Uncertainty",
        description: "I feel the gravity of the wealth and want to avoid mistakes, but have not yet instituted a formal pause.",
        risks: { noise: 2, readiness: 2 },
      },
      {
        id: "grounded",
        label: "Calm and Grounded",
        description: "I have established clear temporary boundaries and am seeking long-term architectural stewardship.",
        risks: { noise: 1, readiness: 1 },
      },
    ],
  },
  {
    key: "governance",
    text: "Do you have a written Sovereignty Charter or personal constitution?",
    tooltip:
      "A written charter turns your intentions into rules before emotion, family, or salespeople test them.",
    options: [
      {
        id: "none",
        label: "No formal written charter exists",
        description: "Decisions are made case-by-case without documented rules of engagement or family boundaries.",
        risks: { structure: 3 },
      },
      {
        id: "legal_only",
        label: "{legalDocsOption}",
        description: "Legal documents exist, but they do not define the purpose of wealth or decision protocols.",
        risks: { structure: 2 },
      },
      {
        id: "charter",
        label: "Yes, a comprehensive family constitution is in place",
        description: "Written guidelines clearly govern family loans, gifting, philanthropy, and capital allocation.",
        risks: { structure: 1 },
      },
    ],
  },
  {
    key: "relational",
    text: "Who knows about this right now?",
    tooltip:
      "The more people who know, the more requests, opinions, and pressure arrive. We call this the noise around you.",
    options: [
      {
        id: "private",
        label: "Only me, and perhaps one trusted person",
        description: "I am navigating this privately.",
        risks: { noise: 1 },
        hub: { relational_state: "private" },
      },
      {
        id: "small_circle",
        label: "A small circle",
        description: "Close family and a few trusted advisors.",
        risks: { noise: 2 },
        hub: { relational_state: "small_circle" },
      },
      {
        id: "public_knowledge",
        label: "It's public knowledge",
        description: "Friends, colleagues, and the wider community are already aware.",
        risks: { noise: 3 },
        hub: { relational_state: "public_knowledge" },
      },
    ],
  },
  {
    key: "timeline",
    text: "Where are you on the timeline?",
    tooltip:
      "The right first move depends on whether the capital has landed yet, and how recently it did.",
    options: [
      {
        id: "pre_liquidity",
        label: "Not yet — it's still ahead of me",
        description: "I am planning before the money moves.",
        risks: {},
        hub: { timeline_urgency: "pre_liquidity" },
      },
      {
        id: "under_30_days",
        label: "It has landed, or lands within 30 days",
        description: "Decisions are arriving faster than I can think.",
        risks: { readiness: 3 },
        hub: { timeline_urgency: "under_30_days" },
      },
      {
        id: "one_to_six_months",
        label: "One to six months ago",
        description: "The dust is settling, but nothing is formally in place.",
        risks: { readiness: 2 },
        hub: { timeline_urgency: "one_to_six_months" },
      },
      {
        id: "over_six_months",
        label: "More than six months ago",
        description: "I have been living with it for a while.",
        risks: {},
        hub: { timeline_urgency: "over_six_months" },
      },
    ],
  },
  {
    key: "advisory",
    text: "How do your external professionals (Accountant, {Lawyer}, Custodian) collaborate?",
    tooltip:
      "Uncoordinated professionals each optimize their own piece — the gaps between them are where the costly mistakes happen.",
    options: [
      {
        id: "siloed",
        label: "Completely Disconnected / Siloed",
        description: "My CPA and {lawyer} rarely or never speak; I am the middleman translating technical jargon.",
        risks: { structure: 3, tax: 2 },
      },
      {
        id: "bank",
        label: "Private Bank / Broker Controls Everything",
        description: "A bank representative manages things, but is primarily focused on their proprietary investment products.",
        risks: { structure: 2, tax: 2 },
      },
      {
        id: "vfo",
        label: "Unified Virtual Family Office / Board of Directors",
        description: "An independent Family CFO chairs regular governance meetings aligning all professionals to one charter.",
        risks: { structure: 1, tax: 1 },
      },
    ],
  },
];

// The spoke-specific "what weighs on you most" question. Each answer sets
// the Hub's primary_friction and emotional_state (deterministic, no LLM).
type FrictionOption = [
  id: string,
  label: string,
  friction: PrimaryFriction,
  emotion: EmotionalState,
];
const FRICTION_RISKS: Record<PrimaryFriction, QOption["risks"]> = {
  family_pressure: { noise: 3 },
  professional_pressure: { noise: 3 },
  internal_paralysis: { readiness: 3 },
  operational_overload: { readiness: 2 },
  liquidity_gap: { structure: 2, tax: 1 },
  no_friction: { readiness: 1 },
};
function frictionQuestion(text: string, tooltip: string, options: FrictionOption[]): Question {
  return {
    key: "friction",
    text,
    tooltip,
    options: options.map(([id, label, friction, emotion]) => ({
      id,
      label,
      risks: FRICTION_RISKS[friction],
      hub: { primary_friction: friction, emotional_state: emotion },
    })),
  };
}

const WINDFALL_FRICTION = frictionQuestion(
  "How is this windfall landing for you?",
  "Sudden money stirs up more than numbers. Naming what you feel is the first step to not being ruled by it.",
  [
    ["excited_wary", "Excited, but I don't trust myself not to make a mistake", "internal_paralysis", "euphoria"],
    ["guilt", "Guilt or discomfort about having it", "internal_paralysis", "guilt"],
    ["people_asking", "People are already asking for money or offering deals", "family_pressure", "anxiety"],
    ["advisors_circling", "Advisors and salespeople are circling", "professional_pressure", "anxiety"],
    ["steady", "Steady — I just want to park it safely and plan", "no_friction", "relief"],
  ]
);

export const FRICTION_QUESTIONS: Record<Catalyst, Question> = {
  founder_exit: frictionQuestion(
    "What is weighing on you most as this exit approaches?",
    "Founders rarely struggle with the deal itself — it is the pressure around it, and who you are afterward.",
    [
      ["pulled_apart", "Buyers, partners, and advisors are pulling me in different directions", "professional_pressure", "anxiety"],
      ["identity", "Who I am once the business is gone", "internal_paralysis", "loss_of_identity"],
      ["family_expectations", "Family expectations about what happens to the proceeds", "family_pressure", "anxiety"],
      ["consumed", "The day-to-day is consuming me — I can't think about what comes next", "operational_overload", "anxiety"],
      ["relief", "Mostly relief — I just want to do this right", "no_friction", "relief"],
    ]
  ),
  growth_stage_founder: frictionQuestion(
    "What is the biggest tension in the business right now?",
    "Paper wealth, overload, and misaligned partners are the three most common pressure points before an exit.",
    [
      ["paper_wealth", "Most of my wealth is paper — tied up in shares I can't touch", "liquidity_gap", "anxiety"],
      ["stretched", "I'm stretched thin running it while planning what comes next", "operational_overload", "anxiety"],
      ["misaligned", "Co-founders, investors, or advisors want different things", "professional_pressure", "anxiety"],
      ["family", "My family doesn't understand what's at stake, or expects a lot", "family_pressure", "anxiety"],
      ["energized", "I'm energized — I just want the structure ready before the exit", "no_friction", "relief"],
    ]
  ),
  inheritance: frictionQuestion(
    "What feels heaviest about this inheritance?",
    "An inheritance is money and loss at the same time. There is no wrong answer here.",
    [
      ["guilt", "Guilt — about receiving it, or about what I might do with it", "internal_paralysis", "guilt"],
      ["siblings", "Tension with siblings or extended family", "family_pressure", "anxiety"],
      ["everyone_advising", "Everyone — banks, advisors, relatives — suddenly has advice", "professional_pressure", "anxiety"],
      ["grief", "Grief, and a sense that I can't think clearly yet", "internal_paralysis", "grief"],
      ["honour", "Relief — I just want to honour it properly", "no_friction", "relief"],
    ]
  ),
  divorce_restructuring: frictionQuestion(
    "What is hardest right now?",
    "Separation is a financial and personal reset at once. Where the weight sits tells us where to start.",
    [
      ["legal_pressure", "Negotiations and legal pressure from every direction", "professional_pressure", "anxiety"],
      ["independence", "Rebuilding my identity and independence", "internal_paralysis", "loss_of_identity"],
      ["sides", "Family, friends, and in-laws taking sides", "family_pressure", "anxiety"],
      ["what_i_own", "Understanding what I actually own and owe", "operational_overload", "anxiety"],
      ["clean_start", "Relief that it's nearly over — I want a clean foundation", "no_friction", "relief"],
    ]
  ),
  executive_exit: frictionQuestion(
    "What is weighing on you most about this transition?",
    "Leaving a senior role is as much an identity shift as a financial one.",
    [
      ["title", "Who I am without the title and the team", "internal_paralysis", "loss_of_identity"],
      ["tax_bill", "A large tax bill and deadlines I don't fully understand", "operational_overload", "anxiety"],
      ["decide_fast", "Pressure to decide quickly on options, stock, or the package", "professional_pressure", "anxiety"],
      ["family_retirement", "Family expectations about what retirement should look like", "family_pressure", "anxiety"],
      ["clear_plan", "Relief — I just want a clear plan", "no_friction", "relief"],
    ]
  ),
  sudden_windfall: WINDFALL_FRICTION,
  insurance_settlement: WINDFALL_FRICTION,
};

export const CATALYST_QUESTIONS: Record<Catalyst, Question[]> = {
  founder_exit: [
    {
      key: "lcge",
      text: "Have you or your co-founders utilized your Lifetime Capital Gains Exemption (LCGE) yet?",
      tooltip:
        `For BC founders, the LCGE shelters up to ${LCGE_LIMIT_LABEL} of capital gains per shareholder if structured correctly before the sale.`,
      options: [
        { id: "intact", label: "No — it is fully intact", risks: { tax: 1 } },
        { id: "used", label: "Yes — it has been used", risks: { tax: 1 } },
        { id: "unsure", label: "Unsure / not structured yet", risks: { tax: 3, readiness: 2 } },
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
  ],
  inheritance: [
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
  ],
  executive_exit: [
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

/** The full ordered question list for a catalyst: person-first, then catalyst-specific. */
/** Fills the event vocabulary ({lawyer}, {legalDocsOption}) into a question's copy. */
function tailorQuestion(q: Question, catalyst: Catalyst): Question {
  const fill = (t: string) => fillVocab(t, catalyst);
  return {
    ...q,
    text: fill(q.text),
    tooltip: fill(q.tooltip),
    options: q.options.map((o) => ({
      ...o,
      label: fill(o.label),
      description: o.description ? fill(o.description) : o.description,
    })),
  };
}

export function questionsFor(catalyst: Catalyst): Question[] {
  const [nervousSystem, governance, ...rest] = PERSON_QUESTIONS;
  return [nervousSystem, governance, FRICTION_QUESTIONS[catalyst], ...rest, ...CATALYST_QUESTIONS[catalyst]].map((q) =>
    tailorQuestion(q, catalyst)
  );
}

export interface DiagnosticPayload {
  spoke: Spoke;
  emotional_state: EmotionalState | null;
  relational_state: RelationalState | null;
  timeline_urgency: TimelineUrgency | null;
  primary_friction: PrimaryFriction | null;
}

/**
 * The structured Hub + spoke handoff for a completed diagnostic, derived
 * deterministically from the chosen options -- no LLM involved. Anything the
 * visitor didn't answer stays null rather than being guessed.
 */
export function deriveDiagnosticPayload(catalyst: Catalyst, answers: Answers): DiagnosticPayload {
  const hub: HubValues = {};
  for (const q of questionsFor(catalyst)) {
    const chosen = q.options.find((o) => o.id === answers[q.key]);
    if (chosen?.hub) Object.assign(hub, chosen.hub);
  }
  return {
    spoke: CATALYST_SPOKE[catalyst],
    emotional_state: hub.emotional_state ?? null,
    relational_state: hub.relational_state ?? null,
    timeline_urgency: hub.timeline_urgency ?? null,
    primary_friction: hub.primary_friction ?? null,
  };
}

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
  // Visitor chose "Talk It Through" on the results screen.
  | "clarity_call"
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

export function deriveResult(domain: Domain): DerivedResult {
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
  return questionsFor(catalyst).some((q) => Boolean(answers[q.key]));
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
  const qs = questionsFor(catalyst);
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
  answers: Answers
): Gauges {
  const t = accumulateRisks(catalyst, answers);

  // Map 1..3 -> percentage. 1 = 20, 2 = 55, 3 = 90.
  const toRisk = (v: number) => 20 + (v - 1) * 35;
  const toSafety = (v: number) => 90 - (v - 1) * 35;

  const tax = toRisk(avg(t.tax, 1.5));
  const noise = toRisk(avg(t.noise, catalyst ? 1.5 : 1));
  const structure = toSafety(avg(t.structure, 2));
  let readiness = toSafety(avg(t.readiness, 2));

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
  const answered = questionsFor(catalyst).filter((q) => Boolean(answers[q.key])).length;
  return Math.max(0, Math.min(answered, milestoneCount - 1));
}


// ---- Georgia Insights (dynamic quotes) ------------------------------------

export const STEADY_FOOTING = {
  tag: "Foundations in Good Standing",
  body:
    "Your answers point to a steady footing — decision readiness, governance, noise, and tax exposure are all within a healthy range. The plan below is about keeping it that way while capital moves.",
};

export interface GeorgiaInsight {
  tag: string;
  body: string;
  details?: InsightDetail[];
  /** The single most useful next move implied by the details. */
  nextMove?: string;
}

export function georgiaInsights(
  domain: Domain | null,
  catalyst: Catalyst | null,
  answers: Answers
): GeorgiaInsight[] {
  const insights: GeorgiaInsight[] = [];
  const gauges = computeGauges(domain, catalyst, answers);

  if (domain && hasDiagnosticInput(catalyst, answers)) {
    insights.push({
      tag: "Your Next Step",
      body:
        "The Sovereignty Survey is a 90-minute working session built around exactly what you've told me — you leave with a Stabilization Map, an Immediate Risk Scan, and a 30-Day Action Framework. No pitch, no commitment beyond the session itself.",
    });
  }


  // Order matters (person first): Decision Readiness, Governance Readiness,
  // Noise Exposure, then Tax Exposure. Keep in sync with
  // computeNarrativeInsights in georgia2-lead/index.ts.
  if (gauges.readiness <= 40) {
    insights.push({
      tag: "Decision Readiness",
      body:
        "It is completely normal to feel paralyzed right now. Your nervous system is catching up with a massive life change. We will prioritize reducing your cognitive overhead — no major plans are needed today.",
    });
  }

  if (gauges.structureSafety <= GOVERNANCE_SHOW_AT) {
    const { details, nextMove } = governanceDetails(catalyst, answers);
    insights.push({
      tag: "Governance Readiness",
      body: details.length
        ? "Governance readiness is whether your intentions are written down and your professionals are working as one team. Here is where you stand:"
        : "Without a written charter and professionals working as one team, decisions get made case-by-case, under pressure. Putting your family boundaries and the purpose of your capital in writing is the durable fix.",
      details: details.length ? details : undefined,
      nextMove,
    });
  }

  if (gauges.noiseStrain >= 70) {
    insights.push({
      tag: "Noise Exposure",
      body:
        "With many eyes on this transition, the noise level around you is incredibly high. You have a legal and emotional right to step back. The single best decision right now is to declare a Quiet Period while we sort the sequence.",
    });
  }

  const probateExposure = catalyst === "inheritance" && answers.probate === "yes";
  if (gauges.taxDragRisk >= 70 || probateExposure) {
    insights.push({
      tag: "Tax Exposure",
      body: taxExposureBody(catalyst, probateExposure),
    });
  }

  // Every completed diagnostic gets the same results structure: when no
  // directive is triggered, a steady-footing note stands in so the section
  // never disappears. Keep in sync with computeNarrativeInsights in
  // georgia2-lead/index.ts.
  if (domain && hasDiagnosticInput(catalyst, answers) && !insights.some((i) => i.tag !== "Your Next Step")) {
    insights.push({ tag: STEADY_FOOTING.tag, body: STEADY_FOOTING.body });
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
      `BC-registered CCPCs may access the Lifetime Capital Gains Exemption (LCGE): ${LCGE_LIMIT_LABEL} per shareholder.`
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
  return notes;
}

export function formatCAD(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
