import { useEffect, useRef, useState } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Calendar, Loader2, Phone, ShieldCheck } from "lucide-react";
import {
  ACTION_PLAN,
  bcContextNotes,
  computeGauges,
  deriveResult,
  formatCAD,
  georgiaInsights,
  CATALYST_LABELS,
} from "@/modules/intake/lib/derive";
import { cn } from "@/shared/lib/utils";
import { BackLink } from "./WizardParts";
import { submitLead } from "./submitLead";

// Step 4 -- reached only once lead capture (step 3) has been submitted, which
// also emailed these results automatically. The two calls to action below
// just record which next step the visitor picked on their existing lead.
export function StepResults() {
  const { state, dispatch } = useGeorgia2();
  const rootRef = useRef<HTMLDivElement>(null);
  const [startingSurvey, setStartingSurvey] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!state.domain || !state.catalyst) return null;
  const result = deriveResult(state.domain);
  const gauges = computeGauges(state.domain, state.catalyst, state.answers);
  const directives = georgiaInsights(state.domain, state.catalyst, state.answers).filter(
    (i) => i.tag !== "Your Next Step"
  );
  const bcNotes = bcContextNotes(state.domain, state.catalyst, state.answers);

  const startSurvey = async () => {
    dispatch({ type: "set_pathway", pathway: "survey" });
    setStartingSurvey(true);
    // Recording the pick is best-effort -- never block them from proceeding.
    try {
      await submitLead(state, "survey");
    } catch {
      /* the lead already exists from the contact step */
    }
    const url = "https://www.prosperwise.ca/sovereignty-audit#pricing";
    // Break out of the embed iframe so the visitor lands on the real page.
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const talkItThrough = () => {
    dispatch({ type: "set_pathway", pathway: "clarity_call" });
    submitLead(state, "clarity_call").catch(() => {});
    window.open("https://www.prosperwise.ca/clarity-call", "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={rootRef}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Diagnostic completed
          </p>
          <h2 className="mt-2 font-serif text-3xl leading-tight md:text-4xl">Your Sovereignty Snapshot</h2>
        </div>
        <p className="shrink-0 text-right text-sm text-muted-foreground">{CATALYST_LABELS[state.catalyst]}</p>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        A copy is on its way to <span className="text-foreground">{state.contact.email}</span>.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6">
        <Gauge label="Tax Drag Risk" value={gauges.taxDragRisk} tone="risk" />
        <Gauge label="Structure Safety" value={gauges.structureSafety} tone="safety" />
        <Gauge label="Noise Strain" value={gauges.noiseStrain} tone="risk" />
        <Gauge label="Readiness" value={gauges.readiness} tone="safety" />
      </div>

      {directives.length > 0 && (
        <div className="mt-8">
          <h3 className="font-sans text-sm font-semibold uppercase tracking-wider">Prescribed directives</h3>
          <div className="mt-3 space-y-3">
            {directives.map((d) => (
              <div key={d.tag} className="rounded-md border border-border bg-muted/40 px-5 py-4">
                <p className="flex items-center gap-2 font-sans text-base font-medium text-accent">
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  {d.tag}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {bcNotes.length > 0 && (
        <div className="mt-8">
          <h3 className="font-sans text-sm font-semibold uppercase tracking-wider">British Columbia context</h3>
          <ul className="mt-3 space-y-2">
            {bcNotes.map((n, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 border-t border-border pt-8">
        <h3 className="font-serif text-2xl">Your action plan</h3>
        <ol className="mt-4 space-y-3">
          {ACTION_PLAN.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-md border border-border bg-muted/40 px-5 py-4">
              <span className="font-serif text-2xl leading-none text-accent">{i + 1}</span>
              <div>
                <p className="font-sans text-base font-medium">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            size="lg"
            className="h-auto w-full whitespace-normal py-3.5 text-center leading-snug"
            onClick={startSurvey}
            disabled={startingSurvey}
          >
            {startingSurvey ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Calendar className="mr-2 h-4 w-4 shrink-0" />
            )}
            Start the Sovereignty Survey — {formatCAD(result.surveyPrice)}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-auto w-full whitespace-normal py-3.5 text-center leading-snug"
            disabled={startingSurvey}
            onClick={talkItThrough}
          >
            <Phone className="mr-2 h-4 w-4 shrink-0" />
            Talk It Through
          </Button>
        </div>
        <BackLink onClick={() => dispatch({ type: "set_step", step: 3 })} />
      </div>
    </div>
  );
}

function Gauge({ label, value, tone }: { label: string; value: number; tone: "risk" | "safety" }) {
  const isBad = tone === "risk" ? value >= 60 : value < 40;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">{label}</p>
        <p className={cn("font-serif text-2xl", isBad ? "text-destructive" : "text-primary")}>{value}</p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", isBad ? "bg-destructive" : "bg-primary")}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
