import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useGeorgia2, type Georgia2State } from "./state";
import { PERSON_QUESTIONS, questionsFor } from "@/modules/intake/lib/derive";
import { cn } from "@/shared/lib/utils";

// Used only until a catalyst is chosen and the real question count is known.
const ESTIMATED_QUESTION_COUNT = PERSON_QUESTIONS.length + 3;

export function wizardProgress(state: Georgia2State): { n: number; total: number; label: string } {
  const questions = state.catalyst ? questionsFor(state.catalyst) : null;
  const qCount = questions?.length ?? ESTIMATED_QUESTION_COUNT;
  // Domain, Catalyst, each question, Confidential.
  const total = qCount + 3;
  if (state.step === 1) return { n: 1, total, label: "Domain" };
  if (state.step === 2) return { n: 2, total, label: "Catalyst" };
  if (state.step === 3) {
    const q = questions?.[state.questionIndex];
    return { n: 3 + state.questionIndex, total, label: q ? q.key.replace(/_/g, " ") : "Diagnostic" };
  }
  return { n: total, total, label: "Confidential" };
}

export function WizardProgress() {
  const { state } = useGeorgia2();
  const { n, total, label } = wizardProgress(state);
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>
          Step {n} of {total}
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${(n / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Question({
  number,
  children,
  hint,
}: {
  number: number;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mt-10">
      <h2 className="font-serif text-2xl leading-snug md:text-3xl">
        {number}. {children}
      </h2>
      {hint && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function OptionCard({
  title,
  description,
  selected,
  onClick,
  disabled,
}: {
  title: string;
  description?: string;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-md border bg-muted/40 px-5 py-4 text-left transition-colors",
        "hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected ? "border-accent bg-accent/5" : "border-border"
      )}
    >
      <span className="text-base font-medium leading-snug">{title}</span>
      {description && <span className="text-sm leading-snug text-muted-foreground">{description}</span>}
    </button>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}
