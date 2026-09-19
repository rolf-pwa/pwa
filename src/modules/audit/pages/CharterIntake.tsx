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
  loadCharterIntake,
  recomputeTreasurySnapshot,
  saveCharterIntakeField,
  type CharterPrefill,
  type HouseholdCharter,
  type NamedItem,
} from "../hooks/useCharterIntake";
import { StepFamilyVision } from "../components/charter-intake/StepFamilyVision";
import { NamedListStep } from "../components/charter-intake/NamedListStep";
import { StepTreasuryCapital } from "../components/charter-intake/StepTreasuryCapital";
import { StepReview } from "../components/charter-intake/StepReview";
import { CORE_VALUES_DEFAULTS, GROUNDING_PRINCIPLES_DEFAULTS } from "../lib/charterBedrockDefaults";

const CHARTER_INTAKE_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Family Vision", hint: "The multi-generational purpose of this wealth" },
  { id: 2, title: "Core Values", hint: "How the family works together" },
  { id: 3, title: "System Grounding Principles", hint: "How the system stays disciplined" },
  { id: 4, title: "Treasury & Capital Structure", hint: "How capital is partitioned, replenished, and compounded" },
  { id: 5, title: "Review & Complete", hint: "Confirm before marking the Bedrock complete" },
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
            {current === 5 && <StepReview charter={charter} completing={completing} onComplete={complete} />}
          </>
        )}
      </div>
    </AppLayout>
  );
}
