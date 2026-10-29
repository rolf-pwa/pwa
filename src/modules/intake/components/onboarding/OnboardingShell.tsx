import { useEffect, useRef, useState } from "react";
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
 * Guided Transition Survey onboarding. New clients: Household → Wealth event →
 * Household context (personal sudden-wealth events only — skipped straight to
 * Documents for business_exit/business_growth) → Documents → Book the Survey Session. Legacy upgrades (existing clients staff enrolled, no payment):
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

  // Declared after the effect above so it wins on first load.
  // A step chosen on the welcome splash (?step=N): open it, but never past what they have unlocked.
  const requested = useRef(Number(new URLSearchParams(window.location.search).get("step")) || 0);
  useEffect(() => {
    if (!state || !requested.current) return;
    setCurrent(Math.max(1, Math.min(requested.current, furthest)));
    requested.current = 0;
  }, [state, furthest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Legacy clients aren't in the Transition Survey onboarding flow.
  if (disabled) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your household isn't in the Transition Survey onboarding flow, everything you need is
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
        Your onboarding is complete, thank you. We'll take it from here.
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
                "I'm Georgia. There are a few short steps to get your Transition Survey underway, no pressure, no sales, and you can stop and come back at any time."}
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

      {/* Legacy upgrades: Household info, Vision & values, Documents, Book meeting. */}
      {isLegacy && current === 1 && (
        <StepHouseholdProfile
          state={state}
          saving={saving}
          onSave={async (input) => {
            const ok = await saveProfile(input);
            if (ok) setCurrent(2);
          }}
        />
      )}
      {isLegacy && current === 2 && (
        <StepVisionValues
          state={state}
          saving={saving}
          onSave={async (vision, values, purpose) => {
            const ok = await saveVisionValues(vision, values, purpose);
            if (ok) setCurrent(3);
          }}
        />
      )}
      {isLegacy && current === 3 && (
        <PortalIntakePage
          portalToken={portalToken}
          onBack={onBack}
          onComplete={state.household.step < 4 ? () => void markDocumentsComplete() : undefined}
        />
      )}
      {isLegacy && current === 4 && (
        <div className="space-y-4">
          <StepBookMeeting
            fullName={state.contact.fullName}
            email={state.contact.email}
            saving={saving}
            onConfirm={() => void confirmMeetingBooked()}
          />
          {completionBanner}
        </div>
      )}

      {/* Everyone else: Household, Wealth event, Context (personal events only), Documents, then the Survey Session last. */}
      {!isLegacy && current === 1 && (
        <StepHouseholdProfile
          state={state}
          saving={saving}
          onSave={async (input) => {
            const ok = await saveProfile(input);
            if (ok) setCurrent(2);
          }}
        />
      )}
      {!isLegacy && current === 2 && (
        <StepWealthEvent
          state={state}
          saving={saving}
          onSave={async (type, notes) => {
            // Personal events land on Household Context next; business events skip it and land on Documents. The server decides which
            // via household.step, so the furthest-tracking effect above follows it forward.
            await saveWealthEvent(type, notes);
          }}
        />
      )}
      {!isLegacy && current === 3 && (
        <StepHouseholdContext
          state={state}
          saving={saving}
          onSave={async (input) => {
            const ok = await saveHouseholdContext(input);
            if (ok) setCurrent(4);
          }}
        />
      )}
      {!isLegacy && current === 4 && (
        <PortalIntakePage
          portalToken={portalToken}
          onBack={onBack}
          onComplete={state.household.documentsCompletedAt ? undefined : () => void markDocumentsComplete()}
        />
      )}
      {!isLegacy && current === 5 && (
        <div className="space-y-4">
          <StepBookAudit
            fullName={state.contact.fullName}
            email={state.contact.email}
            serviceName={state.booking?.serviceName ?? null}
            schedulingUrl={state.booking?.schedulingUrl ?? null}
            bookedAt={state.household.auditBookedAt}
            onCheckBooking={checkAuditBooking}
            saving={saving}
            onConfirm={() => void confirmAuditBooked()}
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
