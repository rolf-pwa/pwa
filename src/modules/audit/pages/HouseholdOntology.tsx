import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/AppLayout";
import { Button } from "@/shared/components/ui/button";
import { supabase } from "@/shared/integrations/supabase/client";
import {
  ActiveRiskFlags,
  StepOntologyAssessment,
  type OntologyAssessment,
  type OntologySavePayload,
  type RiskFlag,
} from "../components/ontology/StepOntologyAssessment";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callOntology(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  const res = await fetch(`${FUNCTIONS_URL}/household-ontology`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

/** Staff-facing entry point for the Causal AI Platform's Hub & Spoke
 *  Ontology (Phase 1) — one household, its most recent assessment, and the
 *  deterministic Causal DAG flags that assessment currently trips. */
export default function HouseholdOntology() {
  const { householdId } = useParams<{ householdId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [householdLabel, setHouseholdLabel] = useState("");
  const [latest, setLatest] = useState<OntologyAssessment | null>(null);
  const [pastCount, setPastCount] = useState(0);
  const [flags, setFlags] = useState<RiskFlag[]>([]);

  const load = async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [{ data: household }, ontology] = await Promise.all([
        supabase.from("households").select("label").eq("id", householdId).maybeSingle(),
        callOntology({ action: "load", household_id: householdId }),
      ]);
      setHouseholdLabel(household?.label || "Household");
      setLatest(ontology.latest ?? null);
      setPastCount(ontology.assessments?.length ?? 0);
      setFlags(ontology.flags ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load ontology assessment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const handleSave = async (payload: OntologySavePayload) => {
    if (!householdId) return;
    setSaving(true);
    try {
      const result = await callOntology({ action: "save", household_id: householdId, ...payload });
      toast.success("Assessment saved");
      setLatest(result.assessment);
      setFlags(result.flags ?? []);
      setPastCount((c) => c + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save assessment");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate(`/households/${householdId}`)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to household
            </Button>
            <h1 className="font-serif text-2xl">Household Ontology — {householdLabel}</h1>
            <p className="text-sm text-muted-foreground">
              The Hub &amp; Spoke Ontology behind the Causal AI Platform. Staff-entered only in this pass —
              {" "}
              {pastCount > 0 ? `${pastCount} assessment${pastCount === 1 ? "" : "s"} on file, most recent shown below.` : "no assessments on file yet."}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <StepOntologyAssessment latest={latest} saving={saving} onSave={handleSave} />
          <div className="lg:sticky lg:top-6 lg:self-start">
            <ActiveRiskFlags flags={flags} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
