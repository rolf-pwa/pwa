import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import type { Perspective2Draft } from "../../hooks/useCharterIntake";
import { FieldWithSuggestion } from "./StepFiduciaryGuidance";

interface Props {
  boundaryProtocolNote: string | null;
  capitalRequestFrameworkNote: string | null;
  matrimonialRingfencingNote: string | null;
  draft: Perspective2Draft | null;
  drafting: boolean;
  saving: boolean;
  onDraft: () => void;
  onSave: (fields: {
    boundary_protocol_note: string;
    capital_request_framework_note: string;
    matrimonial_ringfencing_note: string;
  }) => void;
}

export function StepBoundaryCapitalProtocols({
  boundaryProtocolNote,
  capitalRequestFrameworkNote,
  matrimonialRingfencingNote,
  draft,
  drafting,
  saving,
  onDraft,
  onSave,
}: Props) {
  const [boundaryNote, setBoundaryNote] = useState(boundaryProtocolNote ?? "");
  const [capitalFramework, setCapitalFramework] = useState(capitalRequestFrameworkNote ?? "");
  const [ringfencing, setRingfencing] = useState(matrimonialRingfencingNote ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Boundary &amp; Capital Protocols</h2>
          <p className="text-sm text-muted-foreground">
            The Sovereignty Boundary Protocol, the Capital Request Framework, and Matrimonial &amp; Asset
            Ring-Fencing — grounded in the household's own Bedrock and synced meeting transcripts.
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
          id="boundary-protocol"
          label="The Sovereignty Boundary Protocol"
          value={boundaryNote}
          onChange={setBoundaryNote}
          suggestion={draft?.boundary_protocol_note}
        />
        <FieldWithSuggestion
          id="capital-request-framework"
          label="Capital Request Framework"
          value={capitalFramework}
          onChange={setCapitalFramework}
          suggestion={draft?.capital_request_framework_note}
        />
        <FieldWithSuggestion
          id="matrimonial-ringfencing"
          label="Matrimonial & Asset Ring-Fencing"
          value={ringfencing}
          onChange={setRingfencing}
          suggestion={draft?.matrimonial_ringfencing_note}
        />

        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              boundary_protocol_note: boundaryNote,
              capital_request_framework_note: capitalFramework,
              matrimonial_ringfencing_note: ringfencing,
            })
          }
        >
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
