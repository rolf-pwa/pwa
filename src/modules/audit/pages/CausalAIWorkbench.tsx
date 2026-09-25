import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { ArrowLeft, ChevronDown, ChevronUp, Lock, Loader2, Play, Quote, Save } from "lucide-react";
import { toast } from "sonner";
import { GeorgiaDiagnosticCard, OnboardingStepper, type OnboardingStepMeta } from "@/modules/intake";
import { ActiveRiskFlags, StepOntologyAssessment, type OntologyAssessment, type OntologySavePayload, type RiskFlag } from "../components/ontology/StepOntologyAssessment";
import { StepMeetingTranscripts } from "../components/charter-intake/StepMeetingTranscripts";
import { loadCharterIntake, syncMeetingTranscripts, saveCharterIntakeField, type MeetingTranscript } from "../hooks/useCharterIntake";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callFn(name: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
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

const WORKBENCH_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: "Ontology Assessment", hint: "The household's Hub & Spoke baseline" },
  { id: 2, title: "Meeting Transcripts", hint: "Synced directly from the household's Vault" },
  { id: 3, title: "Delta Reconciliation", hint: "Compare the baseline against a real transcript" },
  { id: 4, title: "Review & Lock", hint: "Sign off once the assessment is current" },
];

interface Delta {
  variable_path: string;
  discrepancy_type: "Variance" | "Contradiction" | "Unstated_Risk";
  self_reported_value?: string;
  observed_transcript_value: string;
  proposed_value: string;
  delta_severity: "Low" | "Moderate" | "High" | "Critical";
  supporting_quotes: string[];
  clinical_rationale?: string;
}

const SEVERITY_BADGE: Record<Delta["delta_severity"], string> = {
  Low: "bg-muted text-foreground border-border",
  Moderate: "bg-amber-100 text-amber-900 border-amber-300",
  High: "bg-orange-100 text-orange-900 border-orange-300",
  Critical: "bg-destructive/10 text-destructive border-destructive/40",
};

const DISCREPANCY_LABEL: Record<Delta["discrepancy_type"], string> = {
  Variance: "Variance",
  Contradiction: "Contradiction",
  Unstated_Risk: "Unstated Risk",
};

const PIPELINE_LABEL: Record<string, string> = {
  survey_completed: "Survey Completed",
  delta_reconciled: "Delta Reconciled",
  charter_drafted: "Charter Drafted",
  hitl_locked: "HITL Locked",
  vfo_active: "VFO Active",
};

