import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Textarea } from "@/shared/components/ui/textarea";
import type { CharterPrefill } from "../../hooks/useCharterIntake";

interface Props {
  visionText: string | null;
  prefill: CharterPrefill;
  saving: boolean;
  onSave: (value: string) => void;
}

export function StepFamilyVision({ visionText, prefill, saving, onSave }: Props) {
  const [value, setValue] = useState(visionText ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Family Vision</h2>
          <p className="text-sm text-muted-foreground">
            Articulates the family's shared answer to: what is this wealth meant to accomplish across
            generations? Affirms wealth is an instrument of stewardship, never a measure of intrinsic
            worth. Sets a horizon beyond the founders' own lifespan — typically 50 to 100 years.
          </p>
        </div>

        {prefill.available && !value.trim() && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="mb-2 text-foreground">
              A Sovereignty Charter already exists for this household — pre-fill Family Vision from it?
            </p>
            <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-3">
              {prefill.suggestedVisionText}
            </p>
            <Button size="sm" variant="outline" onClick={() => setValue(prefill.suggestedVisionText)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Use this text
            </Button>
          </div>
        )}

        <Textarea
          rows={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What is this wealth meant to accomplish, across generations?"
        />

        <Button disabled={saving} onClick={() => onSave(value)}>
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
