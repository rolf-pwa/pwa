import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Calendar, Loader2, Mail, Phone, ShieldCheck } from "lucide-react";
import {
  bcContextNotes,
  computeGauges,
  deriveResult,
  formatCAD,
  georgiaInsights,
  CATALYST_LABELS,
  type Pathway,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { cn } from "@/shared/lib/utils";
import { BackLink } from "./WizardParts";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// This is now the step-5 screen -- reached only once lead capture (step 4)
// has already validated and collected contact info, so it's always ready
// to render (no separate "revealed" gate needed anymore, unlike the
// original build where this lived in the results pane and toggled
// visibility in place).
export function StepResults() {
  const { state, dispatch } = useGeorgia2();
  const rootRef = useRef<HTMLDivElement>(null);
  if (!state.domain || !state.catalyst) return null;
  const result = deriveResult(state.domain);

  // Bring the recommendation card into view on mount, matching every other
  // step's own scroll-into-view convention.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Actual lead submission now happens here, once contact info (already
  // collected at step 4) and a chosen pathway are both known -- moved from
  // the old StepLeadCapture.submit(), which used to run this after the
  // pathway was already picked. Reordering the flow (capture contact info
  // before revealing the pathway) meant this had to move with it.
  const submit = async (pathway: Pathway) => {
    if (!state.domain || !state.catalyst) return;
    dispatch({ type: "set_pathway", pathway });
    dispatch({ type: "submitting", value: true });
    dispatch({ type: "submit_error", error: null });
    try {
      const gauges = computeGauges(state.domain, state.catalyst, state.answers, state.scale);
      const res = await fetch(`${FUNCTIONS_URL}/georgia2-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: state.sessionKey,
          first_name: state.contact.first_name,
          email: state.contact.email,
          mobile: state.contact.mobile || null,
          domain: state.domain,
          catalyst: state.catalyst,
          chosen_pathway: pathway,
          scale: state.scale,
          answers: state.answers,
          risk_scores_calculated: {
            tax_drag_risk: gauges.taxDragRisk,
            structure_safety: gauges.structureSafety,
            noise_strain: gauges.noiseStrain,
            readiness_score: gauges.readiness,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Submission failed (${res.status})`);
      }
      trackGeorgia2({ lead_captured: true, final_phase: "complete", ended: true });

      if (pathway === "survey") {
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
        return;
      }
      dispatch({ type: "set_step", step: 6 });
    } catch (err) {
      dispatch({
        type: "submit_error",
        error: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      dispatch({ type: "submitting", value: false });
    }
  };

  const gauges = computeGauges(state.domain, state.catalyst, state.answers, state.scale);
  const directives = georgiaInsights(state.domain, state.catalyst, state.answers, state.scale).filter(
    (i) => i.tag !== "Your Next Step"
  );
  const bcNotes = bcContextNotes(state.domain, state.catalyst, state.answers);

  return (
    <div ref={rootRef}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Diagnostic completed
          </p>
          <h2 className="mt-2 font-serif text-3xl leading-tight md:text-4xl">Your Sovereignty Snapshot</h2>
        </div>
        <p className="shrink-0 text-right text-sm text-muted-foreground">
          {CATALYST_LABELS[state.catalyst]}
          <br />
          {formatCAD(state.scale)}
        </p>
      </div>

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
            {directives.map((d, i) => (
              <div key={i} className="rounded-md border border-border bg-muted/40 px-5 py-4">
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
        <h3 className="font-serif text-2xl">Your next step</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The Sovereignty Survey is built around exactly what you've just told Georgia: we review your financial
          system, run an Immediate Risk Scan, then meet to walk through the results — you leave with a 30-Day Action
          Framework. {formatCAD(result.surveyPrice)} for {result.domainLabel} situations like yours. No pitch, no
          commitment beyond the session itself.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            size="lg"
            className="h-auto w-full whitespace-normal py-3.5 text-center leading-snug"
            onClick={() => submit("survey")}
            disabled={state.submitting}
          >
            {state.submitting ? (
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
            disabled={state.submitting}
            onClick={() => {
              trackGeorgia2({ chosen_pathway: "clarity_call" });
              window.open("https://www.prosperwise.ca/clarity-call", "_blank", "noopener,noreferrer");
            }}
          >
            <Phone className="mr-2 h-4 w-4 shrink-0" />
            Talk It Through
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="h-auto w-full whitespace-normal py-3.5 text-center leading-snug"
            disabled={state.submitting}
            onClick={() => submit("confidential_roadmap")}
          >
            {state.submitting ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4 shrink-0" />
            )}
            Just Email My Confidential Roadmap
          </Button>
        </div>
        {state.submitError && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {state.submitError}
          </div>
        )}
        <BackLink onClick={() => dispatch({ type: "set_step", step: 4 })} />
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
