import { useEffect, useState } from "react";
import { AlertCircle, FileText, HelpCircle, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useOnboarding } from "../../hooks/useOnboarding";
import { LEGACY_ONBOARDING_STEPS, ONBOARDING_STEPS, OnboardingStepper } from "./OnboardingStepper";
import { OnboardingSummary } from "./OnboardingSummary";
import { StepBookAudit } from "./StepBookAudit";
import { StepBookMeeting } from "./StepBookMeeting";
import { StepHouseholdContext } from "./StepHouseholdContext";
import { StepHouseholdProfile } from "./StepHouseholdProfile";
import { StepVisionValues } from "./StepVisionValues";
import { StepWealthEvent } from "./StepWealthEvent";
import { PortalIntakePage } from "../PortalIntakePage";

interface Props {
  portalToken: string;
  onBack: () => void;
  onAskForHelp: () => void;
}

/**
 * Guided Sovereignty Survey onboarding. New clients: Book Audit → Household →
 * Wealth event → Household context (personal sudden-wealth events only —
 * skipped straight to Documents for business_exit/business_growth) →
 * Documents. Legacy upgrades (existing clients staff enrolled, no payment):
 * Household info → Vision & values → Documents → Book meeting — no Household
 * context step at all (no triggering wealth event to gate it on), different
 * order and content throughout, since nothing "brought them here" and there's
 * no payment-track audit to book.
 */
export const OnboardingShell = ({ portalToken, onBack, onAskForHelp }: Props) => {
  const {
    state,
    disabled,
    loading,
    saving,
    error,
    confirmAuditBooked,
    checkAuditBooking,
    saveProfile,
    saveWealthEvent,
    saveHouseholdContext,
    saveVisionValues,
    markDocumentsComplete,
    confirmMeetingBooked,
  } = useOnboarding(portalToken);

  const furthest = state?.household.step ?? 1;
  const [current, setCurrent] = useState(furthest);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Follow the server's progress forward as steps complete.
  useEffect(() => {
    setCurrent((prev) => (furthest > prev ? furthest : prev));
  }, [furthest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Legacy clients aren't in the Sovereignty Survey onboarding flow.
  if (disabled) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your household isn't in the Sovereignty Survey onboarding flow — everything you need is
            in your portal.
          </p>
          <Button variant="outline" size="sm" onClick={onBack}>
            Back to your portal
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {error || "We couldn't load your onboarding just now. Please refresh and try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const firstName = state.contact.firstName || state.contact.fullName || "there";
  const isLegacy = state.household.legacyUpgrade;
  const steps = isLegacy ? LEGACY_ONBOARDING_STEPS : ONBOARDING_STEPS;

  const completionBanner = state.household.onboardingCompletedAt && (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <PartyPopper className="h-4 w-4 shrink-0 text-primary" />
        Your onboarding is complete — thank you. We'll take it from here.
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSummaryOpen(true)}>
        <FileText className="h-4 w-4" />
        View summary
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Georgia's welcome */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="font-serif text-xl font-semibold text-foreground">
              Welcome, {firstName}.
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {state.household.onboardingIntroText ??
                "I'm Georgia. There are a few short steps to get your Sovereignty Survey underway — no pressure, no sales, and you can stop and come back at any time."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onAskForHelp} className="shrink-0">
            <HelpCircle className="h-4 w-4" />
            Ask Georgia
          </Button>
        </CardContent>
      </Card>

      <OnboardingStepper
        current={current}
        furthest={furthest}
        onSelect={setCurrent}
        busy={saving}
        steps={steps}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {current === 1 &&
        (isLegacy ? (
          <StepHouseholdProfile
            state={state}
            saving={saving}
            onSave={async (input) => {
              const ok = await saveProfile(input);
              if (ok) setCurrent(2);
            }}
          />
        ) : (
          <StepBookAudit
            fullName={state.contact.fullName}
            email={state.contact.email}
            serviceName={state.booking?.serviceName ?? null}
            schedulingUrl={state.booking?.schedulingUrl ?? null}
            bookedAt={state.household.auditBookedAt}
            onCheckBooking={async () => {
              const found = await checkAuditBooking();
              if (found) setCurrent(2);
              return found;
            }}
            saving={saving}
            onConfirm={async () => {
              const ok = await confirmAuditBooked();
              if (ok) setCurrent(2);
            }}
          />
        ))}

      {current === 2 &&
        (isLegacy ? (
          <StepVisionValues
            state={state}
            saving={saving}
            onSave={async (vision, values, purpose) => {
              const ok = await saveVisionValues(vision, values, purpose);
              if (ok) setCurrent(3);
            }}
          />
        ) : (
          <StepHouseholdProfile
            state={state}
            saving={saving}
            onSave={async (input) => {
              const ok = await saveProfile(input);
              if (ok) setCurrent(3);
            }}
          />
        ))}

      {current === 3 &&
        (isLegacy ? (
          <PortalIntakePage
            portalToken={portalToken}
            onBack={onBack}
            onComplete={state.household.step < 4 ? () => void markDocumentsComplete() : undefined}
          />
        ) : (
          <StepWealthEvent
            state={state}
            saving={saving}
            onSave={async (type, notes) => {
              // Personal events land on Household Context (step 4) next;
              // corporate events skip it entirely and land on Documents (step
              // 5) instead — the server decides which via household.step, so
              // just let the furthest-tracking effect above follow it forward
              // rather than hardcoding a target step here.
              await saveWealthEvent(type, notes);
            }}
          />
        ))}

      {current === 4 &&
        (isLegacy ? (
          <div className="space-y-4">
            <StepBookMeeting
              fullName={state.contact.fullName}
              email={state.contact.email}
              saving={saving}
              onConfirm={() => void confirmMeetingBooked()}
            />
            {completionBanner}
          </div>
        ) : (
          <StepHouseholdContext
            state={state}
            saving={saving}
            onSave={async (input) => {
              const ok = await saveHouseholdContext(input);
              if (ok) setCurrent(5);
            }}
          />
        ))}

      {current === 5 && !isLegacy && (
        <div className="space-y-4">
          <PortalIntakePage
            portalToken={portalToken}
            onBack={onBack}
            onComplete={
              state.household.onboardingCompletedAt ? undefined : () => void markDocumentsComplete()
            }
          />
          {completionBanner}
        </div>
      )}

      {state.household.onboardingCompletedAt && (
        <OnboardingSummary
          portalToken={portalToken}
          state={state}
          open={summaryOpen}
          onOpenChange={setSummaryOpen}
        />
      )}
    </div>
  );
};
