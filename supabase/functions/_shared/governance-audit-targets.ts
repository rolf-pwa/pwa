// Select a target Income/Equity split for a client. Ported directly from
// the Review Agent prototype's calc/targets.py, adapted only to accept a
// plain Charter mission/tone summary string instead of a full extracted
// CharterProfile object -- this CRM's sovereignty_charters table already
// holds ratified Charter narrative text directly (mission_of_capital,
// vision_20_year, etc.), so there's no need to re-extract a CharterProfile
// from a scanned PDF the way the prototype does.
//
// Per Rolf: the Investor Risk Profile gives a *range* (e.g. Growth =
// 20-40% income / 60-80% equity), and the Charter's stated mission/tone is
// what determines where within that range a specific client should sit --
// the Charter is the source of truth, not the profile's own midpoint.
//
// Deliberately NOT automated by heuristic/LLM judgment here: when the
// prototype's author test-extracted the real Lively-Lambert Charter and
// asked the extraction model to characterize its tone, it concluded the
// Charter reads as *moderately* growth-oriented (hard non-alienation
// clause, $48k Keep floor, transition period) -- the opposite of the
// 80/20 aggressive-edge split the real advisor actually used for this
// client. That's a live demonstration that this specific judgment call is
// not safe to automate silently. So this module only computes the
// deterministic part (which range applies, and a default midpoint within
// it) and always surfaces the Charter's own tone summary text alongside
// it so the advisor makes the final call -- see `assumptions` on the
// returned TargetSelection.

import { RISK_PROFILE_RANGES } from "./governance-audit-tax-config.ts";

export interface TargetSelection {
  profileCategory: string;
  incomePctRange: [number, number];
  equityPctRange: [number, number];
  targetIncomePct: number;
  targetEquityPct: number;
  isAdvisorOverride: boolean;
  assumptions: string[];
}

export function selectTarget(
  investorProfile: { totalPoints: number | null; profileCategory: string },
  charterMissionToneSummary: string | null,
  opts: { formKey?: string; advisorTargetEquityPct?: number } = {},
): TargetSelection {
  const formKey = opts.formKey ?? "iaFinancialF51122a";
  const form = RISK_PROFILE_RANGES[formKey];
  if (!form) {
    throw new Error(`Unknown risk-profile form key "${formKey}" -- add it to governance-audit-tax-config.ts.`);
  }
  const band = form.bands.find((b) => b.profile === investorProfile.profileCategory);
  if (!band) {
    throw new Error(
      `Unknown profile_category "${investorProfile.profileCategory}" for form "${formKey}" -- add it to governance-audit-tax-config.ts.`,
    );
  }

  const incomeRange = band.range.incomePct;
  const equityRange = band.range.equityPct;

  const assumptions: string[] = [
    `Investor Profile scored ${investorProfile.totalPoints ?? "an unstated number of"} points -> '${investorProfile.profileCategory}' ` +
      `band (income ${incomeRange[0]}-${incomeRange[1]}%, equity ${equityRange[0]}-${equityRange[1]}%) per governance-audit-tax-config.ts (${formKey}).`,
  ];
  if (charterMissionToneSummary) {
    assumptions.push(
      "Charter mission/tone summary (use this to judge where in the range to target, then supply advisorTargetEquityPct to override the default midpoint used below): " +
        charterMissionToneSummary,
    );
  }

  let incomePct: number;
  let equityPct: number;
  let isOverride: boolean;
  if (typeof opts.advisorTargetEquityPct === "number") {
    equityPct = opts.advisorTargetEquityPct;
    incomePct = 100 - equityPct;
    assumptions.push(`Using advisor-supplied target: ${equityPct}% equity / ${incomePct}% income.`);
    isOverride = true;
  } else {
    incomePct = band.midpoint.incomePct;
    equityPct = band.midpoint.equityPct;
    assumptions.push(
      `No advisor override supplied -- defaulting to the '${investorProfile.profileCategory}' band's midpoint (${equityPct}% equity / ${incomePct}% income). ` +
        `This is a placeholder: confirm against the Charter tone summary above before finalizing.`,
    );
    isOverride = false;
  }

  return {
    profileCategory: investorProfile.profileCategory,
    incomePctRange: incomeRange,
    equityPctRange: equityRange,
    targetIncomePct: incomePct,
    targetEquityPct: equityPct,
    isAdvisorOverride: isOverride,
    assumptions,
  };
}
