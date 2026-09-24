import { useNavigate } from "react-router-dom";
import { Button } from "@/shared/components/ui/button";
import { Brain } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface Props {
  householdId: string;
  className?: string;
}

/** Entry point for the Causal AI Platform's stepped Workbench (Ontology
 *  Assessment, Meeting Transcripts, Delta Reconciliation, Review & Lock —
 *  one flow, matching StartCharterIntakeButton's simple navigate-on-click
 *  shape). */
export function CausalAIWorkbenchButton({ householdId, className }: Props) {
  const navigate = useNavigate();

  return (
    <Button
      variant="outline"
      className={cn(className)}
      onClick={() => navigate(`/causal-ai-workbench/household/${householdId}`)}
    >
      <Brain className="mr-2 h-4 w-4" />
      Causal AI Workbench
    </Button>
  );
}
