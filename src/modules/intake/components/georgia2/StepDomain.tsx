import { useGeorgia2 } from "./state";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";
import { OptionCard, Question, WizardProgress } from "./WizardParts";

export function StepDomain() {
  const { state, dispatch } = useGeorgia2();

  const choose = (d: "corporate" | "personal") => {
    dispatch({ type: "set_domain", domain: d });
    trackGeorgia2({ domain: d, final_phase: "chat" });
  };

  return (
    <div>
      <WizardProgress />
      <Question number={1} hint="Your answer routes the entire diagnostic. Everything else adapts from here.">
        Which wealth event brings you here?
      </Question>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <OptionCard
          title="Corporate Wealth Event"
          description="Founder exits, restructures, venture liquidity — capital moving through a corporation."
          selected={state.domain === "corporate"}
          onClick={() => choose("corporate")}
        />
        <OptionCard
          title="Personal Wealth Event"
          description="Inheritance, severance, divorce, settlements, or personal windfalls."
          selected={state.domain === "personal"}
          onClick={() => choose("personal")}
        />
      </div>
    </div>
  );
}
