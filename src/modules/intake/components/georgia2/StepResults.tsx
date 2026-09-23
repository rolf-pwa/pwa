import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { ArrowLeft, Calendar, Mail, Phone } from "lucide-react";
import {
  deriveResult,
  formatCAD,
  CATALYST_LABELS,
  type Pathway,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";

export function StepResults() {
  const { state, dispatch } = useGeorgia2();
  const rootRef = useRef<HTMLDivElement>(null);
  // The full recommendation stays hidden until the visitor clicks "See my
  // pathway" — that button now lives in StepDiagnostic, right below the
  // scale slider, so it dispatches "reveal_results" instead of local state.
  const revealed = state.resultsRevealed;
  if (!state.domain || !state.catalyst) return null;
  const result = deriveResult(state.domain);


  // Bring the results card into view once it's revealed, so the visitor
  // lands on the recommendation instead of having to scroll to find it.
  useEffect(() => {
    if (typeof window === "undefined" || !revealed) return;
    if (rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [revealed]);

  const pick = (p: Pathway) => {
    dispatch({ type: "set_pathway", pathway: p });
    trackGeorgia2({ chosen_pathway: p, reached_lead_capture: true, final_phase: "lead_capture" });
    dispatch({ type: "set_step", step: 5 });
  };

  return (
    <div ref={rootRef} className="space-y-6">

      {revealed && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {CATALYST_LABELS[state.catalyst]} · {formatCAD(state.scale)}
              </p>
              <h2 className="mt-1 text-2xl">Your Sovereignty Survey™ next step.</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "set_step", step: 3 })}>
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
                onClick={() => pick("survey")}
              >
                <Calendar className="mr-2 h-4 w-4 shrink-0" />
                Start the Sovereignty Survey — {formatCAD(result.surveyPrice)}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-auto w-full whitespace-normal py-3 text-center leading-snug"
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
                onClick={() => pick("confidential_roadmap")}
              >
                <Mail className="mr-2 h-4 w-4 shrink-0" />
                Just Email My Confidential Roadmap
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
