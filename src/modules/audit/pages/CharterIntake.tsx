import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { supabase } from "@/shared/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OnboardingStepper, type OnboardingStepMeta } from "@/modules/intake";
import {
  completeCharterIntake,
  draftPerspective2,
  loadCharterIntake,
  recomputeTreasurySnapshot,
  saveCharterIntakeField,
  syncMeetingTranscripts,
  type CharterPrefill,
  type HouseholdCharter,
  type MeetingTranscript,
  type NamedItem,
  type Perspective2Draft,
} from "../hooks/useCharterIntake";
import { StepFamilyVision } from "../components/charter-intake/StepFamilyVision";
import { NamedListStep } from "../components/charter-intake/NamedListStep";
import { StepTreasuryCapital } from "../components/charter-intake/StepTreasuryCapital";
import { StepMeetingTranscripts } from "../components/charter-intake/StepMeetingTranscripts";
import { StepFiduciaryGuidance } from "../components/charter-intake/StepFiduciaryGuidance";
import { StepBoundaryCapitalProtocols } from "../components/charter-intake/StepBoundaryCapitalProtocols";
import { StepReview } from "../components/charter-intake/StepReview";
import { CORE_VALUES_DEFAULTS, GROUNDING_PRINCIPLES_DEFAULTS } from "../lib/charterBedrockDefaults";

const CHARTER_INTAKE_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Family Vision", hint: "The multi-generational purpose of this wealth" },
  { id: 2, title: "Core Values", hint: "How the family works together" },
  { id: 3, title: "System Grounding Principles", hint: "How the system stays disciplined" },
  { id: 4, title: "Treasury & Capital Structure", hint: "How capital is partitioned, replenished, and compounded" },
  { id: 5, title: "Meeting Transcripts", hint: "Synced directly from the household's Meeting Notes in Drive" },
  { id: 6, title: "Fiduciary Guidance", hint: "Trust, POA, and shareholder succession guidance" },
  { id: 7, title: "Boundary & Capital Protocols", hint: "Social boundaries, capital requests, and asset ring-fencing" },
  { id: 8, title: "Review & Complete", hint: "Confirm before marking the Bedrock complete" },
];

const CORE_VALUES_GUIDANCE =
  "The non-negotiable relational and ethical guideposts for this family. ProsperWise supplies the framework — personalize how each shows up for this family.";
const GROUNDING_PRINCIPLES_GUIDANCE =
  "The financial operating creed bridging the family's values to how capital actually moves — the direct bridge between abstract values and the Balanced Scorecard perspectives that follow.";

