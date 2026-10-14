import { Check, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface OnboardingStepMeta {
  id: number;
  title: string;
  hint: string;
}

export const ONBOARDING_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Your household", hint: "Who we'll be working with" },
  { id: 2, title: "Your wealth event", hint: "What brought you here" },
  { id: 3, title: "A bit more context", hint: "Personal sudden-wealth events only" },
  { id: 4, title: "Your documents", hint: "Upload what you have" },
  { id: 5, title: "Book your Survey Session", hint: "Pick the time that suits you" },
];

/** Legacy upgrades (existing clients staff enrolled) skip the payment-track
 *  audit booking and wealth-event framing entirely — different order, different
 *  steps. */
export const LEGACY_ONBOARDING_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Household info", hint: "Confirm what's on file" },
  { id: 2, title: "Vision & values", hint: "What matters most to you" },
  { id: 3, title: "Your documents", hint: "Upload what you have" },
  { id: 4, title: "Book your meeting", hint: "Schedule your session" },
];

interface Props {
  current: number;
  furthest: number;
  onSelect: (step: number) => void;
  busy?: boolean;
  steps?: OnboardingStepMeta[];
}

/** Horizontal stepper for the guided survey onboarding. */
export const OnboardingStepper = ({ current, furthest, onSelect, busy, steps = ONBOARDING_STEPS }: Props) => (
  <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
    {steps.map((step) => {
      const done = step.id < furthest;
      const active = step.id === current;
      const unlocked = step.id <= furthest;
      return (
        <li key={step.id} className="flex-1">
          <button
            type="button"
            disabled={!unlocked}
            onClick={() => unlocked && onSelect(step.id)}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              active
                ? "border-primary/50 bg-primary/10"
                : unlocked
                  ? "border-border bg-card hover:bg-muted/50"
                  : "border-border/50 bg-muted/20 opacity-60 cursor-not-allowed",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border border-primary/60 text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {busy && active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  step.id
                )}
              </span>
              <span className="text-sm font-medium text-foreground font-serif">{step.title}</span>
            </div>
            <p className="mt-1 pl-8 text-xs text-muted-foreground">{step.hint}</p>
          </button>
        </li>
      );
    })}
  </ol>
);
