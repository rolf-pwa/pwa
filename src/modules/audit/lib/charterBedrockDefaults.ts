import type { NamedItem } from "../hooks/useCharterIntake";

// Mirrors supabase/functions/charter-intake/index.ts's CORE_VALUES_DEFAULTS /
// GROUNDING_PRINCIPLES_DEFAULTS exactly -- keep both in sync if the source
// doc's standard titles ever change. Used here only as the "reset to
// standard" target, independent of whatever a household's own record
// currently holds (which may already have staff-edited titles).

export const CORE_VALUES_DEFAULTS: NamedItem[] = [
  { key: "autonomy_respect", title: "Individual Autonomy and Mutual Respect", description: "" },
  { key: "radical_transparency", title: "Radical Transparency and Honest Communication", description: "" },
  { key: "contribution_before_consumption", title: "Contribution Before Consumption", description: "" },
  { key: "community_stewardship", title: "Community and Enduring Stewardship", description: "" },
];

export const GROUNDING_PRINCIPLES_DEFAULTS: NamedItem[] = [
  { key: "separation", title: "Principle of Separation (Assets Serve the Mission)", description: "" },
  { key: "deceleration", title: "Principle of Deceleration (Equilibrium Over Impulse)", description: "" },
  { key: "fiduciary_alignment", title: "Principle of Fiduciary Alignment", description: "" },
  { key: "preparedness", title: "Principle of Preparedness", description: "" },
];
