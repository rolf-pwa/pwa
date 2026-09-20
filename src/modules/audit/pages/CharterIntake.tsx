import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { Button } from "@/shared/components/ui/button";
import { supabase } from "@/shared/integrations/supabase/client";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { OnboardingStepper, type OnboardingStepMeta } from "@/modules/intake";
import {
  completeCharterIntake,
  draftPerspective2,
  draftPerspective3,
  draftPerspective4,
  loadCharterIntake,
  markValuesAddendumReaffirmed,
  markValuesAddendumSigned,
  recomputeGovernanceSnapshot,
  recomputeTreasurySnapshot,
  saveCharterIntakeField,
  syncLegalDocuments,
  syncMeetingTranscripts,
  type CharterPrefill,
  type HouseholdCharter,
  type LegalDocument,
  type MeetingTranscript,
  type NamedItem,
  type NextGenMilestone,
  type Perspective2Draft,
  type Perspective3Draft,
  type Perspective4Draft,
} from "../hooks/useCharterIntake";
import { StepFamilyVision } from "../components/charter-intake/StepFamilyVision";
import { NamedListStep } from "../components/charter-intake/NamedListStep";
import { StepTreasuryCapital } from "../components/charter-intake/StepTreasuryCapital";
import { StepMeetingTranscripts } from "../components/charter-intake/StepMeetingTranscripts";
import { StepFiduciaryGuidance } from "../components/charter-intake/StepFiduciaryGuidance";
import { StepBoundaryCapitalProtocols } from "../components/charter-intake/StepBoundaryCapitalProtocols";
import { StepVaultProtocolLegalDocuments } from "../components/charter-intake/StepVaultProtocolLegalDocuments";
import { StepCorporateTaxShields } from "../components/charter-intake/StepCorporateTaxShields";
import { StepHubSpokeCoordination } from "../components/charter-intake/StepHubSpokeCoordination";
import { StepIdentityTransitionNextGen } from "../components/charter-intake/StepIdentityTransitionNextGen";
import { StepPhilanthropicValuesAddendum } from "../components/charter-intake/StepPhilanthropicValuesAddendum";
import { StepReview } from "../components/charter-intake/StepReview";
import { CharterV2PrintDocument } from "../components/charter-intake/CharterV2PrintDocument";
import { CORE_VALUES_DEFAULTS, GROUNDING_PRINCIPLES_DEFAULTS } from "../lib/charterBedrockDefaults";

