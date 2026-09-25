import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Slider } from "@/shared/components/ui/slider";
import { ArrowRight } from "lucide-react";
import {
  CATALYST_QUESTIONS,
  formatCAD,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { BackLink, OptionCard, Question, WizardProgress, wizardProgress } from "./WizardParts";

// One screen per question, then a final scale-of-capital screen. Picking an
// answer advances automatically after a beat (long enough to see the
// selection register); Back walks the same screens in reverse.
export function StepDiagnostic() {
  const { state, dispatch } = useGeorgia2();
  const questions = state.catalyst ? CATALYST_QUESTIONS[state.catalyst] : [];
  const index = state.questionIndex;
  const question = questions[index];
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const { n } = wizardProgress(state);

  const back = () => {
    if (index > 0) dispatch({ type: "set_question_index", index: index - 1 });
    else dispatch({ type: "set_step", step: 2 });
  };

  if (question) {
    const value = state.answers[question.key] ?? null;
    return (
      <div>
        <WizardProgress />
        <Question number={n} hint={question.tooltip}>
          {question.text}
        </Question>
        <div className="mt-8 grid gap-3">
          {question.options.map((o) => (
            <OptionCard
              key={o.id}
              title={o.label}
              selected={value === o.id}
              onClick={() => {
                dispatch({ type: "set_answer", key: question.key, value: o.id });
                trackGeorgia2({ answers: { ...state.answers, [question.key]: o.id } as Record<string, unknown> });
                clearTimeout(advanceTimer.current);
                advanceTimer.current = setTimeout(
                  () => dispatch({ type: "set_question_index", index: index + 1 }),
                  180
                );
              }}
            />
          ))}
        </div>
        <BackLink onClick={back} />
      </div>
    );
  }

  return (
    <div>
      <WizardProgress />
      <Question
        number={n}
        hint="An approximate figure is fine — it calibrates the tax and structure exposure in your results."
      >
        What is the approximate scale of the capital transfer?
      </Question>
      <div className="mt-8 rounded-md border border-border bg-muted/40 px-5 py-6">
        <p className="text-center font-serif text-4xl">{formatCAD(state.scale)}</p>
        <div className="mt-6">
          <Slider
            value={[state.scale]}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            onValueChange={(v) => {
              dispatch({ type: "set_scale", scale: v[0] });
              trackGeorgia2({ scale: v[0] });
            }}
          />
        </div>
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
          <span>{formatCAD(SCALE_MIN)}</span>
          <span>{formatCAD(SCALE_MAX)}</span>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <BackLink onClick={back} />
        <Button size="lg" className="mt-8" onClick={() => dispatch({ type: "set_step", step: 4 })}>
          Continue <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
