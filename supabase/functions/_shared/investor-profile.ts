// Pure helper (no Deno/env deps, unit-tested in src/test). Investor Risk
// Profile forms carry a risk category and, separately, the portfolio the
// client actually chose. Whether those agree is a string comparison, so it
// is derived here instead of trusted from the model: in an A/B run the model
// returned `false` for "Growth portfolio" vs a "Growth" profile at one
// thinking level and `true` at the others, with no reason given.

const KNOWN_CATEGORIES = ["prudent", "conservative", "moderate", "balanced", "growth", "aggressive"];

function mentionedCategories(text: string): string[] {
  const t = text.toLowerCase();
  return KNOWN_CATEGORIES.filter((c) => new RegExp(`\\b${c}\\b`).test(t));
}

/**
 * Returns true/false only when the stated choice names exactly one known
 * risk category; anything ambiguous or unrecognised falls back to the
 * model's own answer (or null if it gave none).
 */
export function deriveChoiceMatchesProfile(
  profileCategory: string | null | undefined,
  statedChoice: string | null | undefined,
  modelValue: boolean | null,
): boolean | null {
  if (!profileCategory || !statedChoice) return modelValue;
  const category = profileCategory.trim().toLowerCase();
  if (!KNOWN_CATEGORIES.includes(category)) return modelValue;
  const mentioned = mentionedCategories(statedChoice);
  if (mentioned.length === 1) return mentioned[0] === category;
  return modelValue;
}