const CHARTER_INTAKE_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Family Vision", hint: "The multi-generational purpose of this wealth" },
  { id: 2, title: "Core Values", hint: "How the family works together" },
  { id: 3, title: "System Grounding Principles", hint: "How the system stays disciplined" },
  { id: 4, title: "Treasury & Capital Structure", hint: "How capital is partitioned, replenished, and compounded" },
  { id: 5, title: "Meeting Transcripts", hint: "Synced directly from the household's Meeting Notes in Drive" },
  { id: 6, title: "Fiduciary Guidance", hint: "Trust, POA, and shareholder succession guidance" },
  { id: 7, title: "Boundary & Capital Protocols", hint: "Social boundaries, capital requests, and asset ring-fencing" },
  { id: 8, title: "Vault Protocol & Legal Documents", hint: "Wills, POA, trust deeds, and shareholder agreements from the Vault" },
  { id: 9, title: "Corporate Tax Friction Shields", hint: "SBD clawback, active asset ratio, and CDA balance" },
  { id: 10, title: "Hub-and-Spoke Coordination", hint: "Review cadence, the Tri-Party MOU, and the Pure Fiduciary Standard" },
  { id: 11, title: "Identity Transition & Next-Gen Milestones", hint: "OpCo-to-WealthCo transition and rising-generation readiness" },
  { id: 12, title: "Philanthropic Stewardship & Values Addendum", hint: "Charitable directives and the family values addendum" },
  { id: 13, title: "Review & Complete", hint: "Confirm before marking the Bedrock complete" },
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
  const [trackType, setTrackType] = useState<"personal" | "corporate">("personal");
  const [syncingLegalDocuments, setSyncingLegalDocuments] = useState(false);
  const [perspective3Draft, setPerspective3Draft] = useState<Perspective3Draft | null>(null);
  const [drafting3, setDrafting3] = useState(false);
  const [perspective4Draft, setPerspective4Draft] = useState<Perspective4Draft | null>(null);
  const [drafting4, setDrafting4] = useState(false);
  const [markingAddendum, setMarkingAddendum] = useState(false);
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
      .then(([{ charter: loaded, prefill: p, track_type: t }, householdRes]) => {
        if (cancelled) return;
        setCharter(loaded);
        setPrefill(p);
        setTrackType(t);
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

  const syncLegalDocs = async () => {
    if (!householdId) return;
    setSyncingLegalDocuments(true);
    try {
      const result = await syncLegalDocuments(householdId);
      setCharter(result.charter);
      if (result.vault_missing) {
        toast.error("No Vault has been provisioned for this household yet.");
      } else {
        toast.success(result.synced > 0 ? `Synced ${result.synced} document(s) from the Vault.` : "Already up to date.");
      }
      if (result.errors?.length) {
        result.errors.forEach((e) => toast.error(`Could not sync "${e.title}": ${e.message}`));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sync from the Vault.");
    } finally {
      setSyncingLegalDocuments(false);
    }
  };

  const saveLegalDocuments = async (rows: LegalDocument[]) => {
    if (!householdId) return;
    setSaving(true);
    try {
      const updated = await saveCharterIntakeField(householdId, "legal_documents", rows, 9);
      setCharter(updated);
      setCurrent(9);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const recomputeGovernance = async () => {
    if (!householdId) return;
    setRecomputing(true);
    try {
      const updated = await recomputeGovernanceSnapshot(householdId);
      setCharter(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not recompute the Governance snapshot.");
    } finally {
      setRecomputing(false);
    }
  };

  const draftP3 = async () => {
    if (!householdId) return;
    setDrafting3(true);
    try {
      const draft = await draftPerspective3(householdId);
      setPerspective3Draft(draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft with AI.");
    } finally {
      setDrafting3(false);
    }
  };

  const saveTaxShields = async (fields: {
    corporate_passive_income_annual: number | null;
    active_operational_assets_value: number | null;
    cda_balance: number | null;
    tax_friction_shields_note: string;
  }) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "corporate_passive_income_annual", fields.corporate_passive_income_annual, 9);
      await saveCharterIntakeField(householdId, "active_operational_assets_value", fields.active_operational_assets_value, 9);
      await saveCharterIntakeField(householdId, "cda_balance", fields.cda_balance, 9);
      const updated = await saveCharterIntakeField(householdId, "tax_friction_shields_note", fields.tax_friction_shields_note, 10);
      setCharter(updated);
      setCurrent(10);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const skipTaxShields = async () => {
    if (!householdId) return;
    setSaving(true);
    try {
      const updated = await saveCharterIntakeField(householdId, "tax_friction_shields_note", charter?.tax_friction_shields_note ?? "", 10);
      setCharter(updated);
      setCurrent(10);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not continue.");
    } finally {
      setSaving(false);
    }
  };

  const saveHubSpoke = async (fields: {
    hub_spoke_cadence_note: string;
    tri_party_mou_note: string;
    pure_fiduciary_standard_note: string;
  }) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "hub_spoke_cadence_note", fields.hub_spoke_cadence_note, 10);
      await saveCharterIntakeField(householdId, "tri_party_mou_note", fields.tri_party_mou_note, 10);
      const updated = await saveCharterIntakeField(
        householdId,
        "pure_fiduciary_standard_note",
        fields.pure_fiduciary_standard_note,
        11,
      );
      setCharter(updated);
      setCurrent(11);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const draftP4 = async () => {
    if (!householdId) return;
    setDrafting4(true);
    try {
      const draft = await draftPerspective4(householdId);
      setPerspective4Draft(draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft with AI.");
    } finally {
      setDrafting4(false);
    }
  };

  const saveIdentityTransitionNextGen = async (identityTransitionNote: string, milestones: NextGenMilestone[]) => {
    if (!householdId) return;
    setSaving(true);
    try {
      await saveCharterIntakeField(householdId, "identity_transition_note", identityTransitionNote, 12);
      const updated = await saveCharterIntakeField(householdId, "next_gen_milestones", milestones, 12);
      setCharter(updated);
      setCurrent(12);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const savePhilanthropicNote = async (note: string) => {
    if (!householdId) return;
    setSaving(true);
    try {
      const updated = await saveCharterIntakeField(householdId, "philanthropic_stewardship_note", note, 13);
      setCharter(updated);
      setCurrent(13);
      toast.success("Saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const markSigned = async () => {
    if (!householdId) return;
    setMarkingAddendum(true);
    try {
      const updated = await markValuesAddendumSigned(householdId);
      setCharter(updated);
      toast.success("Marked signed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark signed.");
    } finally {
      setMarkingAddendum(false);
    }
  };

  const markReaffirmed = async () => {
    if (!householdId) return;
    setMarkingAddendum(true);
    try {
      const updated = await markValuesAddendumReaffirmed(householdId);
      setCharter(updated);
      toast.success("Marked reaffirmed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark reaffirmed.");
    } finally {
      setMarkingAddendum(false);
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
        <div className="print:hidden space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Households", href: "/households" },
            { label: householdLabel, href: householdId ? `/households/${householdId}` : undefined },
            { label: "Sovereignty Charter v2.0" },
          ]}
        />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl">Sovereignty Charter v2.0 — Foundational Bedrock</h1>
            <p className="text-sm text-muted-foreground">
              Family Vision, Core Values, and System Grounding Principles — the constitutional preamble that
              informs every perspective of this household's Charter.
            </p>
          </div>
          {charter && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print / PDF
            </Button>
          )}
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
            {current === 8 && (
              <StepVaultProtocolLegalDocuments
                documents={charter.legal_documents}
                governanceSnapshot={charter.governance_snapshot}
                governanceSnapshotComputedAt={charter.governance_snapshot_computed_at}
                syncing={syncingLegalDocuments}
                recomputing={recomputing}
                saving={saving}
                onSync={syncLegalDocs}
                onRecompute={recomputeGovernance}
                onSave={saveLegalDocuments}
              />
            )}
            {current === 9 && (
              <StepCorporateTaxShields
                trackType={trackType}
                corporatePassiveIncomeAnnual={charter.corporate_passive_income_annual}
                activeOperationalAssetsValue={charter.active_operational_assets_value}
                cdaBalance={charter.cda_balance}
                taxFrictionShieldsNote={charter.tax_friction_shields_note}
                governanceSnapshot={charter.governance_snapshot}
                recomputing={recomputing}
                drafting={drafting3}
                saving={saving}
                draftSuggestion={perspective3Draft?.tax_friction_shields_note}
                onRecompute={recomputeGovernance}
                onDraft={draftP3}
                onSave={saveTaxShields}
                onSkip={skipTaxShields}
              />
            )}
            {current === 10 && (
              <StepHubSpokeCoordination
                hubSpokeCadenceNote={charter.hub_spoke_cadence_note}
                triPartyMouNote={charter.tri_party_mou_note}
                pureFiduciaryStandardNote={charter.pure_fiduciary_standard_note}
                draft={perspective3Draft}
                drafting={drafting3}
                saving={saving}
                onDraft={draftP3}
                onSave={saveHubSpoke}
              />
            )}
            {current === 11 && (
              <StepIdentityTransitionNextGen
                identityTransitionNote={charter.identity_transition_note}
                milestones={charter.next_gen_milestones}
                draft={perspective4Draft}
                drafting={drafting4}
                saving={saving}
                onDraft={draftP4}
                onSave={saveIdentityTransitionNextGen}
              />
            )}
            {current === 12 && (
              <StepPhilanthropicValuesAddendum
                philanthropicStewardshipNote={charter.philanthropic_stewardship_note}
                philanthropicBalance={charter.treasury_snapshot?.storehouse_reserves.philanthropic ?? null}
                signedAt={charter.family_values_addendum_signed_at}
                reaffirmedAt={charter.family_values_addendum_reaffirmed_at}
                draft={perspective4Draft}
                drafting={drafting4}
                saving={saving}
                marking={markingAddendum}
                onDraft={draftP4}
                onSave={savePhilanthropicNote}
                onMarkSigned={markSigned}
                onMarkReaffirmed={markReaffirmed}
              />
            )}
            {current === 13 && <StepReview charter={charter} completing={completing} onComplete={complete} />}
          </>
        )}
        </div>

        {charter && (
          <div className="hidden print:block">
            <CharterV2PrintDocument charter={charter} householdLabel={householdLabel} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
