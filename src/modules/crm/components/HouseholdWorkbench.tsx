import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { getWorkbenchFacts } from "@/modules/crm/lib/reviewAgent";
import { STEP_ORDER, decideWorkbench, type StepKey, type WorkbenchFacts } from "@/modules/crm/lib/workbenchSteps";

const STEPS: Record<StepKey, { title: string; body: string }> = {
  guided_intake: { title: "Enroll in guided intake", body: "Send an existing client through the same guided wizard as a new client, no payment required." },
  stabilization_map: { title: "Stabilization Map", body: "Generate or review the household's one-page Sovereignty Survey." },
  portfolio_review: { title: "Portfolio Review", body: "Allocation against the Investor Profile and iA's model portfolio, returns, death benefit resets, and what the client sees." },
  sovereignty_review: { title: "Sovereignty Review", body: "A Quarterly Review for chartered households, or a Sovereignty Survey from the records on file when there is no Charter yet." },
  governance_audit: { title: "Quarterly Governance Audit", body: "Generate or review the household's full Sovereignty Governance Audit." },
  charter: { title: "Sovereignty Charter v2.0", body: "Capture Family Vision, Core Values, and System Grounding Principles, the Foundational Bedrock of this household's Charter." },
  causal_ai: { title: "Causal AI Workbench", body: "Staff assessment of the household's financial, relational, and emotional state, reconciled against real meeting transcripts." },
};

/** One tool: its name (the explanation is the hover text) and its button. A tool that is not due says why, in small print. */
const Step = ({ title, body, reason, children }: { title: string; body: string; reason?: string; children: ReactNode }) => (
  <div className="min-w-0 space-y-1.5" title={body} data-testid="workbench-step">
    <p className="truncate text-sm font-medium text-foreground">{title}</p>
    {children}
    {reason && <p className="text-[11px] italic text-muted-foreground">{reason}</p>}
  </div>
);

const GRID = "grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3";

/**
 * The household's tools, laid out across the page and showing only the steps that apply to this household right now (its journey, tier and review window).
 * Everything else sits under "More tools" with the reason, so nothing is ever unreachable.
 */
export function HouseholdWorkbench({ householdId, onboardingComplete, charterStarted, actions, today }: { householdId: string; onboardingComplete: boolean; charterStarted: boolean; actions: Record<StepKey, ReactNode>; today: string }) {
  const [facts, setFacts] = useState<WorkbenchFacts | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try { const f = await getWorkbenchFacts(householdId); if (live) setFacts(f); } catch { if (live) setFacts(null); }
    })();
    return () => { live = false; };
  }, [householdId]);

  const decisions = useMemo(() => decideWorkbench({ facts, onboardingComplete, charterStarted, today }), [facts, onboardingComplete, charterStarted, today]);
  const shown = STEP_ORDER.filter((k) => decisions[k].show);
  const hidden = STEP_ORDER.filter((k) => !decisions[k].show);

  return (
    <Card data-testid="household-tools">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Household tools</p>
          {hidden.length > 0 && (
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {more ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} More tools ({hidden.length})
            </button>
          )}
        </div>
        {shown.length === 0 ? <p className="text-xs text-muted-foreground">Nothing is due for this household at the moment.</p> : (
          <div className={GRID}>{shown.map((k) => <Step key={k} title={STEPS[k].title} body={STEPS[k].body}>{actions[k]}</Step>)}</div>
        )}
        {more && (
          <div className={`${GRID} border-t border-border pt-3`}>
            {hidden.map((k) => <Step key={k} title={STEPS[k].title} body={STEPS[k].body} reason={decisions[k].reason}>{actions[k]}</Step>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
