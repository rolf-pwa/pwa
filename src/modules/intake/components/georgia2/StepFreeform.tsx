import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { useGeorgia2 } from "./state";
import { analyzeFreeform } from "./analyze";
import { BackLink, Question, WizardProgress, wizardProgress } from "./WizardParts";

const MAX_LENGTH = 1000;

// The optional last question: an open text box, in the visitor's own words.
// What they write is screened for safety before anything else happens; the
// answer to "is it safe to proceed as normal" is decided server-side, and if
// the screening service is unavailable the visitor simply carries on.
export function StepFreeform() {
  const { state, dispatch } = useGeorgia2();
  const { n } = wizardProgress(state);
  const [working, setWorking] = useState(false);
  const [piiNotice, setPiiNotice] = useState(false);
  const text = state.freeformText;

  const goToGate = () => dispatch({ type: "set_step", step: 3 });

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      dispatch({ type: "set_freeform_result", result: null });
      goToGate();
      return;
    }
    // Unchanged since it was last analyzed: reuse that result.
    const prior = state.freeformResult;
    if (prior && prior.text === trimmed) {
      if (prior.threat_detected) dispatch({ type: "set_step", step: 5 });
      else goToGate();
      return;
    }
    setWorking(true);
    setPiiNotice(false);
    const outcome = await analyzeFreeform(state.sessionKey, trimmed);
    setWorking(false);
    if (outcome.kind === "pii") {
      setPiiNotice(true);
      return;
    }
    if (outcome.kind === "ok") {
      dispatch({ type: "set_freeform_result", result: outcome.result });
      if (outcome.result.threat_detected) {
        dispatch({ type: "set_step", step: 5 });
        return;
      }
    }
    goToGate();
  };

  return (
    <div>
      <WizardProgress />
      <Question
        number={n}
        hint="Optional. Anything you'd like us to understand that the questions didn't ask, in your own words."
      >
        Is there anything else weighing on you?
      </Question>
      <div className="mt-8">
        <Textarea
          value={text}
          onChange={(e) => {
            setPiiNotice(false);
            dispatch({ type: "set_freeform_text", text: e.target.value.slice(0, MAX_LENGTH) });
          }}
          rows={6}
          maxLength={MAX_LENGTH}
          placeholder="What's on your mind, what you're hoping for, and anything weighing on you right now."
          className="bg-muted/40"
          aria-label="Anything else weighing on you"
        />
        <div className="mt-2 flex items-start justify-between gap-4 text-xs text-muted-foreground">
          <span>
            Please leave out account numbers, SIN, or health details — we'll gather anything sensitive securely later.
          </span>
          <span className="shrink-0 tabular-nums">
            {text.length}/{MAX_LENGTH}
          </span>
        </div>
        {piiNotice && (
          <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            That looks like it includes an account number, SIN, or health detail. Please remove it and try again, or
            skip this question.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between">
        <BackLink onClick={() => dispatch({ type: "set_question_index", index: state.questionIndex - 1 })} />
        <Button size="lg" className="mt-8" onClick={submit} disabled={working}>
          {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {text.trim() ? "Continue" : "Skip"}
        </Button>
      </div>
    </div>
  );
}
