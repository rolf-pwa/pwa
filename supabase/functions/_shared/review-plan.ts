// The 90-day plan, derived from the cards' "Action required" lines so the plan never has to be typed twice. Pure: used
// by the generator and by the review page, which rebuilds the plan live as an advisor edits an action.
//
//   Days 1-30  (Immediate)              records, documents, scans, filings and renewals: the protective and administrative fixes
//   Days 31-60 (Structural)             money moves and structural changes: rebalancing, topping up, putting agreements in place
//   Days 61-90 (Governance)             ratifying the Charter and setting the review cadence

export interface PlanItem { title: string; detail: string }
export interface PlanFromActions { phase_1: PlanItem[]; phase_2: PlanItem[]; phase_3: PlanItem[] }
export interface PlanSourceCard { label: string; actions?: string[] }

const NO_ACTION = /^no action required\.?$/i;
const STRUCTURAL = /^(rebalance|move|fund|receive|add .* to reach|set aside|set a liquidity|purify|reduce passive|put a unanimous|interest of about)/i;
const GOVERNANCE = /^(draft and ratify|ratify)/i;

export function phaseOf(action: string): 1 | 2 | 3 {
  const a = action.trim();
  if (GOVERNANCE.test(a)) return 3;
  if (STRUCTURAL.test(a)) return 2;
  return 1;
}

/** One plan item per action line (title = the area it belongs to), sorted into the three phases, plus the review cadence. */
export function planFromCards(cards: PlanSourceCard[], mode: "quarterly" | "survey" = "quarterly"): PlanFromActions {
  const plan: PlanFromActions = { phase_1: [], phase_2: [], phase_3: [] };
  for (const c of cards) {
    for (const raw of c.actions ?? []) {
      const action = raw.trim();
      if (!action || NO_ACTION.test(action)) continue;
      plan[`phase_${phaseOf(action)}` as keyof PlanFromActions].push({ title: c.label, detail: action });
    }
  }
  // Closing step every plan carries: keep the review going.
  plan.phase_3.push(mode === "survey"
    ? { title: "Review cadence", detail: "Once the Charter is ratified, set a quarterly review so the system is checked against it." }
    : { title: "Next quarterly review", detail: "Run a Vault scan to refresh the statements and re-run this review at the start of next quarter." });
  return plan;
}
