import { CATALYST_LABELS, questionsFor, type Catalyst } from "./derive";

export interface AnswerRow {
  key: string;
  /** Short label, e.g. "Governance". */
  label: string;
  question: string;
  value: string;
}

export const HUB_LABELS = {
  emotional_state: {
    relief: "Relief",
    anxiety: "Anxiety about getting it right",
    guilt: "Guilt",
    grief: "Grief",
    loss_of_identity: "Losing a sense of who they are",
    euphoria: "Excitement",
  },
  relational_state: {
    private: "Private — only them, perhaps one trusted person",
    small_circle: "A small circle — close family and a few advisors",
    public_knowledge: "Public knowledge",
  },
  timeline_urgency: {
    pre_liquidity: "Pre-liquidity — still ahead",
    under_30_days: "Landed, or landing within 30 days",
    one_to_six_months: "One to six months ago",
    over_six_months: "More than six months ago",
  },
  primary_friction: {
    family_pressure: "Pressure from family",
    professional_pressure: "Pulled between professionals",
    internal_paralysis: "Feeling stuck",
    operational_overload: "Stretched too thin",
    liquidity_gap: "Wealth tied up on paper",
    no_friction: "No major friction",
  },
} as const;

export function hubLabel(field: keyof typeof HUB_LABELS, value: string | null | undefined): string | null {
  if (!value) return null;
  return (HUB_LABELS[field] as Record<string, string>)[value] ?? value.replace(/_/g, " ");
}

/**
 * Turns a lead's raw answers into readable rows using the same event-specific
 * question copy the visitor saw. Answers whose key is not part of the current
 * question set (leads captured under an earlier version of the diagnostic)
 * come back separately so nothing is silently dropped.
 */
export function summarizeAnswers(
  catalyst: string,
  answers: Record<string, unknown> | null | undefined
): { rows: AnswerRow[]; other: { key: string; value: string }[] } {
  const rows: AnswerRow[] = [];
  const used = new Set<string>();
  const source = answers ?? {};
  if (catalyst in CATALYST_LABELS) {
    for (const q of questionsFor(catalyst as Catalyst)) {
      const chosen = q.options.find((o) => o.id === source[q.key]);
      if (!chosen) continue;
      used.add(q.key);
      rows.push({
        key: q.key,
        label: q.key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        question: q.text,
        value: chosen.label,
      });
    }
  }
  const other = Object.entries(source)
    .filter(([key]) => !used.has(key))
    .map(([key, value]) => ({ key: key.replace(/_/g, " "), value: String(value) }));
  return { rows, other };
}
