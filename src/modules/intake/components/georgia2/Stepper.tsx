import { cn } from "@/shared/lib/utils";
import { Check } from "lucide-react";

const STEPS = [
  { n: 1, label: "Domain" },
  { n: 2, label: "Catalyst" },
  { n: 3, label: "Diagnostic" },
  { n: 4, label: "Confidential" },
  { n: 5, label: "Pathway" },
];

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const done = current > s.n;
        const active = current === s.n;
        return (
          <li key={s.n} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-accent bg-accent text-accent-foreground",
                !done && !active && "border-border bg-muted text-muted-foreground"
              )}
            >
              {done ? <Check className="h-3 w-3" /> : s.n}
            </div>
            <span
              className={cn(
                "hidden md:inline",
                active ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border md:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
