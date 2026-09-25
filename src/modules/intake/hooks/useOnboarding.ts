import { useCallback, useEffect, useState } from "react";

const INTAKE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intake-portal`;

export type WealthEventType =
  | "inheritance"
  | "divorce"
  | "retirement"
  | "business_exit"
  | "business_growth"
  | "other_sudden_wealth";

export interface OnboardingMemberInput {
  fullName: string;
  email?: string;
  relationship: "spouse" | "child" | "dependant" | "other";
  isMinor?: boolean;
}

export interface OnboardingState {
  household: {
    id?: string;
    label: string;
    address: string;
    step: number;
    auditBookedAt: string | null;
    profileCompletedAt: string | null;
    wealthEventType: WealthEventType | null;
    wealthEventNotes: string;
    wealthEventCompletedAt: string | null;
    /** Wealth event was pre-filled from the client's Georgia diagnostic. */
    wealthEventFromDiagnostic?: boolean;
    /** Personalized welcome copy built from the diagnostic; null falls back to the generic text. */
    onboardingIntroText?: string | null;
    /** Legacy-upgrade Step 2 fields — captured separately so each can be
     *  read/quoted independently elsewhere, rather than one combined note. */
    visionNotes: string;
    valuesNotes: string;
    purposeNotes: string;
    onboardingCompletedAt: string | null;
    /** Staff enrolled an existing client — steps are reordered (household info
     *  first, vision/values instead of a wealth event, meeting booked last). */
    legacyUpgrade: boolean;
    vaultReady: boolean;
    /** Household Context step (new-lead, personal sudden-wealth events only —
     *  skipped entirely for business_exit/business_growth and for legacy
     *  upgrades). Every field optional. */
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
    householdContextCompletedAt: string | null;
  };
  contact: {
    id?: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
  };
  members: { id: string; fullName: string; email: string | null; role: string | null }[];
  booking: { id: string; schedulingUrl: string | null; serviceName: string | null } | null;
  wealthEventOptions: WealthEventType[];
}

async function call(portalToken: string, body: Record<string, unknown>) {
  const res = await fetch(INTAKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-portal-token": portalToken },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data;
}

/**
 * Drives the guided Sovereignty Survey onboarding (steps 1-3). Step 4 — the
 * document checklist — is owned by the intake manifest hook.
 */
export function useOnboarding(portalToken?: string) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!portalToken) return;
    try {
      setError(null);
      const data = await call(portalToken, { action: "onboarding" });
      if ((data as { disabled?: boolean })?.disabled) {
        setDisabled(true);
        setState(null);
        return;
      }
      setDisabled(false);
      setState(data as OnboardingState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your onboarding");
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      if (!portalToken) return false;
      setSaving(true);
      setError(null);
      try {
        const data = await call(portalToken, body);
        if ((data as { disabled?: boolean })?.disabled) {
          setDisabled(true);
          return false;
        }
        setState(data as OnboardingState);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to save");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [portalToken],
  );


  const checkAuditBooking = useCallback(async (): Promise<boolean> => {
    if (!portalToken) return false;
    try {
      const data = await call(portalToken, { action: "onboarding_check_booking" });
      setState(data as OnboardingState);
      return Boolean((data as { verified?: boolean })?.verified);
    } catch {
      return false;
    }
  }, [portalToken]);

  return {
    state,
    disabled,
    loading,
    saving,


    error,
    refresh,
    checkAuditBooking,
    confirmAuditBooked: () => mutate({ action: "onboarding_audit_booked" }),
    saveProfile: (input: {
      householdName: string;
      primaryName?: string;
      address: string;
      phone?: string;
      email?: string;
      members: OnboardingMemberInput[];
    }) => mutate({ action: "onboarding_profile", ...input }),

    saveWealthEvent: (wealthEventType: WealthEventType, notes: string) =>
      mutate({ action: "onboarding_wealth_event", wealthEventType, notes }),
    saveHouseholdContext: (input: {
      anchorTransferAmount?: number | null;
      anchorTransferAmountNote?: string;
      spousalAlignmentScore?: number | null;
      spousalAlignmentNote?: string;
      pressureTypes?: string[];
      pressureNote?: string;
      pendingCapexAmount?: number | null;
      pendingCapexDate?: string | null;
      pendingCapexDescription?: string;
      legacyAdvisorFrictionNotes?: string;
    }) => mutate({ action: "onboarding_household_context", ...input }),
    saveVisionValues: (vision: string, values: string, purpose: string) =>
      mutate({ action: "onboarding_vision_values", vision, values, purpose }),
    markDocumentsComplete: () => mutate({ action: "onboarding_documents_complete" }),
    confirmMeetingBooked: () => mutate({ action: "onboarding_meeting_booked" }),
  };
}
