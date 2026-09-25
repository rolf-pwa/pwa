import { useGeorgia2 } from "./state";
import {
  CATALYST_DESCRIPTIONS,
  CATALYST_LABELS,
  CORPORATE_CATALYSTS,
  DOMAIN_GREETING,
  PERSONAL_CATALYSTS,
  type Catalyst,
} from "@/modules/intake/lib/derive";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { BackLink, OptionCard, Question, WizardProgress } from "./WizardParts";

export function StepCatalyst() {
  const { state, dispatch } = useGeorgia2();
  const catalysts: Catalyst[] =
    state.domain === "corporate" ? [...CORPORATE_CATALYSTS] : [...PERSONAL_CATALYSTS];

  return (
    <div>
      <WizardProgress />
      <Question number={2} hint={state.domain ? DOMAIN_GREETING[state.domain] : undefined}>
        What is the catalyst or origin of your wealth event?
      </Question>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {catalysts.map((c) => (
          <OptionCard
            key={c}
            title={CATALYST_LABELS[c]}
            description={CATALYST_DESCRIPTIONS[c]}
            selected={state.catalyst === c}
            onClick={() => {
              dispatch({ type: "set_catalyst", catalyst: c });
              trackGeorgia2({ catalyst: c });
            }}
          />
        ))}
      </div>
      <BackLink onClick={() => dispatch({ type: "set_step", step: 1 })} />
    </div>
  );
}
