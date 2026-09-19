import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { HouseholdCharter } from "../../hooks/useCharterIntake";

interface Props {
  charter: HouseholdCharter;
  completing: boolean;
  onComplete: () => void;
}

export function StepReview({ charter, completing, onComplete }: Props) {
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Review &amp; Complete</h2>
          <p className="text-sm text-muted-foreground">
            Confirm the Foundational Bedrock below before marking it complete. You can come back and edit
            any of this later.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Family Vision</h3>
          {charter.vision_text?.trim() ? (
            <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">
              {charter.vision_text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not yet written.</p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Core Values</h3>
          <div className="space-y-2">
            {charter.core_values.map((v) => (
              <div key={v.key} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">{v.title}</p>
                {v.description.trim() && <p className="mt-1 text-sm text-muted-foreground">{v.description}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            System Grounding Principles
          </h3>
          <div className="space-y-2">
            {charter.grounding_principles.map((p) => (
              <div key={p.key} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">{p.title}</p>
                {p.description.trim() && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
              </div>
            ))}
          </div>
        </div>

        {charter.status === "complete" ? (
          <p className="text-sm font-medium text-emerald-600">
            Marked complete{charter.completed_at ? ` on ${new Date(charter.completed_at).toLocaleDateString()}` : ""}.
          </p>
        ) : (
          <Button
            disabled={completing}
            title={!charter.vision_text?.trim() ? "Family Vision is still empty — you can complete anyway." : undefined}
            onClick={onComplete}
          >
            {completing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Mark Bedrock Complete
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