function DeltaCard({ delta, checked, onToggle }: { delta: Delta; checked: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-1" />
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs font-medium text-foreground">{delta.variable_path}</code>
            <Badge variant="outline" className={cn("text-[10px]", SEVERITY_BADGE[delta.delta_severity])}>
              {delta.delta_severity}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {DISCREPANCY_LABEL[delta.discrepancy_type]}
            </Badge>
          </div>
          <p className="text-sm text-foreground">
            {delta.self_reported_value ? (
              <>
                Self-reported: <span className="text-muted-foreground">{delta.self_reported_value}</span> → Transcript:{" "}
              </>
            ) : (
              "Transcript reveals: "
            )}
            <span className="font-medium">{delta.observed_transcript_value}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Will save as: <code className="font-medium text-foreground">{delta.proposed_value}</code>
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpanded((e) => !e)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border p-3 pt-2">
          {delta.clinical_rationale && <p className="text-xs text-muted-foreground">{delta.clinical_rationale}</p>}
          {delta.supporting_quotes.map((q, i) => (
            <div key={i} className="flex gap-2 rounded-md bg-muted/40 p-2 text-xs italic text-muted-foreground">
              <Quote className="h-3 w-3 shrink-0" />
              <span>"{q}"</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single entry point for the Causal AI Platform, staff-side — Ontology
 *  Assessment, Meeting Transcripts, Delta Reconciliation, and Review & Lock
 *  as one stepped flow (matching the onboarding/Charter Intake wizard
 *  pattern), rather than three separate pages a staff member had to
 *  navigate between by hand. Supersedes the earlier separate
 *  HouseholdOntology.tsx / DeltaReconciliationWorkbench.tsx pages. */
export default function CausalAIWorkbench() {
  const { householdId } = useParams<{ householdId: string }>();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(1);
  const [loading, setLoading] = useState(true);
  const [householdLabel, setHouseholdLabel] = useState("");

  // Ontology
  const [latest, setLatest] = useState<OntologyAssessment | null>(null);
  const [pastCount, setPastCount] = useState(0);
  const [flags, setFlags] = useState<RiskFlag[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [savingOntology, setSavingOntology] = useState(false);

  // Meeting transcripts (shared with the Charter v2.0 wizard's own step)
  const [transcripts, setTranscripts] = useState<MeetingTranscript[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [savingTranscripts, setSavingTranscripts] = useState(false);

  // Delta reconciliation
  const [transcriptId, setTranscriptId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [deltas, setDeltas] = useState<Delta[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [savingDeltas, setSavingDeltas] = useState(false);

  const [locking, setLocking] = useState(false);

  const load = async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const [{ data: household }, ontology, charterData] = await Promise.all([
        supabase.from("households").select("label").eq("id", householdId).maybeSingle(),
        callFn("household-ontology", { action: "load", household_id: householdId }),
        loadCharterIntake(householdId),
      ]);
      setHouseholdLabel(household?.label || "Household");
      setLatest(ontology.latest ?? null);
      setPastCount(ontology.assessments?.length ?? 0);
      setFlags(ontology.flags ?? []);
      setPipelineStatus(ontology.causal_pipeline_status ?? null);
      setTranscripts(charterData.charter.meeting_transcripts ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load Workbench");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const handleSaveOntology = async (payload: OntologySavePayload) => {
    if (!householdId) return;
    setSavingOntology(true);
    try {
      const result = await callFn("household-ontology", { action: "save", household_id: householdId, ...payload });
      toast.success("Assessment saved");
      setLatest(result.assessment);
      setFlags(result.flags ?? []);
      setPastCount((c) => c + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save assessment");
    } finally {
      setSavingOntology(false);
    }
  };

  const handleSync = async () => {
    if (!householdId) return;
    setSyncing(true);
    try {
      const data = await syncMeetingTranscripts(householdId);
      setTranscripts(data.charter.meeting_transcripts ?? []);
      if (data.folder_missing) {
        toast.error("No Meeting Notes folder found for this household's Vault.");
      } else {
        toast.success(data.synced > 0 ? `Synced ${data.synced} transcript${data.synced === 1 ? "" : "s"}.` : "No new or changed files found.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveTranscripts = async (rows: MeetingTranscript[]) => {
    if (!householdId) return;
    setSavingTranscripts(true);
    try {
      // advanceTo: 1 -- this flow is independent of the Charter v2.0
      // wizard's own step progression (household_charters.step), so this
      // never advances it; GREATEST(current, 1) is always a no-op there.
      const charter = await saveCharterIntakeField(householdId, "meeting_transcripts", rows, 1);
      setTranscripts(charter.meeting_transcripts ?? []);
      toast.success("Transcript list updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save transcript list");
    } finally {
      setSavingTranscripts(false);
    }
  };

  const runAnalysis = async () => {
    if (!householdId || !transcriptId) return;
    setAnalyzing(true);
    setDeltas([]);
    setAccepted(new Set());
    try {
      const result = await callFn("delta-engine-reconcile", {
        action: "reconcile",
        household_id: householdId,
        transcript_id: transcriptId,
      });
      setDeltas(result.deltas ?? []);
      if ((result.deltas ?? []).length === 0) {
        toast.info("No deltas detected — the transcript doesn't diverge from the self-reported baseline.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delta analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleAccept = (idx: number) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const saveAccepted = async () => {
    if (!householdId || accepted.size === 0) return;
    setSavingDeltas(true);
    try {
      const acceptedDeltas = Array.from(accepted).map((i) => ({
        variable_path: deltas[i].variable_path,
        proposed_value: deltas[i].proposed_value,
      }));
      const result = await callFn("household-ontology", {
        action: "apply_deltas",
        household_id: householdId,
        accepted_deltas: acceptedDeltas,
      });
      setLatest(result.assessment);
      setFlags(result.flags ?? []);
      setPipelineStatus("delta_reconciled");
      setDeltas([]);
      setAccepted(new Set());
      toast.success(`Saved a new assessment with ${acceptedDeltas.length} reconciled field${acceptedDeltas.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save reconciled assessment");
    } finally {
      setSavingDeltas(false);
    }
  };

  const lockAndRatify = async () => {
    if (!householdId) return;
    setLocking(true);
    try {
      await callFn("household-ontology", { action: "lock_and_ratify", household_id: householdId });
      setPipelineStatus("hitl_locked");
      toast.success("Household Ontology locked and ratified");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to lock");
    } finally {
      setLocking(false);
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
            <h1 className="font-serif text-2xl">Causal AI Workbench — {householdLabel}</h1>
            <p className="text-sm text-muted-foreground">
              {pastCount > 0 ? `${pastCount} assessment${pastCount === 1 ? "" : "s"} on file.` : "No assessments on file yet."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pipelineStatus && <Badge variant="outline">{PIPELINE_LABEL[pipelineStatus] || pipelineStatus}</Badge>}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={locking || pipelineStatus === "hitl_locked"}>
                  {locking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                  Lock &amp; Ratify
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Lock this household's Ontology?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This marks the Causal AI Platform pipeline as HITL Locked for {householdLabel}. It doesn't change
                    any data — it's a staff sign-off that the current assessment has been reviewed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={lockAndRatify}>Lock &amp; Ratify</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <OnboardingStepper current={current} furthest={4} onSelect={setCurrent} steps={WORKBENCH_STEPS} />

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {current === 1 && householdId && <GeorgiaDiagnosticCard householdId={householdId} />}
            {current === 1 && <StepOntologyAssessment latest={latest} saving={savingOntology} onSave={handleSaveOntology} />}

            {current === 2 && (
              <StepMeetingTranscripts transcripts={transcripts} syncing={syncing} saving={savingTranscripts} onSync={handleSync} onSave={handleSaveTranscripts} />
            )}

            {current === 3 && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Run Delta Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {transcripts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No meeting transcripts synced yet — go to the Meeting Transcripts step first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={transcriptId} onValueChange={setTranscriptId}>
                          <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="Choose a synced transcript" />
                          </SelectTrigger>
                          <SelectContent>
                            {transcripts.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button onClick={runAnalysis} disabled={!transcriptId || analyzing}>
                          {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                          Run Delta Analysis
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {deltas.length > 0 && (
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                      <CardTitle className="text-base">Detected Deltas ({deltas.length})</CardTitle>
                      <Button size="sm" onClick={saveAccepted} disabled={accepted.size === 0 || savingDeltas}>
                        {savingDeltas ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save {accepted.size > 0 ? `${accepted.size} Accepted` : ""}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {deltas.map((d, i) => (
                        <DeltaCard key={i} delta={d} checked={accepted.has(i)} onToggle={() => toggleAccept(i)} />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {current === 4 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Pipeline status: <span className="font-medium text-foreground">{pipelineStatus ? PIPELINE_LABEL[pipelineStatus] || pipelineStatus : "Not started"}</span>
                  </p>
                  <p>{pastCount} assessment{pastCount === 1 ? "" : "s"} on file, {transcripts.length} transcript{transcripts.length === 1 ? "" : "s"} synced.</p>
                  <p>
                    Once the Ontology reflects the most recent real conversation with this household, use "Lock &amp;
                    Ratify" above to sign off.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <ActiveRiskFlags flags={flags} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
