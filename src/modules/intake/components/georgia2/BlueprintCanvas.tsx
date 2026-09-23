import { useGeorgia2 } from "./state";
import {
  CATALYST_LABELS,
  CATALYST_TIMELINES,
  bcContextNotes,
  computeGauges,
  
  georgiaInsights,
  hasDiagnosticInput,
  timelineStageIndex,
} from "@/modules/intake/lib/derive";
import { cn } from "@/shared/lib/utils";

export function BlueprintCanvas() {
  const { state } = useGeorgia2();
  const answered = hasDiagnosticInput(state.catalyst, state.answers);
  const gauges = computeGauges(state.domain, state.catalyst, state.answers, state.scale);
  const notes = bcContextNotes(state.domain, state.catalyst, state.answers);
  const insights = georgiaInsights(state.domain, state.catalyst, state.answers, state.scale);
  const riskNotes = insights.filter((i) => i.tag !== "Your Next Step");
  const timeline = state.catalyst ? CATALYST_TIMELINES[state.catalyst] : null;
  // The gauges themselves (numbers/bars above) stay visible throughout as
  // the "watch your blueprint build live" hook -- only the written-out
  // narrative content is gated, and only until lead capture (step 4) is
  // actually submitted (step 5+), not merely reached.
  const narrativesUnlocked = state.step >= 5;
  const currentStage = timeline
    ? timelineStageIndex(state.catalyst, state.answers, timeline.length)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Generative Blueprint
        </p>
        <h3 className="mt-1 font-serif text-xl">
          {state.catalyst ? CATALYST_LABELS[state.catalyst] : "Awaiting inputs…"}
        </h3>
        <p className="text-sm text-muted-foreground">
          Live-render updates as you answer.
        </p>
      </div>

      {/* Timeline */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {state.catalyst
            ? `Where you are in the ${CATALYST_LABELS[state.catalyst].replace(/ Planning$/, "")} process`
            : "Where you are in your process"}
        </p>
        <div className="rounded-lg border border-border bg-card p-4">
          {timeline ? (
            <ol className="flex items-start justify-between gap-2">
              {timeline.map((m, i) => {
                const done = i < currentStage;
                const current = i === currentStage;
                return (
                  <li key={m.label} className="flex-1 text-center">
                    <div className="relative mx-auto mb-2 flex h-6 items-center justify-center">
                      {i > 0 && (
                        <span
                          className={cn(
                            "absolute left-0 right-1/2 top-1/2 h-px",
                            i <= currentStage ? "bg-accent" : "bg-border"
                          )}
                        />
                      )}
                      {i < timeline.length - 1 && (
                        <span
                          className={cn(
                            "absolute left-1/2 right-0 top-1/2 h-px",
                            i < currentStage ? "bg-accent" : "bg-border"
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors duration-500",
                          done && "border-accent bg-accent text-background",
                          current && "border-border bg-background text-muted-foreground",
                          !done && !current && "border-border bg-background text-muted-foreground"
                        )}
                      >
                        {i + 1}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "text-xs leading-tight",
                        done ? "font-semibold text-accent" : "font-medium"
                      )}
                    >
                      {m.label}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                      {m.detail}
                    </p>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">Pick a catalyst to render your timeline.</p>
          )}
        </div>
      </div>

      {/* Gauges */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Risk Metrics
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Gauge label="Tax Drag Risk" value={answered ? gauges.taxDragRisk : null} tone="risk" />
          <Gauge
            label="Structure Safety"
            value={answered ? gauges.structureSafety : null}
            tone="safety"
          />
          <Gauge label="Noise Strain" value={answered ? gauges.noiseStrain : null} tone="risk" />
          <Gauge label="Readiness" value={answered ? gauges.readiness : null} tone="safety" />
        </div>
        {!answered && (
          <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Awaiting answers
          </p>
        )}
        {narrativesUnlocked && riskNotes.length > 0 && (
          <div className="mt-3 space-y-2">
            {riskNotes.map((ins, i) => (
              <div key={i} className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                <p className="text-[10px] uppercase tracking-widest text-accent">{ins.tag}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground">{ins.body}</p>
              </div>
            ))}
          </div>
        )}
        {!narrativesUnlocked && answered && riskNotes.length > 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Georgia has notes on your risk profile — complete your confidential details to unlock them.
            </p>
          </div>
        )}
      </div>

      {/* BC Context */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          British Columbia Context
        </p>
        <div className="rounded-lg border border-border bg-card p-4">
          {narrativesUnlocked ? (
            <ul className="space-y-2">
              {notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {notes.length > 0
                ? "Complete your confidential details to unlock your BC-specific context."
                : "Complete Steps 1–3 to reveal your BC-specific context."}
            </p>
          )}
        </div>
      </div>

    </div>
  );
}

function Gauge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "risk" | "safety";
}) {
  const isBad = value === null ? false : tone === "risk" ? value >= 60 : value < 40;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium">{label}</p>
        <p
          className={cn(
            "text-xs font-medium",
            value === null ? "text-muted-foreground" : isBad ? "text-destructive" : "text-primary"
          )}
        >
          {value === null ? "—" : value}
        </p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isBad ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}
