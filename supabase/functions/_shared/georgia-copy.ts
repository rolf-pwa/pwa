// Event-specific copy for the Georgia diagnostic, shared by the browser
// (src/modules/intake/lib/derive.ts) and the edge function that emails the
// roadmap (georgia2-lead) so the two can never drift. No imports, so both
// runtimes can load it.
//
// The point of the vocabulary: the same question or directive must speak the
// visitor's own situation. An estate beneficiary has an estate lawyer and
// estate paperwork, not a corporate lawyer and minute books; a founder has
// the opposite. Everything that names a professional, a document, or the
// capital itself goes through EVENT_VOCAB, keyed by catalyst.

export type DetailStatus = "gap" | "partial" | "strong";

export interface InsightDetail {
  label: string;
  value: string;
  note: string;
  status: DetailStatus;
}

export interface EventVocab {
  /** How a person in this situation refers to their lawyer, e.g. "estate lawyer". */
  lawyer: string;
  /** Governance answer "legal_only": the label and the short form used in results. */
  legalDocsOption: string;
  legalDocsShort: string;
  /** Action plan: what the capital is called, and the documents worth centralizing. */
  holdingTitle: string;
  holdingDetail: string;
  pauseDetail: string;
  documents: string;
  /** Tax Exposure directive: the sentence about sequencing. */
  taxSentence: string;
  /** "Based on what you shared about ..." in the emailed roadmap. */
  eventPhrase: string;
}

const DEFAULT_PAUSE =
  "Halt all irreversible commitments. Do not sign discretionary investment mandates or respond to financial solicitations until your footing is steady.";

const BUSINESS_DOCS =
  "your letter of intent, corporate minute books, shareholder agreements, financial statements, and tax returns";

export const EVENT_VOCAB: Record<string, EventVocab> = {
  founder_exit: {
    lawyer: "corporate lawyer",
    legalDocsOption: "Only standard wills and corporate minute books",
    legalDocsShort: "Wills and minute books only",
    holdingTitle: "Deposit funds into a secure Holding Account",
    holdingDetail:
      "Route your sale proceeds into a secure, insured account before they land anywhere else, so nothing is deployed before there is a plan.",
    pauseDetail: DEFAULT_PAUSE,
    documents: `${BUSINESS_DOCS}, and your own will and powers of attorney`,
    taxSentence:
      "In British Columbia, the sequence of how you structure the sale and receive the proceeds dictates what you keep.",
    eventPhrase: "your business exit",
  },
  growth_stage_founder: {
    lawyer: "corporate lawyer",
    legalDocsOption: "Only standard wills and corporate minute books",
    legalDocsShort: "Wills and minute books only",
    holdingTitle: "Prepare a secure Holding Account",
    holdingDetail:
      "Set up a secure, insured place to receive the proceeds when the exit comes, so nothing is deployed before there is a plan.",
    pauseDetail:
      "Hold off on irreversible commitments ahead of the exit — no new share arrangements, side deals, or discretionary investment mandates until the structure is settled.",
    documents:
      "your corporate minute books, shareholder agreements, cap table, financial statements, and your own will and powers of attorney",
    taxSentence:
      "In British Columbia, how you structure and shelter the company before the exit dictates what you keep.",
    eventPhrase: "preparing for your exit",
  },
  inheritance: {
    lawyer: "estate lawyer",
    legalDocsOption: "Only a standard will and basic estate paperwork",
    legalDocsShort: "A will and basic estate paperwork only",
    holdingTitle: "Deposit funds into a secure Holding Account",
    holdingDetail:
      "Move the inheritance out of everyday accounts into a secure, insured Holding Account, so nothing is deployed before there is a plan.",
    pauseDetail: DEFAULT_PAUSE,
    documents:
      "the will, the estate accounting, probate documents, account statements, and your own will and powers of attorney",
    taxSentence:
      "In British Columbia, the sequence of how you receive and shelter an inheritance dictates what you keep.",
    eventPhrase: "your inheritance",
  },
  divorce_restructuring: {
    lawyer: "family lawyer",
    legalDocsOption: "Only a separation agreement and standard wills",
    legalDocsShort: "A separation agreement and wills only",
    holdingTitle: "Deposit funds into a secure Holding Account",
    holdingDetail:
      "Route your settlement funds into a secure, insured Holding Account in your own name, so nothing is deployed before there is a plan.",
    pauseDetail: DEFAULT_PAUSE,
    documents:
      "your separation agreement, financial disclosure, account statements, tax returns, and your own will and powers of attorney",
    taxSentence:
      "In British Columbia, the sequence of how you receive and shelter settlement assets dictates what you keep.",
    eventPhrase: "your separation",
  },
  executive_exit: {
    lawyer: "employment lawyer",
    legalDocsOption: "Only a standard will and my employment agreements",
    legalDocsShort: "A will and employment agreements only",
    holdingTitle: "Deposit funds into a secure Holding Account",
    holdingDetail:
      "Route your severance and retiring allowance into a secure, insured Holding Account, so nothing is deployed before there is a plan.",
    pauseDetail: DEFAULT_PAUSE,
    documents:
      "your severance or retirement agreement, equity and option statements, pension and account statements, tax returns, and your own will and powers of attorney",
    taxSentence:
      "In British Columbia, the sequence of how you receive and shelter severance, options, and a retiring allowance dictates what you keep.",
    eventPhrase: "your retirement transition",
  },
  sudden_windfall: {
    lawyer: "lawyer",
    legalDocsOption: "Only a standard will and basic legal documents",
    legalDocsShort: "A will and basic legal documents only",
    holdingTitle: "Deposit funds into a secure Holding Account",
    holdingDetail:
      "Move the windfall out of everyday accounts into a secure, insured Holding Account, so nothing is deployed before there is a plan.",
    pauseDetail: DEFAULT_PAUSE,
    documents:
      "the payout or settlement paperwork, account statements, tax returns, and your own will and powers of attorney",
    taxSentence:
      "In British Columbia, the sequence of how you receive and shelter a windfall dictates what you keep.",
    eventPhrase: "your windfall",
  },
};
EVENT_VOCAB.insurance_settlement = {
  ...EVENT_VOCAB.sudden_windfall,
  eventPhrase: "your settlement",
};

