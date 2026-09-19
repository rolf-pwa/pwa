import { useNavigate } from "react-router-dom";
import { Button } from "@/shared/components/ui/button";
import { BookOpen } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface Props {
  householdId: string;
  /** Pass the household's household_charters.status if known, so the label
   *  reflects real progress — never fully hidden once complete, since
   *  Bedrock content is the kind of thing staff revisit and edit. */
  status?: "draft" | "complete" | null;
  className?: string;
}

/** Entry point for the v2.0 Sovereignty Charter's Foundational Bedrock intake, matching GovernanceAuditButton's placement convention on the household's AI Workbench card. */
export function StartCharterIntakeButton({ householdId, status, className }: Props) {
  const navigate = useNavigate();

  return (
    <Button
      variant="outline"
      className={cn(className)}
      onClick={() => navigate(`/charter-intake/household/${householdId}`)}
    >
      <BookOpen className="mr-2 h-4 w-4" />
      {status === "complete" ? "Sovereignty Charter v2.0 — Review" : status === "draft" ? "Continue Charter Intake" : "Start Charter Intake"}
    </Button>
  );
}
