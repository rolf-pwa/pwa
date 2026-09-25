// Pure safety + copy helpers for the Georgia free-text step and the
// validation paragraph. No imports, so the browser tests can load it.
//
// Design rule (strategy blueprint): the LLM is only a translator. It may
// turn free text into fixed enums and a boolean, or phrase a short
// acknowledgment from enums -- it never gives advice, and its output is
// checked here before anything reaches a visitor. Threat detection is
// deliberately layered so no single model call can suppress it: keyword
// patterns run first and either LLM pass tripping is enough.

export type ThreatSource = "keywords" | "model" | "verifier";

const THREAT_PATTERNS: RegExp[] = [
  /\b(?:kill|murder|shoot|stab|strangle|beat (?:me|him|her|us|them) up)\b/i,
  /\b(?:threat(?:en(?:s|ed|ing)?)?|intimidat\w*|stalk\w*|harass\w*|blackmail\w*|extort\w*|ransom)\b/i,
  /\b(?:hurt|harm|attack|assault)\s+(?:me|us|him|her|them|my|the kids?|the children)\b/i,
  /\b(?:abus(?:e|ed|ive|er)|violent|violence)\b/i,
  /\b(?:suicid\w*|kill myself|end it all|self[- ]?harm|(?:don'?t|do not) want to (?:live|be here)|no reason to live|better off dead)\b/i,
  /\b(?:theft|steal\w*|stole\w*|robbed|embezzl\w*|fraud\w*|forg(?:e|ed|ery)|scammed)\b/i,
  /\b(?:lawsuit|litigation|subpoena\w*|restraining order|served (?:me|us) (?:with )?papers)\b/i,
  // Case-sensitive on purpose: "Sue" is also a first name.
  /\b(?:sue|sued|suing)\b/,
];

/** True if the text contains explicit threat / harm / legal-action language. */
export function keywordThreat(text: string): boolean {
  return THREAT_PATTERNS.some((p) => p.test(text));
}

const FORBIDDEN_IN_VALIDATION =
  /\b(?:should|must|invest\w*|buy|sell|purchase|guarantee\w*|recommend\w*|advis\w*|you need to|you have to|score|percent)\b/i;

/**
 * A model-written validation paragraph is accepted only if it is short,
 * plain, and free of numbers, money, links, exclamations, and anything that
 * reads as advice. Otherwise the deterministic fallback is used.
 */
export function validateValidationText(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < 60 || t.length > 450) return false;
  if (/\d|[$%€£]|https?:|www\.|@|!/.test(t)) return false;
  if (FORBIDDEN_IN_VALIDATION.test(t)) return false;
  const sentences = t.split(/(?<=[.?])\s+/).filter(Boolean);
  return sentences.length >= 2 && sentences.length <= 4;
}

const SPOKE_OPENER: Record<string, string> = {
  Business_Exit: "Preparing for the sale of a business you built is rarely just a financial event.",
  Pre_Exit_Growth: "Thinking about the exit while you're still building takes real foresight.",
  Inheritance: "Receiving an inheritance is rarely just a financial event.",
  Divorce: "A separation resets the financial picture and the personal one at the same time.",
  Executive_Retirement: "Stepping out of a senior role is a financial and personal shift at once.",
  Financial_Windfall: "Sudden money arrives with more feelings than most people expect.",
};
const DEFAULT_OPENER = "A major financial transition is rarely just a financial event.";

const EMOTION_LINE: Record<string, string> = {
  guilt: "Feeling guilt alongside it is more common than most people admit, and it doesn't mean you're doing anything wrong.",
  grief: "Grief and money arriving together can make it hard to think clearly, and that is entirely normal.",
  anxiety: "Feeling anxious about getting it right is a sign you're taking it seriously.",
  relief: "Feeling relieved is a healthy place to begin from.",
  euphoria: "Excitement is natural, and it is worth building a little structure around it before anything moves.",
  loss_of_identity: "Feeling unsure of who you are on the other side of it is a real part of this kind of transition.",
};

const FRICTION_LINE: Record<string, string> = {
  family_pressure: "Pressure from the people around you is one of the hardest parts, and you don't have to absorb it alone.",
  professional_pressure: "Having several professionals pull you in different directions is exhausting, and it is worth having one clear view.",
  internal_paralysis: "Feeling stuck is a common response to something this big, and it usually eases once there is a plan.",
  operational_overload: "Being stretched this thin makes every decision harder than it needs to be.",
  liquidity_gap: "Having so much of your wealth tied up on paper can feel unsettling in its own way.",
  no_friction: "You're coming to this from a steady place, which makes everything easier.",
};

/** Deterministic acknowledgment used when the model is unavailable or its output is rejected. */
export function fallbackValidation(
  spoke: string | null,
  emotionalState: string | null,
  primaryFriction: string | null,
): string {
  const opener = (spoke && SPOKE_OPENER[spoke]) || DEFAULT_OPENER;
  const middle =
    (emotionalState && EMOTION_LINE[emotionalState]) ||
    (primaryFriction && FRICTION_LINE[primaryFriction]) ||
    "Whatever you are feeling about it is a normal response.";
  return `${opener} ${middle} You don't need to decide anything today.`;
}
