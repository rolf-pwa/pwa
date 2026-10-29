import { useState } from "react";
import { Sprout } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import type { OnboardingState } from "../../hooks/useOnboarding";

interface Props {
  state: OnboardingState;
  saving: boolean;
  onSave: (vision: string, values: string, purpose: string) => void;
}

/** Legacy-upgrade Step 2 — vision, values, and purpose for their capital,
 *  captured as 3 separate fields (not a wealth event — nothing "brought them
 *  here," they're formalizing an existing relationship). */
export const StepVisionValues = ({ state, saving, onSave }: Props) => {
  const [vision, setVision] = useState(state.household.visionNotes ?? "");
  const [values, setValues] = useState(state.household.valuesNotes ?? "");
  const [purpose, setPurpose] = useState(state.household.purposeNotes ?? "");

  const canSubmit = (vision.trim() || values.trim() || purpose.trim()) && !saving;

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">
            Your vision, values &amp; purpose
          </h2>
          <p className="text-sm text-muted-foreground">
            You're already part of the ProsperWise family, this Survey is about formalizing what
            we build together, not starting from scratch.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-vision">Vision</Label>
          <Textarea
            id="ob-vision"
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What's your vision for your family's future?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-values">Values</Label>
          <Textarea
            id="ob-values"
            value={values}
            onChange={(e) => setValues(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What values matter most in how you make decisions?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-purpose">Purpose for your capital</Label>
          <Textarea
            id="ob-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What do you want this capital to accomplish, beyond the numbers?"
          />
          <p className="text-xs text-muted-foreground">
            Please leave out account numbers, SIN or health details, we'll gather anything
            sensitive securely during your Survey.
          </p>
        </div>

        <Button disabled={!canSubmit} onClick={() => onSave(vision.trim(), values.trim(), purpose.trim())}>
          <Sprout className="h-4 w-4" />
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
};
