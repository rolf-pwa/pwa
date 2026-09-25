// Georgia diagnostic -> Sovereignty Survey handoff (strategy update, Phase D).
//
// When a paying client's email matches a Georgia lead, carry what the
// diagnostic already learned into their new household so onboarding doesn't
// ask twice and opens with a personal, relevant intro:
//   - wealth_event_type is pre-filled from the lead's spoke (source recorded
//     in wealth_event_source so the UI can show it as "from your diagnostic"),
//   - onboarding_intro_text is built from the spoke + primary friction.
// The intro is deterministic template copy (no LLM) -- see the strategy
// plan's Phase B for the deferred LLM-personalized version; the column is
// the same either way.
//
// Pure copy/mapping functions are exported separately so they can be tested.

export const SPOKE_TO_WEALTH_EVENT: Record<string, string> = {
  Business_Exit: "business_exit",
  Pre_Exit_Growth: "business_growth",
  Inheritance: "inheritance",
  Divorce: "divorce",
  Executive_Retirement: "retirement",
  Financial_Windfall: "other_sudden_wealth",
};

// Leads captured before the spoke column existed only have a catalyst.
export const CATALYST_TO_SPOKE_NAME: Record<string, string> = {
  founder_exit: "Business_Exit",
  growth_stage_founder: "Pre_Exit_Growth",
  inheritance: "Inheritance",
  divorce_restructuring: "Divorce",
  executive_exit: "Executive_Retirement",
  insurance_settlement: "Financial_Windfall",
  sudden_windfall: "Financial_Windfall",
};

const EVENT_PHRASE: Record<string, string> = {
  Business_Exit: "your business exit",
  Pre_Exit_Growth: "preparing for a future exit",
  Inheritance: "your inheritance",
  Divorce: "your separation",
  Executive_Retirement: "your move out of a senior role",
  Financial_Windfall: "your windfall",
};

const FRICTION_SENTENCE: Record<string, string> = {
  family_pressure:
    "You mentioned pressure from the people around you, so we'll keep a clear boundary between your capital and everyone's opinions in mind from the start.",
  professional_pressure:
    "You mentioned being pulled in different directions by advisors and other professionals — nothing here asks you to decide anything today.",
  internal_paralysis:
    "You mentioned feeling stuck — nothing here asks you to make a big decision today.",
  operational_overload:
    "You mentioned being stretched thin, so these steps are short, and you can stop and come back at any time.",
  liquidity_gap:
    "You mentioned most of your wealth being tied up on paper — your Survey will map what is actually accessible, and when.",
  no_friction: "You're coming to this from a steady place, which makes everything easier.",
};

/** The sentence(s) that replace the generic onboarding welcome copy. */
export function buildOnboardingIntro(spoke: string | null, friction: string | null): string | null {
  const phrase = spoke ? EVENT_PHRASE[spoke] : null;
  if (!phrase) return null;
  const parts = [
    `You told Georgia you're here because of ${phrase}, so we've already filled in what you've shared and won't ask you twice.`,
  ];
  if (friction && FRICTION_SENTENCE[friction]) parts.push(FRICTION_SENTENCE[friction]);
  return parts.join(" ");
}

/**
 * Copies the diagnostic's handoff into a brand-new household. Best-effort:
 * never blocks enrollment. Only fills wealth_event_type when it is still
 * empty, so it can never overwrite something a client or staff already set.
 */
export async function applyGeorgia2Handoff(client: any, householdId: string, email: string): Promise<void> {
  if (!email) return;
  try {
    const { data: lead } = await client
      .from("georgia2_leads")
      .select("catalyst, spoke, primary_friction")
      .ilike("email", email)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lead) return;

    const spoke: string | null = lead.spoke ?? CATALYST_TO_SPOKE_NAME[lead.catalyst as string] ?? null;
    const wealthEvent = spoke ? SPOKE_TO_WEALTH_EVENT[spoke] : null;
    if (!spoke || !wealthEvent) return;

    const { data: hh } = await client
      .from("households")
      .select("wealth_event_type")
      .eq("id", householdId)
      .maybeSingle();
    if (hh?.wealth_event_type) return;

    await client
      .from("households")
      .update({
        wealth_event_type: wealthEvent,
        wealth_event_source: "georgia_diagnostic",
        onboarding_intro_text: buildOnboardingIntro(spoke, lead.primary_friction ?? null),
      })
      .eq("id", householdId);
  } catch (e) {
    console.error("[georgia-handoff] apply failed (non-fatal):", e);
  }
}
