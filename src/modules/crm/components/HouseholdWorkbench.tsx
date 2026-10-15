import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
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

const Step = ({ badge, title, body, reason, children }: { badge: string; title: string; body: string; reason?: string; children: ReactNode }) => (
  <div className="flex items-start gap-3">
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">{badge}</div>
    <div className="flex-1 space-y-1.5">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {reason && <p className="text-[11px] italic text-muted-foreground">{reason}</p>}
      <p className="text-xs text-muted-foreground">{body}</p>
      {children}
    </div>
  </div>
);

/**
 * The household's AI Workbench, showing only the steps that apply to this household right now (its journey, tier and review window).
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI Workbench</CardTitle>
        <p className="text-xs text-muted-foreground">What applies to this household right now.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown.length === 0 && <p className="text-xs text-muted-foreground">Nothing is due for this household at the moment.</p>}
        {shown.map((k, i) => <Step key={k} badge={String(i + 1)} title={STEPS[k].title} body={STEPS[k].body}>{actions[k]}</Step>)}
        {hidden.length > 0 && (
          <div className="border-t border-border pt-3">
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {more ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} More tools ({hidden.length})
            </button>
            {more && (
              <div className="mt-3 space-y-4">
                {hidden.map((k) => <Step key={k} badge="·" title={STEPS[k].title} body={STEPS[k].body} reason={decisions[k].reason}>{actions[k]}</Step>)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
