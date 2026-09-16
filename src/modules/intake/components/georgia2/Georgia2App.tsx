import { useEffect, useRef } from "react";
import { Georgia2Provider, useGeorgia2 } from "./state";
import { Stepper } from "./Stepper";
import { StepDomain } from "./StepDomain";
import { StepCatalyst } from "./StepCatalyst";
import { StepDiagnostic } from "./StepDiagnostic";
import { StepResults } from "./StepResults";
import { StepLeadCapture } from "./StepLeadCapture";
import { StepSuccess } from "./StepSuccess";
import { BlueprintCanvas } from "./BlueprintCanvas";
import { trackGeorgia2, useGeorgia2ExitBeacon, type Georgia2SessionPatch } from "@/modules/intake/lib/session-tracker";

// Maps the Stepper's 5 labeled steps (Domain/Catalyst/Diagnostic/Pathway/
// Confidential) to their first-reach tracking field. state.step 3 and 4
// both render StepDiagnostic in the left pane (Diagnostic has two virtual
// sub-steps), but step 4 is also when the results pane's reveal becomes
// visible -- exactly what the Stepper itself labels "Pathway" -- so that's
// tracked as its own step here, matching how a visitor actually
// experiences the flow, not just which component is mounted.
const STEP_REACHED_FIELD: Record<number, keyof Georgia2SessionPatch> = {
  1: "step_domain_reached_at",
  2: "step_catalyst_reached_at",
  3: "step_diagnostic_reached_at",
  4: "step_pathway_reached_at",
  5: "step_confidential_reached_at",
};

function Shell({ embed }: { embed?: boolean }) {
  const { state } = useGeorgia2();
  const rootRef = useRef<HTMLDivElement>(null);
  useGeorgia2ExitBeacon(
    () => ({
      domain: state.domain,
      catalyst: state.catalyst,
      answers: state.answers as Record<string, unknown>,
      scale: state.scale,
      chosen_pathway: state.chosenPathway,
      reached_lead_capture: state.step >= 5,
      lead_captured: state.step >= 6,
      final_phase: state.step >= 6 ? "complete" : state.step >= 5 ? "lead_capture" : "chat",
    }),
    state.sessionKey
  );

  // First-reach funnel tracking: fires once per step per session (a Back
  // button revisit never re-sends an already-tracked step, so each column
  // stays a true first-reach time), so real drop-off between Domain,
  // Catalyst, Diagnostic, Pathway (the results reveal), and Confidential
  // (the contact-info ask) can finally be measured instead of guessed at.
  const trackedStepsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const field = STEP_REACHED_FIELD[state.step];
    if (!field || trackedStepsRef.current.has(state.step)) return;
    trackedStepsRef.current.add(state.step);
    trackGeorgia2({ [field]: new Date().toISOString() } as Georgia2SessionPatch);
  }, [state.step]);

  // Bring the top of the wizard back into view whenever the visitor advances
  // a step, so they don't have to scroll up manually. Step 4 is skipped because
  // StepResults scrolls to its own card header instead of the input pane above it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (state.step === 4) return; // results pane handles its own scroll target
    if (rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state.step]);

  // When embedded, report our real content height to the parent page so it
  // can size the iframe to fit — the marketing site already listens for this
  // (ask-georgia.html), it just never had anything sending it. ResizeObserver
  // catches every height change (step transitions, the results reveal toggle,
  // font/image load reflow) without hooking each one individually.
  useEffect(() => {
    if (!embed || typeof window === "undefined" || window.parent === window) return;
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      window.parent.postMessage({ height: el.scrollHeight }, "*");
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embed]);

  // embed mode must NOT use min-h-screen: the parent page sizes the iframe
  // box from our own reported scrollHeight (see the ResizeObserver effect
  // above). min-h-screen reads 100vh off the iframe's own current box
  // height, so it would make us always report back whatever height the
  // iframe already has -- a circular measurement that can never shrink to
  // the real content size.
  return (
    <div ref={rootRef} className={embed ? "bg-background" : "min-h-screen bg-background"}>
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        {!embed && (
          <div className="mb-6">
            <p className="text-xs uppercase tracking-widest text-accent">Georgia · Sovereignty Operating System™</p>
            <h1 className="mt-1 font-serif text-3xl md:text-4xl">Sovereignty Diagnostic</h1>

          </div>
        )}
        {state.step < 6 && (
          <div className="mb-6">
            <Stepper current={state.step} />
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {/* Input pane */}
          <div className="rounded-2xl border border-border bg-card p-5 md:p-8">
            {state.step === 1 && <StepDomain />}
            {state.step === 2 && <StepCatalyst />}
            {(state.step === 3 || state.step === 4) && <StepDiagnostic />}
            {state.step === 5 && <StepLeadCapture />}
            {state.step === 6 && <StepSuccess />}
          </div>

          {/* Results pane, side by side */}
            <aside className="space-y-6 rounded-2xl border border-border bg-muted/30 p-5 md:p-6">
              <BlueprintCanvas />
              {state.step >= 4 && <StepResults />}
            </aside>


        </div>

        <p className="mt-6 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
          Montréal Data Pinning · Zero Tracking Cookies · PIPEDA-Aligned
        </p>
      </div>
    </div>
  );
}

export function Georgia2App({ embed }: { embed?: boolean }) {
  return (
    <Georgia2Provider>
      <Shell embed={embed} />
    </Georgia2Provider>
  );
}
