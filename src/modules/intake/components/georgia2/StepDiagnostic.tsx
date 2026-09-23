import { useEffect, useRef } from "react";
import { useGeorgia2 } from "./state";
import { Button } from "@/shared/components/ui/button";
import { Slider } from "@/shared/components/ui/slider";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import {
  CATALYST_QUESTIONS,
  formatCAD,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  
  deriveResult,
} from "@/modules/intake/lib/derive";
import { cn } from "@/shared/lib/utils";
import { trackGeorgia2 } from "@/modules/intake/lib/session-tracker";

export function StepDiagnostic() {
  const { state, dispatch } = useGeorgia2();
  const questions = state.catalyst ? CATALYST_QUESTIONS[state.catalyst] : [];
  const allAnswered = questions.every((q) => state.answers[q.key]);
  const result = state.domain ? deriveResult(state.domain, state.scale) : null;
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // On stacked/mobile layouts, bring the next unanswered question into view
  // after each answer so the visitor doesn't have to scroll down manually.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return; // side-by-side layout already shows everything
    const next = questions.find((q) => !state.answers[q.key]);
    if (next && questionRefs.current[next.key]) {
      questionRefs.current[next.key].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state.answers, questions]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl">A few grounded questions.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No right answers. Each response quietly shapes your blueprint on the right.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "set_step", step: 2 })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="space-y-4">
        {questions.map((q) => {
          const value = state.answers[q.key] ?? null;
          return (
            <div
              key={q.key}
              ref={(el) => {
                questionRefs.current[q.key] = el;
              }}
              className="rounded-lg border border-border bg-card p-4"
            >
              <p className="text-sm font-medium">{q.text}</p>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                <span>{q.tooltip}</span>
              </p>
              <div className="mt-3 grid gap-2">
                {q.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      dispatch({ type: "set_answer", key: q.key, value: o.id });
                      const nextAnswers = { ...state.answers, [q.key]: o.id };
                      trackGeorgia2({ answers: nextAnswers as Record<string, unknown> });
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      value === o.id
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-background hover:border-accent/60"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium">Scale of Capital Transfer</span>
          <span className="font-serif text-2xl">{formatCAD(state.scale)}</span>
        </div>
        <div className="relative pt-2">
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
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">

          <span>{formatCAD(SCALE_MIN)}</span>
          <span>{formatCAD(SCALE_MAX)}</span>
        </div>
        {result && allAnswered && (
          <Button
            size="lg"
            className="mt-4 w-full"
            onClick={() => dispatch({ type: "set_step", step: 4 })}
          >
            Continue <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}

      </div>

    </div>
  );
}
