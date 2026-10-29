import { useState } from "react";
import { HeartHandshake } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import type { OnboardingState } from "../../hooks/useOnboarding";

interface Props {
  state: OnboardingState;
  saving: boolean;
  onSave: (input: {
    anchorTransferAmount: number | null;
    anchorTransferAmountNote: string;
    spousalAlignmentScore: number | null;
    spousalAlignmentNote: string;
    pressureTypes: string[];
    pressureNote: string;
    pendingCapexAmount: number | null;
    pendingCapexDate: string | null;
    pendingCapexDescription: string;
    legacyAdvisorFrictionNotes: string;
  }) => void;
}

const PRESSURE_OPTIONS: { value: string; label: string }[] = [
  { value: "family_requesting_funds", label: "Family member(s) asking for financial help" },
  { value: "major_purchase_pending", label: "A major purchase decision looming" },
  { value: "inheritance_tension", label: "Family tension around an inheritance or estate" },
  { value: "peer_social_pressure", label: "Comparing themselves to peers or their social circle" },
  { value: "life_event_urgency", label: "A major life event forcing a fast decision" },
  { value: "other", label: "Something else" },
];

const ALIGNMENT_SCALE = [1, 2, 3, 4, 5];

/** New-lead Step 4 — personal sudden-wealth events only (inheritance, divorce,
 *  retirement, other sudden windfall). Skipped entirely for business_exit /
 *  business_growth and for legacy upgrades — see PERSONAL_WEALTH_EVENTS in
 *  intake-portal/index.ts. Every field here is optional; this step never
 *  blocks progress. */
export const StepHouseholdContext = ({ state, saving, onSave }: Props) => {
  const [anchorAmount, setAnchorAmount] = useState(
    state.household.anchorTransferAmount != null ? String(state.household.anchorTransferAmount) : "",
  );
  const [anchorNote, setAnchorNote] = useState(state.household.anchorTransferAmountNote ?? "");
  const [alignmentScore, setAlignmentScore] = useState<number | null>(state.household.spousalAlignmentScore ?? null);
  const [alignmentNote, setAlignmentNote] = useState(state.household.spousalAlignmentNote ?? "");
  const [pressureTypes, setPressureTypes] = useState<string[]>(state.household.pressureTypes ?? []);
  const [pressureNote, setPressureNote] = useState(state.household.pressureNote ?? "");
  const [capexAmount, setCapexAmount] = useState(
    state.household.pendingCapexAmount != null ? String(state.household.pendingCapexAmount) : "",
  );
  const [capexDate, setCapexDate] = useState(state.household.pendingCapexDate ?? "");
  const [capexDescription, setCapexDescription] = useState(state.household.pendingCapexDescription ?? "");
  const [frictionNotes, setFrictionNotes] = useState(state.household.legacyAdvisorFrictionNotes ?? "");

  const togglePressure = (value: string, checked: boolean) =>
    setPressureTypes((prev) => (checked ? [...prev, value] : prev.filter((v) => v !== value)));

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">A bit more context</h2>
          <p className="text-sm text-muted-foreground">
            Everything here is optional, skip anything that doesn't apply. It just helps us understand
            the full picture before your Survey.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-anchor-amount">Anchor transfer amount ($)</Label>
          <p className="text-xs text-muted-foreground">
            Is there a dollar figure you're anchored to for this transfer, a number that would make you
            feel secure?
          </p>
          <Input
            id="ob-anchor-amount"
            type="number"
            value={anchorAmount}
            onChange={(e) => setAnchorAmount(e.target.value)}
            placeholder="e.g. 500000"
          />
          <Textarea
            value={anchorNote}
            onChange={(e) => setAnchorNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Anything behind that number worth knowing?"
          />
        </div>

        <div className="space-y-1.5">
          <Label>How aligned do you feel with your spouse or partner on financial decisions?</Label>
          <div className="flex gap-2">
            {ALIGNMENT_SCALE.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAlignmentScore(n)}
                className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium transition-colors ${
                  alignmentScore === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/60"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">1 = not aligned at all, 5 = completely aligned</p>
          <Textarea
            value={alignmentNote}
            onChange={(e) => setAlignmentNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Anything you'd add about where you and your partner stand?"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Any outside pressure on your decisions right now?</Label>
          <div className="space-y-2">
            {PRESSURE_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  id={`ob-pressure-${opt.value}`}
                  checked={pressureTypes.includes(opt.value)}
                  onCheckedChange={(checked) => togglePressure(opt.value, checked === true)}
                />
                <Label htmlFor={`ob-pressure-${opt.value}`} className="text-sm font-normal">
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>
          <Textarea
            value={pressureNote}
            onChange={(e) => setPressureNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Anything more you'd like to share?"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Any $50,000+ purchase made or planned in the last or next 90 days?</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="number"
              value={capexAmount}
              onChange={(e) => setCapexAmount(e.target.value)}
              placeholder="Amount ($)"
            />
            <Input type="date" value={capexDate} onChange={(e) => setCapexDate(e.target.value)} />
          </div>
          <Textarea
            value={capexDescription}
            onChange={(e) => setCapexDescription(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="What is it? (e.g. a vehicle, a renovation, helping a family member)"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-advisor-friction">Anything that frustrated you about a previous advisor?</Label>
          <Textarea
            id="ob-advisor-friction"
            value={frictionNotes}
            onChange={(e) => setFrictionNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What would you want done differently this time?"
          />
        </div>

        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              anchorTransferAmount: anchorAmount.trim() ? Number(anchorAmount) : null,
              anchorTransferAmountNote: anchorNote.trim(),
              spousalAlignmentScore: alignmentScore,
              spousalAlignmentNote: alignmentNote.trim(),
              pressureTypes,
              pressureNote: pressureNote.trim(),
              pendingCapexAmount: capexAmount.trim() ? Number(capexAmount) : null,
              pendingCapexDate: capexDate.trim() || null,
              pendingCapexDescription: capexDescription.trim(),
              legacyAdvisorFrictionNotes: frictionNotes.trim(),
            })
          }
        >
          <HeartHandshake className="h-4 w-4" />
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
};