export default function CharterIntake() {
  const { householdId } = useParams<{ householdId: string }>();
  const [householdLabel, setHouseholdLabel] = useState<string>("");
  const [charter, setCharter] = useState<HouseholdCharter | null>(null);
  const [prefill, setPrefill] = useState<CharterPrefill>({ available: false, suggestedVisionText: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [syncingTranscripts, setSyncingTranscripts] = useState(false);
  const [perspective2Draft, setPerspective2Draft] = useState<Perspective2Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [current, setCurrent] = useState(1);

  const furthest = charter?.step ?? 1;

  useEffect(() => {
    // Only ever push `current` forward to follow `furthest` — never
    // backward — so staff can freely revisit completed steps without
    // losing their place. Same mechanics as OnboardingShell.tsx.
    if (furthest > current) setCurrent(furthest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furthest]);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadCharterIntake(householdId),
      supabase.from("households").select("label").eq("id", householdId).maybeSingle(),
    ])
      .then(([{ charter: loaded, prefill: p }, householdRes]) => {
        if (cancelled) return;
        setCharter(loaded);
        setPrefill(p);
        setHouseholdLabel(householdRes.data?.label || "Household");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load Charter Intake."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  const save = async (field: "vision" | "core_values" | "grounding_principles", value: string | NamedItem[], advanceTo: number) => {
    if (!householdId) return;
    setSaving(true);
    try {
      const updated = await saveCharterIntakeField(householdId, field, value, advanceTo);
      setCharter(updated);
      setCurrent(advanceTo);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const recompute = async () => {
    if (!householdId) return;
    setRecomputing(true);
    try {
      const updated = await recomputeTreasurySnapshot(householdId);
      setCharter(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not recompute the Treasury snapshot.");
    } finally {
      setRecomputing(false);
    }
  };

  const saveTreasuryNarratives = async (vineyardText: string, riverText: string) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "vineyard_replenishment", vineyardText, 4);
      const updated = await saveCharterIntakeField(householdId, "river_boundary", riverText, 5);
      setCharter(updated);
      setCurrent(5);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const syncTranscripts = async () => {
    if (!householdId) return;
    setSyncingTranscripts(true);
    try {
      const result = await syncMeetingTranscripts(householdId);
      setCharter(result.charter);
      if (result.folder_missing) {
        toast.error("No Meeting Notes folder found for this household's Advisor Files in Drive.");
      } else {
        toast.success(result.synced > 0 ? `Synced ${result.synced} file(s) from Drive.` : "Already up to date.");
      }
      if (result.errors?.length) {
        result.errors.forEach((e) => toast.error(`Could not sync "${e.title}": ${e.message}`));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sync from Drive.");
    } finally {
      setSyncingTranscripts(false);
    }
  };

  const saveTranscripts = async (rows: MeetingTranscript[]) => {
    if (!householdId) return;
    setSaving(true);
    try {
      const updated = await saveCharterIntakeField(householdId, "meeting_transcripts", rows, 6);
      setCharter(updated);
      setCurrent(6);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const draftP2 = async () => {
    if (!householdId) return;
    setDrafting(true);
    try {
      const draft = await draftPerspective2(householdId);
      setPerspective2Draft(draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft with AI.");
    } finally {
      setDrafting(false);
    }
  };

  const saveFiduciaryGuidance = async (fields: {
    discretionary_trust_guidelines: string;
    poa_incapacity_protocol: string;
    shareholder_voting_philosophy: string;
  }) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "discretionary_trust_guidelines", fields.discretionary_trust_guidelines, 6);
      await saveCharterIntakeField(householdId, "poa_incapacity_protocol", fields.poa_incapacity_protocol, 6);
      const updated = await saveCharterIntakeField(
        householdId,
        "shareholder_voting_philosophy",
        fields.shareholder_voting_philosophy,
        7,
      );
      setCharter(updated);
      setCurrent(7);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const saveBoundaryCapitalProtocols = async (fields: {
    boundary_protocol_note: string;
    capital_request_framework_note: string;
    matrimonial_ringfencing_note: string;
  }) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "boundary_protocol_note", fields.boundary_protocol_note, 7);
      await saveCharterIntakeField(householdId, "capital_request_framework_note", fields.capital_request_framework_note, 7);
      const updated = await saveCharterIntakeField(
        householdId,
        "matrimonial_ringfencing_note",
        fields.matrimonial_ringfencing_note,
        8,
      );
      setCharter(updated);
      setCurrent(8);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!householdId) return;
    setCompleting(true);
    try {
      const updated = await completeCharterIntake(householdId);
      setCharter(updated);
      toast.success("Foundational Bedrock marked complete.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark complete.");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Households", href: "/households" },
            { label: householdLabel, href: householdId ? `/households/${householdId}` : undefined },
            { label: "Sovereignty Charter v2.0" },
          ]}
        />

        <div>
          <h1 className="font-serif text-2xl">Sovereignty Charter v2.0 — Foundational Bedrock</h1>
          <p className="text-sm text-muted-foreground">
            Family Vision, Core Values, and System Grounding Principles — the constitutional preamble that
            informs every perspective of this household's Charter.
          </p>
        </div>

        {loading || !charter ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <OnboardingStepper
              current={current}
              furthest={furthest}
              onSelect={setCurrent}
              busy={saving}
              steps={CHARTER_INTAKE_STEPS}
            />

            {current === 1 && (
              <StepFamilyVision
                visionText={charter.vision_text}
                prefill={prefill}
                saving={saving}
                onSave={(value) => save("vision", value, 2)}
              />
            )}
            {current === 2 && (
              <NamedListStep
                items={charter.core_values}
                defaults={CORE_VALUES_DEFAULTS}
                heading="Core Values"
                guidanceCopy={CORE_VALUES_GUIDANCE}
                saving={saving}
                onSave={(value) => save("core_values", value, 3)}
              />
            )}
            {current === 3 && (
              <NamedListStep
                items={charter.grounding_principles}
                defaults={GROUNDING_PRINCIPLES_DEFAULTS}
                heading="System Grounding Principles"
                guidanceCopy={GROUNDING_PRINCIPLES_GUIDANCE}
                saving={saving}
                onSave={(value) => save("grounding_principles", value, 4)}
              />
            )}
            {current === 4 && (
              <StepTreasuryCapital
                charter={charter}
                recomputing={recomputing}
                saving={saving}
                onRecompute={recompute}
                onSave={saveTreasuryNarratives}
              />
            )}
            {current === 5 && (
              <StepMeetingTranscripts
                transcripts={charter.meeting_transcripts}
                syncing={syncingTranscripts}
                saving={saving}
                onSync={syncTranscripts}
                onSave={saveTranscripts}
              />
            )}
            {current === 6 && (
              <StepFiduciaryGuidance
                householdId={householdId!}
                discretionaryTrustGuidelines={charter.discretionary_trust_guidelines}
                poaIncapacityProtocol={charter.poa_incapacity_protocol}
                shareholderVotingPhilosophy={charter.shareholder_voting_philosophy}
                draft={perspective2Draft}
                drafting={drafting}
                saving={saving}
                onDraft={draftP2}
                onSave={saveFiduciaryGuidance}
              />
            )}
            {current === 7 && (
              <StepBoundaryCapitalProtocols
                boundaryProtocolNote={charter.boundary_protocol_note}
                capitalRequestFrameworkNote={charter.capital_request_framework_note}
                matrimonialRingfencingNote={charter.matrimonial_ringfencing_note}
                draft={perspective2Draft}
                drafting={drafting}
                saving={saving}
                onDraft={draftP2}
                onSave={saveBoundaryCapitalProtocols}
              />
            )}
            {current === 8 && <StepReview charter={charter} completing={completing} onComplete={complete} />}
          </>
        )}
      </div>
    </AppLayout>
  );
}
