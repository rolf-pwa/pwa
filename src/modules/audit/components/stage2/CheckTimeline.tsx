import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { type Stage2Check } from "../../lib/stage2";

const ICON = {
  pass: { Icon: CheckCircle2, tone: "text-emerald-600", label: "Passed" },
  fail: { Icon: XCircle, tone: "text-red-600", label: "Failed" },
  skipped: { Icon: MinusCircle, tone: "text-amber-600", label: "Couldn't run" },
} as const;

/** Plain-English reasoning chain: one step per Stage 2 check. Selecting a step highlights its item. */
export function CheckTimeline({ checks, onSelect }: { checks: Stage2Check[]; onSelect?: (check: Stage2Check) => void }) {
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">No checks were recorded.</p>;
  return (
    <ol className="space-y-2">
      {checks.map((c, i) => {
        const { Icon, tone, label } = ICON[c.status];
        return (
          <li key={i}>
            <button type="button" onClick={() => onSelect?.(c)} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} aria-label={label} />
              <span>
                <span className="font-medium">{c.id.replace(/_/g, " ")}</span>
                {c.subject ? <span className="text-muted-foreground"> · {c.subject}</span> : null}
                <span className="block text-muted-foreground">{c.reasoning}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
