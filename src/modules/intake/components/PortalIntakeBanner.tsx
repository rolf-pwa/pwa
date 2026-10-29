import { Link } from "react-router-dom";
import { Progress } from "@/shared/components/ui/progress";
import { Button } from "@/shared/components/ui/button";
import { Inbox, ArrowRight } from "lucide-react";
import { useOnboardingManifest } from "@/shared/hooks/useOnboardingManifest";

interface Props {
  portalToken: string;
  /** Route to send the client to (keeps advisor token links working). */
  to?: string;
}

/**
 * Slim dashboard entry point for document intake. Renders nothing once the
 * onboarding agent reports the household's vault as complete.
 */
export function PortalIntakeBanner({ portalToken, to = "/portal/intake" }: Props) {
  const { manifest, loading, visible, percent, audit } = useOnboardingManifest(portalToken);

  if (loading || !visible) return null;

  const c = manifest?.completion ?? {};
  const hasAudit = audit && typeof audit.criticalTotal === "number" && audit.criticalTotal > 0;
  const label = hasAudit
    ? `Transition Survey, ${audit!.criticalSatisfied ?? 0} of ${audit!.criticalTotal} essentials confirmed`
    : `Transition Survey, ${c.uploadedFiles ?? 0} ${c.expectedItems ? `of ${c.expectedItems} ` : ""}received`;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="font-serif text-sm text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              Send us your documents and we file them into your vault automatically.
            </p>
          </div>
        </div>

        <Button asChild size="sm" className="gap-1.5">
          <Link to={to}>
            Continue intake
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <Progress value={percent} className="mt-3 h-1.5" />
    </div>
  );
}
