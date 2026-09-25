import { useState } from "react";
import { Sprout } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { OnboardingState, WealthEventType } from "../../hooks/useOnboarding";

export const WEALTH_EVENT_LABELS: Record<WealthEventType, string> = {
  inheritance: "Inheritance",
  divorce: "Divorce or separation",
  retirement: "Retirement",
  business_exit: "Business sale or exit",
  business_growth: "Business growth",
  other_sudden_wealth: "Another sudden wealth event",
};

interface Props {
  state: OnboardingState;
  saving: boolean;
  onSave: (type: WealthEventType, notes: string) => void;
}

/** Step 3 — the wealth event that brought the client to us. */
export const StepWealthEvent = ({ state, saving, onSave }: Props) => {
  const [type, setType] = useState<WealthEventType | "">(state.household.wealthEventType ?? "");
  const [notes, setNotes] = useState(state.household.wealthEventNotes ?? "");

  // Pre-filled from the Georgia diagnostic: don't re-ask, just confirm it
  // (with a way to change it) and keep the free-text box, which the
  // diagnostic never collected.
  const fromDiagnostic = !!state.household.wealthEventFromDiagnostic && !!state.household.wealthEventType;
  const [changing, setChanging] = useState(false);
  const showSelect = !fromDiagnostic || changing;

  const options = state.wealthEventOptions?.length
    ? state.wealthEventOptions
    : (Object.keys(WEALTH_EVENT_LABELS) as WealthEventType[]);

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Your wealth event</h2>
          <p className="text-sm text-muted-foreground">
            {showSelect
              ? "Every Survey starts with context. Tell us what changed — there are no wrong answers, and nothing here is shared outside your Sanctuary."
              : "We already have this from your diagnostic, so there's nothing to re-enter. Add anything else you'd like us to know, or continue as is — nothing here is shared outside your Sanctuary."}
          </p>
        </div>

        {!showSelect && type && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-4 py-3">
            <p className="text-sm">
              <span className="text-muted-foreground">From your Sovereignty Diagnostic: </span>
              <span className="font-medium text-foreground">{WEALTH_EVENT_LABELS[type] ?? type}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
              Change
            </Button>
          </div>
        )}

        {showSelect && (
        <div className="space-y-1.5">
          <Label htmlFor="ob-event">What best describes your situation?</Label>
          <Select value={type} onValueChange={(v) => setType(v as WealthEventType)}>
            <SelectTrigger id="ob-event" className="sm:w-[340px]">
              <SelectValue placeholder="Select your wealth event" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {WEALTH_EVENT_LABELS[option] ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ob-notes">Anything you'd like us to know?</Label>
          <Textarea
            id="ob-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="What's on your mind, what you're hoping for, and anything weighing on you right now."
          />
          <p className="text-xs text-muted-foreground">
            Please leave out account numbers, SIN or health details — we'll gather anything sensitive
            securely during your Survey.
          </p>
        </div>

        <Button disabled={!type || saving} onClick={() => onSave(type as WealthEventType, notes)}>
          <Sprout className="h-4 w-4" />
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
};
