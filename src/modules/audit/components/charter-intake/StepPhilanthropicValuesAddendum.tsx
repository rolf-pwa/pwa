import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { Perspective4Draft } from "../../hooks/useCharterIntake";
import { FieldWithSuggestion } from "./StepFiduciaryGuidance";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

function staleness(signedAt: string | null, reaffirmedAt: string | null): { onFile: boolean; isStale: boolean; ageYears: number | null } {
  const lastAffirmed = reaffirmedAt || signedAt;
  if (!lastAffirmed) return { onFile: false, isStale: true, ageYears: null };
  const affirmed = new Date(lastAffirmed);
  if (Number.isNaN(affirmed.getTime())) return { onFile: false, isStale: true, ageYears: null };
  const ageYears = (Date.now() - affirmed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return { onFile: true, isStale: ageYears > 3, ageYears: Math.round(ageYears * 10) / 10 };
}

interface Props {
  philanthropicStewardshipNote: string | null;
  philanthropicBalance: number | null;
  signedAt: string | null;
  reaffirmedAt: string | null;
  draft: Perspective4Draft | null;
  drafting: boolean;
  saving: boolean;
  marking: boolean;
  onDraft: () => void;
  onSave: (note: string) => void;
  onMarkSigned: () => void;
  onMarkReaffirmed: () => void;
}

export function StepPhilanthropicValuesAddendum({
  philanthropicStewardshipNote,
  philanthropicBalance,
  signedAt,
  reaffirmedAt,
  draft,
  drafting,
  saving,
  marking,
  onDraft,
  onSave,
  onMarkSigned,
  onMarkReaffirmed,
}: Props) {
  const [note, setNote] = useState(philanthropicStewardshipNote ?? "");
  const stale = staleness(signedAt, reaffirmedAt);

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Philanthropic Stewardship &amp; Values Addendum</h2>
          <p className="text-sm text-muted-foreground">
            The family's charitable directives and a self-sustaining endowment approach, plus the family
            values addendum staff reaffirm every 3 years.
          </p>
        </div>

        <div className="rounded-md bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Philanthropic Storehouse Balance (real, computed)</p>
          <p className="text-xl font-bold text-foreground">
            {philanthropicBalance !== null ? formatCurrency(philanthropicBalance) : "Not yet computed"}
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={drafting} onClick={onDraft}>
          {drafting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Draft with AI
        </Button>

        <FieldWithSuggestion
          id="philanthropic-note"
          label="Philanthropic Stewardship Engine"
          value={note}
          onChange={setNote}
          suggestion={draft?.philanthropic_stewardship_note}
        />

        <div className="space-y-2 rounded-md border border-border p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Family Values Addendum</h3>
          <div className="text-sm">
            <p>Signed: {signedAt ? new Date(signedAt).toLocaleDateString("en-CA") : "Not yet signed"}</p>
            <p>Reaffirmed: {reaffirmedAt ? new Date(reaffirmedAt).toLocaleDateString("en-CA") : "Never"}</p>
            {stale.onFile && (
              <p className={stale.isStale ? "text-amber-600" : "text-emerald-600"}>
                {stale.isStale ? `Stale — last affirmed ${stale.ageYears} years ago` : `Current — last affirmed ${stale.ageYears} years ago`}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={marking} onClick={onMarkSigned}>
              Mark Signed Today
            </Button>
            <Button size="sm" variant="outline" disabled={marking} onClick={onMarkReaffirmed}>
              Mark Reaffirmed Today
            </Button>
          </div>
        </div>

        <Button disabled={saving} onClick={() => onSave(note)}>
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