export function vocabFor(catalyst: string | null | undefined): EventVocab {
  return EVENT_VOCAB[catalyst ?? ""] ?? EVENT_VOCAB.sudden_windfall;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Replaces {lawyer}, {Lawyer}, {legalDocsOption} in diagnostic question copy. */
export function fillVocab(text: string, catalyst: string | null | undefined): string {
  const v = vocabFor(catalyst);
  return text
    .replace(/\{Lawyer\}/g, titleCase(v.lawyer))
    .replace(/\{lawyer\}/g, v.lawyer)
    .replace(/\{legalDocsOption\}/g, v.legalDocsOption);
}

/** The three-step action plan, written for the visitor's own event. */
export function actionPlanFor(catalyst: string | null | undefined): { title: string; detail: string }[] {
  const v = vocabFor(catalyst);
  return [
    { title: v.holdingTitle, detail: v.holdingDetail },
    { title: "Institute a 90-day (minimum) Stabilization Period", detail: v.pauseDetail },
    {
      title: "Centralize your documents",
      detail: `Gather ${v.documents} in one secure place, so every professional works from the same facts.`,
    },
  ];
}

/** The Tax Exposure directive body; probate applies to inheritance only. */
export function taxExposureBody(catalyst: string | null | undefined, probateExposure: boolean): string {
  const v = vocabFor(catalyst);
  return (
    `There are structural tax drags apparent in your profile. ${v.taxSentence} Let's address tax exposures before any money moves.` +
    (probateExposure
      ? " BC probate fees run about 1.4% on estate value over $50,000 — and assets held in joint tenancy or a trust may bypass probate entirely, so structure matters before anything is distributed."
      : "")
  );
}

/** Governance Readiness shows once the average structure answer is at least "partial". */
export const GOVERNANCE_SHOW_AT = 55;

function governanceDetail(catalyst: string | null | undefined): Record<string, Omit<InsightDetail, "label">> {
  const v = vocabFor(catalyst);
  return {
    none: {
      value: "No written charter",
      note: "Decisions are being made case-by-case, without documented rules of engagement or family boundaries — the most common way well-intentioned capital gets pulled off course.",
      status: "gap",
    },
    legal_only: {
      value: v.legalDocsShort,
      note: "Your legal documents say who gets what, but not why the wealth exists or how decisions get made when emotions run high.",
      status: "partial",
    },
    charter: {
      value: "Written family constitution in place",
      note: "A charter is the strongest protection you can have — the work is keeping it current as your circumstances change.",
      status: "strong",
    },
  };
}

function advisoryDetail(catalyst: string | null | undefined): Record<string, Omit<InsightDetail, "label">> {
  const v = vocabFor(catalyst);
  return {
    siloed: {
      value: "Professionals work in silos",
      note: `Your accountant, ${v.lawyer}, and custodian aren't talking, so you are the translator between them. The costly mistakes hide in the gaps.`,
      status: "gap",
    },
    bank: {
      value: "One institution runs everything",
      note: "A single bank or broker is steering the structure, and their incentive is their own product shelf — not necessarily your charter.",
      status: "partial",
    },
    vfo: {
      value: "Coordinated team under one charter",
      note: "Your professionals are aligned around one plan, which is exactly where you want to be.",
      status: "strong",
    },
  };
}

export function governanceDetails(
  catalyst: string | null | undefined,
  answers: Record<string, unknown>,
): { details: InsightDetail[]; nextMove?: string } {
  const details: InsightDetail[] = [];
  const gov = governanceDetail(catalyst)[String(answers.governance ?? "")];
  const adv = advisoryDetail(catalyst)[String(answers.advisory ?? "")];
  if (gov) details.push({ label: "Written charter", ...gov });
  if (adv) details.push({ label: "Professional coordination", ...adv });

  let nextMove: string | undefined;
  if (gov && gov.status !== "strong") {
    nextMove =
      "Draft a Sovereignty Charter: put your family boundaries and the purpose of your capital in writing before capital moves.";
  } else if (adv && adv.status !== "strong") {
    nextMove =
      "Bring your professionals under one plan: an independent Family CFO chairs regular sessions so your accountant, " +
      `${vocabFor(catalyst).lawyer}, and custodian work from the same charter.`;
  }
  return { details, nextMove };
}
