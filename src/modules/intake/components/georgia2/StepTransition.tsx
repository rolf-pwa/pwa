import { useGeorgia2 } from "./state";
import {
  CATALYST_DESCRIPTIONS,
  CATALYST_LABELS,
  CATALYST_SPOKE,
  TRANSITION_CATALYSTS,
  domainForCatalyst,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { OptionCard, Question, WizardProgress } from "./WizardParts";

// Step 1 -- the single opening question. Choosing a transition sets the
// spoke (and, derived from it, the corporate/personal domain).
export function StepTransition() {
  const { state, dispatch } = useGeorgia2();

  return (
    <div>
      <WizardProgress />
      <Question number={1} hint="Your answer shapes everything that follows. Pick the closest match.">
        What type of transition brought you here today?
      </Question>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {TRANSITION_CATALYSTS.map((c) => (
          <OptionCard
            key={c}
            title={CATALYST_LABELS[c]}
            description={CATALYST_DESCRIPTIONS[c]}
            selected={state.catalyst === c}
            onClick={() => {
              dispatch({ type: "set_catalyst", catalyst: c });
              trackGeorgia2({
                catalyst: c,
                domain: domainForCatalyst(c),
                spoke: CATALYST_SPOKE[c],
                final_phase: "chat",
                step_catalyst_reached_at: new Date().toISOString(),
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}
