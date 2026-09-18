import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";

// This is a client-side scripted visual sequence timed around ONE
// request/response to pm-ai-teammate-run -- not real multi-step agent
// autonomy. There is no tool-result feedback loop; the model never sees
// its own prior output. Do not extend this to imply real agentic iteration
// without first building actual multi-turn infrastructure, which does not
// exist anywhere in this codebase today.

const AI_TEAMMATE_STAGES = [
  { id: 1, title: "Research", hint: "Gathering task context" },
  { id: 2, title: "Plan", hint: "Deciding what to draft" },
  { id: 3, title: "Execute", hint: "Writing the draft" },
  { id: 4, title: "Iterate", hint: "Finishing touches" },
];

interface Props {
  /** True while the real pm-ai-teammate-run request is in flight. */
  active: boolean;
  /** Called once the brief stage-4 settle beat has played, after `active` goes false. */
  onSettled?: () => void;
}

/** Forked from OnboardingStepper.tsx's busy/spinner-on-active-step pattern. */
export function AiTeammateStepper({ active, onSettled }: Props) {
  const [stage, setStage] = useState(1);
  const startedRef = useRef(false);

  useEffect(() => {
    if (active) {
      startedRef.current = true;
      setStage(1);
      const interval = setInterval(() => {
        setStage((s) => (s < 3 ? s + 1 : s));
      }, 1100);
      return () => clearInterval(interval);
    }
    if (startedRef.current) {
      startedRef.current = false;
      setStage(4);
      const timeout = setTimeout(() => onSettled?.(), 500);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <ol className="flex items-stretch gap-2">
      {AI_TEAMMATE_STAGES.map((s) => {
        const done = s.id < stage;
        const isActive = s.id === stage;
        return (
          <li key={s.id} className="flex-1">
            <div
              className={cn(
                "rounded-lg border p-2 text-center transition-colors",
                isActive
                  ? "border-primary/50 bg-primary/10"
                  : done
                    ? "border-border bg-muted/40"
                    : "border-border/50 bg-muted/10 opacity-60",
              )}
            >
              <span
                className={cn(
                  "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  done
                    ? "bg-primary text-primary-foreground"
                    : isActive
                      ? "border border-primary/60 text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {isActive && active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  s.id
                )}
              </span>
              <p className="mt-1 text-[11px] font-medium">{s.title}</p>
              <p className="text-[10px] text-muted-foreground">{s.hint}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
