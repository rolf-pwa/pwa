import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { ArrowLeft, Calendar, Loader2, Mail, Phone } from "lucide-react";
import {
  computeGauges,
  deriveResult,
  formatCAD,
  CATALYST_LABELS,
  type Pathway,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";

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

  return (
    <div ref={rootRef} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {CATALYST_LABELS[state.catalyst]} · {formatCAD(state.scale)}
          </p>
          <h2 className="mt-1 text-2xl">Your Sovereignty Survey™ next step.</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "set_step", step: 4 })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <p className="text-[10px] uppercase tracking-widest text-primary">Rolf's Voice</p>
        <p className="mt-1 text-xs leading-relaxed text-foreground">
          The Sovereignty Survey is a three-step process built around exactly what you've just told
          Georgia. We take a look at your financial system and run an Immediate Risk Scan. Then we
          meet to go over the results of your audit — you walk away with a 30-Day Action Framework
          report. No pitch, no commitment beyond the session itself, just total clarity about your
          next steps.
        </p>
      </div>

      <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 md:p-6">
        <h3 className="text-lg md:text-xl">Your next step</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Based on what you've shared, the Sovereignty Survey is the right starting point.{" "}
          {formatCAD(result.surveyPrice)} for {result.domainLabel} situations like yours.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            size="lg"
            className="h-auto w-full whitespace-normal py-3 text-center leading-snug"
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
            className="h-auto w-full whitespace-normal py-3 text-center leading-snug"
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
            className="h-auto w-full whitespace-normal py-3 text-center leading-snug"
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
      </div>
    </div>
  );
}
