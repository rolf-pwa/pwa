import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { Perspective3Draft } from "../../hooks/useCharterIntake";
import { FieldWithSuggestion } from "./StepFiduciaryGuidance";

interface Props {
  hubSpokeCadenceNote: string | null;
  triPartyMouNote: string | null;
  pureFiduciaryStandardNote: string | null;
  draft: Perspective3Draft | null;
  drafting: boolean;
  saving: boolean;
  onDraft: () => void;
  onSave: (fields: {
    hub_spoke_cadence_note: string;
    tri_party_mou_note: string;
    pure_fiduciary_standard_note: string;
  }) => void;
}

export function StepHubSpokeCoordination({
  hubSpokeCadenceNote,
  triPartyMouNote,
  pureFiduciaryStandardNote,
  draft,
  drafting,
  saving,
  onDraft,
  onSave,
}: Props) {
  const [cadence, setCadence] = useState(hubSpokeCadenceNote ?? "");
  const [mou, setMou] = useState(triPartyMouNote ?? "");
  const [standard, setStandard] = useState(pureFiduciaryStandardNote ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Hub-and-Spoke Coordination</h2>
          <p className="text-sm text-muted-foreground">
            ProsperWise Advisors as the central Family CFO Hub — the review rhythm, the Tri-Party MOU
            protocol coordinating external CPAs and estate litigators, and the Pure Fiduciary Standard.
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={drafting} onClick={onDraft}>
          {drafting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Draft with AI
        </Button>

        <FieldWithSuggestion
          id="hub-spoke-cadence"
          label="Hub-and-Spoke Coordination Cadence"
          value={cadence}
          onChange={setCadence}
          suggestion={draft?.hub_spoke_cadence_note}
        />
        <FieldWithSuggestion
          id="tri-party-mou"
          label="Tri-Party MOU Protocol"
          value={mou}
          onChange={setMou}
          suggestion={draft?.tri_party_mou_note}
        />
        <FieldWithSuggestion
          id="pure-fiduciary-standard"
          label="Pure Fiduciary Standard"
          value={standard}
          onChange={setStandard}
          suggestion={draft?.pure_fiduciary_standard_note}
        />

        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              hub_spoke_cadence_note: cadence,
              tri_party_mou_note: mou,
              pure_fiduciary_standard_note: standard,
            })
          }
        >
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
