import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { questionsFor } from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { BackLink, OptionCard, Question, WizardProgress, wizardProgress } from "./WizardParts";

// One screen per question -- person-first (nervous system, governance,
// advisory), then the catalyst-specific ones. Picking an answer advances
// automatically after a beat (long enough to see the selection register);
// Back walks the same screens in reverse.
export function StepDiagnostic() {
  const { state, dispatch } = useGeorgia2();
  const questions = state.catalyst ? questionsFor(state.catalyst) : [];
  const index = state.questionIndex;
  const question = questions[index];
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const { n } = wizardProgress(state);
  if (!question) return null;

  const isLast = index >= questions.length - 1;
  const value = state.answers[question.key] ?? null;

  const back = () => {
    if (index > 0) dispatch({ type: "set_question_index", index: index - 1 });
    else dispatch({ type: "set_step", step: 2 });
  };

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
            description={o.description}
            selected={value === o.id}
            onClick={() => {
              dispatch({ type: "set_answer", key: question.key, value: o.id });
              trackGeorgia2({ answers: { ...state.answers, [question.key]: o.id } as Record<string, unknown> });
              clearTimeout(advanceTimer.current);
              advanceTimer.current = setTimeout(() => {
                if (isLast) dispatch({ type: "set_step", step: 4 });
                else dispatch({ type: "set_question_index", index: index + 1 });
              }, 180);
            }}
          />
        ))}
      </div>
      <BackLink onClick={back} />
    </div>
  );
}
