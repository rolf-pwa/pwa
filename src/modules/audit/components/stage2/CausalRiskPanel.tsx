import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { riskLevel, type CausalEvaluation } from "../../lib/stage2";

const RISK_LABELS: Record<string, string> = {
  liquidity_depletion_risk: "Liquidity Depletion Risk",
  founder_identity_risk: "Founder Identity Detachment Risk",
};

function Bar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted" role="img" aria-label={`${value} out of 100`}>
      <div className={cn("h-full", className)} style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * Causal risk visualiser: current scores, the effect of each modelled
 * intervention (before -> after), and the step-by-step reasoning. Scores are
 * 0-100 index values from a deterministic model with provisional weights,
 * not probabilities -- the panel says so.
 */
export function CausalRiskPanel({ causal }: { causal: CausalEvaluation }) {
  if (!causal.assessment_id) {
    return <p className="text-sm text-muted-foreground">{causal.note ?? "No ontology assessment on file, so the causal model wasn't evaluated."}</p>;
  }
  const risks = Object.entries(causal.risks ?? {});
  const scored = risks.filter(([, v]) => v !== null) as Array<[string, number]>;
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Index scores (0–100) from a deterministic causal model with <strong>provisional weights</strong> — useful for comparing options, not a probability.
      </p>

      <section className="space-y-3" aria-label="Risk scores">
        {risks.map(([id, v]) => (
          <div key={id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{RISK_LABELS[id] ?? id}</span>
              {v === null ? <span className="text-muted-foreground">Not enough information</span> : <Badge variant="outline">{v} · {riskLevel(v).label}</Badge>}
            </div>
            {v !== null && <Bar value={v} className={riskLevel(v).tone} />}
          </div>
        ))}
        {scored.length === 0 && <p className="text-sm text-muted-foreground">The assessment doesn't have enough data to score any risk yet.</p>}
      </section>

      {(causal.interventions ?? []).map((iv) => (
        <section key={iv.intervention_id} className="space-y-2 rounded border p-3" aria-label={iv.label}>
          <h4 className="text-sm font-medium">What if: {iv.label.toLowerCase()}?</h4>
          {iv.effects.length === 0 && <p className="text-sm text-muted-foreground">No scored risk is affected.</p>}
          {iv.effects.map((e) => (
            <div key={e.risk} className="space-y-1 text-sm">
              <div className="flex justify-between"><span>{e.label}</span><span>{e.before} → <strong>{e.after}</strong> <span className={e.delta < 0 ? "text-emerald-700" : "text-red-700"}>({e.delta > 0 ? "+" : ""}{e.delta})</span></span></div>
              <div className="relative">
                <Bar value={e.before} className="bg-muted-foreground/30" />
                <div className="mt-1"><Bar value={e.after} className={riskLevel(e.after).tone} /></div>
              </div>
            </div>
          ))}
        </section>
      ))}

      {(causal.rule_flags ?? []).length > 0 && (
        <section className="space-y-1" aria-label="Rule flags">
          <h4 className="text-sm font-medium">Rule flags</h4>
          {causal.rule_flags!.map((f) => (
            <div key={f.rule_id} className="rounded border p-2 text-sm"><Badge variant="outline" className="mr-2">{f.severity}</Badge><strong>{f.risk_name}</strong><span className="block text-muted-foreground">{f.action}</span></div>
          ))}
        </section>
      )}

      {(causal.reasoning_steps ?? []).length > 0 && (
        <section aria-label="Reasoning">
          <h4 className="mb-1 text-sm font-medium">How the score was reached</h4>
          <ol className="space-y-1 border-l pl-3 text-sm">
            {causal.reasoning_steps!.map((s) => <li key={s.node}><strong>{s.label}</strong> <span className="text-muted-foreground">({Math.round(s.value * 100)})</span> — {s.because}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}
