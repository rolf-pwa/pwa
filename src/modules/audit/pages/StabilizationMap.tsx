import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Loader2, Printer, RefreshCw, ArrowLeft, Save, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { format } from "date-fns";
import { useAutoSave, AutoSaveIndicator } from "@/shared/hooks/useAutoSave";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";
import { ActiveRiskFlags, type RiskFlag } from "../components/ontology/StepOntologyAssessment";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type StatusKind = "red" | "amber" | "green";

type ActionItem = { title: string; detail: string };
type ActionPlan = { phase_1: ActionItem[]; phase_2: ActionItem[]; phase_3: ActionItem[] };

type DocumentReadiness = {
  percent: number;
  criticalTotal: number;
  criticalSatisfied: number;
  missingCritical: string[];
  missingRecommended: string[];
};

type CorpBalanceSheetRow = { id: string; name: string; total_assets: number; total_liabilities: number; net_assets: number };
type LoanFlag = {
  id: string;
  description: string;
  liability_type: string;
  current_balance: number;
  due_date: string | null;
  isOverdue: boolean;
  isDueSoon: boolean;
};

type Diagnostics = {
  track_type?: "personal" | "corporate";
  document_readiness?: DocumentReadiness;
  fee_drag?: { year5: number; year10: number; year20: number; fee_drag_pct: number };
  sbd_clawback?: number;
  active_asset_ratio?: { ratio: number; belowLcgeThreshold: boolean };
  usa_staleness?: { onFile: boolean; isStale: boolean; ageYears: number | null };
  estate_hygiene?: { will_status: string | null; poa_status: string | null; beneficiary_coordination_status: string | null };
  aum?: number;
  storehouse_reserves?: { liquidity: number; strategic: number; philanthropic: number; legacy: number };
  insurance_coverage_total?: number;
  vineyard_total?: number;
  holding_tank_total?: number;
  net_worth?: number;
  personal_liabilities_total?: number;
  corp_liabilities_total?: number;
  corporations?: CorpBalanceSheetRow[];
  intercompany_loan_flags?: LoanFlag[];
};

type DiagnosticInputs = {
  assumed_return_rate_pct?: number;
  advisor_fee_rate_pct?: number;
  benchmark_fee_rate_pct?: number;
  corporate_passive_income_annual?: number;
  active_operational_assets_value?: number;
  usa_last_reviewed_date?: string | null;
  will_status?: "missing" | "outdated" | "current" | null;
  poa_status?: "missing" | "current" | null;
  beneficiary_coordination_status?: "uncoordinated" | "coordinated" | null;
};

type SMap = {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  household_id: string | null;
  track_type: "personal" | "corporate";
  diagnostics: Diagnostics;
  diagnostic_inputs: DiagnosticInputs;
  action_plan: ActionPlan;
  client_first_name: string;
  client_last_name: string;
  session_date: string | null;
  event_type: string;
  event_context: string;
  situation_summary: string;
  urgency_flag: string;
  risk_1: string; risk_2: string; risk_3: string; risk_4: string; risk_5: string;
  next_step_1: string; next_step_2: string; next_step_3: string; next_step_4: string; next_step_5: string;
  storehouse_status: string; storehouse_detail: string;
  solicitation_status: string; solicitation_detail: string;
  sovereignty_charter_status: string; sovereignty_charter_detail: string;
  tax_status: string; tax_detail: string;
  footer_note: string;
  generation_status: string;
  generation_error: string | null;
  logic_trace: string | null;
};

const ACTION_PHASES: { key: keyof ActionPlan; label: string; window: string }[] = [
  { key: "phase_1", label: "Immediate", window: "Days 1–30" },
  { key: "phase_2", label: "Structural Purification", window: "Days 31–60" },
  { key: "phase_3", label: "Governance Ratification", window: "Days 61–90" },
];

const fmtCurrency = (n: number | undefined | null) =>
  `$${Math.round(n ?? 0).toLocaleString()}`;

const STATUS_KIND: Record<string, StatusKind> = {
  "Not Established": "red",
  "Not Assessed": "red",
  "Not Started": "red",
  "Partial": "amber",
  "In Progress": "amber",
  "Established": "green",
  "Assessed": "green",
  "Complete": "green",
};

const STATUS_COLOR: Record<StatusKind, string> = {
  red: "#c0392b",
  amber: "#e67e22",
  green: "#27ae60",
};

const EVENT_TYPES = ["Business Exit", "Inheritance", "Sudden Windfall", "Taxable Event"];
const EVENT_CONTEXTS = ["Post-Close Governance", "Pre-Close Planning", "Growth-Stage Governance", "Post-Inheritance Governance", "Post-Windfall Governance", "Ongoing Governance"];
const STOREHOUSE_OPTS = ["Not Established", "Partial", "Established"];
const SOLICITATION_OPTS = ["Not Established", "Partial", "Established"];
const CHARTER_OPTS = ["Not Started", "In Progress", "Complete"];
const TAX_OPTS = ["Not Assessed", "In Progress", "Assessed"];

export default function StabilizationMap() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [map, setMap] = useState<SMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const autoSave = useAutoSave<SMap>({
    data: map,
    enabled: editing,
    onSave: async (current) => {
      const { id: _, lead_id: __, contact_id: ___, household_id: ____, generation_error: _____, ...rest } = current;
      const { error } = await supabase
        .from("stabilization_maps" as any)
        .update({ ...rest, generation_status: "manually_edited" } as any)
        .eq("id", current.id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      return true;
    },
  });

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("stabilization_maps" as any)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setMap(data as unknown as SMap);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Poll while generating
  useEffect(() => {
    if (!map) return;
    if (map.generation_status === "generating" || map.generation_status === "pending") {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line
  }, [map?.generation_status]);

  // Causal AI Platform (Phase 3 integration): a staff-only reference panel
  // showing the household's current Causal DAG flags, fetched live from
  // household-ontology's own `load` action (never cached/duplicated onto
  // this table) — wrapped in print:hidden below, so it never reaches the
  // client-facing printed/exported document. Household-track maps only;
  // the Ontology has no equivalent for the older contact/lead-scoped maps.
  const [causalFlags, setCausalFlags] = useState<RiskFlag[]>([]);
  useEffect(() => {
    if (!map?.household_id) {
      setCausalFlags([]);
      return;
    }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`${FUNCTIONS_URL}/household-ontology`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: "load", household_id: map.household_id }),
        });
        const json = await res.json();
        if (res.ok && !json?.error) setCausalFlags(json.flags ?? []);
      } catch {
        // Non-fatal — the Stabilization Map's own diagnostics render fine without this.
      }
    })();
  }, [map?.household_id]);

  const sessionDateLabel = useMemo(() => {
    if (!map?.session_date) return "";
    try {
      // Parse YYYY-MM-DD format directly to avoid timezone issues
      const match = map.session_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const [, year, month, day] = match;
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        return format(date, "MMMM d, yyyy");
      }
      return format(new Date(map.session_date), "MMMM d, yyyy");
    } catch { return map.session_date; }
  }, [map?.session_date]);

  const fullName = useMemo(() => {
    if (!map) return "";
    return [map.client_first_name, map.client_last_name].filter(Boolean).join(" ");
  }, [map]);

  const updateField = (key: keyof SMap, value: string) => {
    setMap((m) => (m ? { ...m, [key]: value } : m));
    autoSave.markDirty();
  };

  const updateDiagnosticInput = (key: keyof DiagnosticInputs, value: unknown) => {
    setMap((m) => (m ? { ...m, diagnostic_inputs: { ...m.diagnostic_inputs, [key]: value } } : m));
    autoSave.markDirty();
  };

  const updateActionPlanItem = (phase: keyof ActionPlan, index: number, field: keyof ActionItem, value: string) => {
    setMap((m) => {
      if (!m) return m;
      const items = [...(m.action_plan?.[phase] ?? [])];
      items[index] = { ...items[index], [field]: value };
      return { ...m, action_plan: { ...m.action_plan, [phase]: items } };
    });
    autoSave.markDirty();
  };

  const addActionPlanItem = (phase: keyof ActionPlan) => {
    setMap((m) => {
      if (!m) return m;
      const items = [...(m.action_plan?.[phase] ?? []), { title: "", detail: "" }];
      return { ...m, action_plan: { ...m.action_plan, [phase]: items } };
    });
    autoSave.markDirty();
  };

  const removeActionPlanItem = (phase: keyof ActionPlan, index: number) => {
    setMap((m) => {
      if (!m) return m;
      const items = (m.action_plan?.[phase] ?? []).filter((_, i) => i !== index);
      return { ...m, action_plan: { ...m.action_plan, [phase]: items } };
    });
    autoSave.markDirty();
  };

  const save = async () => {
    const ok = await autoSave.flush();
    if (ok) {
      toast.success("Stabilization Map saved");
      setEditing(false);
      load();
    }
  };

  const regenerate = async () => {
    if (!map) return;
    setRegenerating(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stabilization-map-generate`;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ mapId: map.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      toast.success("Regeneration started");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!map) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Stabilization Map not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/leads")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Leads
        </Button>
      </div>
    );
  }

  const isGenerating = map.generation_status === "generating" || map.generation_status === "pending";
  const isHouseholdMap = Boolean(map.household_id);
  const diag: Diagnostics = map.diagnostics ?? {};

  const governanceCards: { label: string; status: string; detail: string }[] = isHouseholdMap
    ? map.track_type === "corporate"
      ? [
          {
            label: "Document Readiness",
            status: !diag.document_readiness
              ? "Not Started"
              : diag.document_readiness.percent >= 100
                ? "Complete"
                : diag.document_readiness.percent > 0
                  ? "In Progress"
                  : "Not Started",
            detail: diag.document_readiness
              ? `${diag.document_readiness.criticalSatisfied}/${diag.document_readiness.criticalTotal} required documents filed`
              : "—",
          },
          {
            label: "USA Status",
            status: !diag.usa_staleness?.onFile ? "Not Assessed" : diag.usa_staleness.isStale ? "In Progress" : "Assessed",
            detail: diag.usa_staleness?.onFile
              ? `Last reviewed ${diag.usa_staleness.ageYears} years ago${diag.usa_staleness.isStale ? " — stale" : ""}`
              : "No Unanimous Shareholder Agreement on file",
          },
          {
            label: "Active Asset Ratio (LCGE)",
            status: !diag.active_asset_ratio
              ? "Not Established"
              : diag.active_asset_ratio.ratio >= 0.9
                ? "Established"
                : diag.active_asset_ratio.ratio >= 0.75
                  ? "Partial"
                  : "Not Established",
            detail: diag.active_asset_ratio
              ? `${Math.round(diag.active_asset_ratio.ratio * 100)}% active — 90% threshold for LCGE eligibility`
              : "Not yet assessed",
          },
          {
            label: "Passive Income Exposure",
            status: !diag.sbd_clawback ? "Established" : "Not Established",
            detail:
              diag.sbd_clawback && diag.sbd_clawback > 0
                ? `${fmtCurrency(diag.sbd_clawback)} SBD room at risk of clawback`
                : "No SBD clawback exposure",
          },
        ]
      : [
          {
            label: "Document Readiness",
            status: !diag.document_readiness
              ? "Not Started"
              : diag.document_readiness.percent >= 100
                ? "Complete"
                : diag.document_readiness.percent > 0
                  ? "In Progress"
                  : "Not Started",
            detail: diag.document_readiness
              ? `${diag.document_readiness.criticalSatisfied}/${diag.document_readiness.criticalTotal} required documents filed`
              : "—",
          },
          {
            label: "Will",
            status:
              diag.estate_hygiene?.will_status === "current"
                ? "Assessed"
                : diag.estate_hygiene?.will_status === "outdated"
                  ? "In Progress"
                  : "Not Assessed",
            detail: diag.estate_hygiene?.will_status || "Not yet reviewed",
          },
          {
            label: "Power of Attorney",
            status:
              diag.estate_hygiene?.poa_status === "current"
                ? "Established"
                : diag.estate_hygiene?.poa_status === "missing"
                  ? "Not Established"
                  : "Not Assessed",
            detail: diag.estate_hygiene?.poa_status || "Not yet reviewed",
          },
          {
            label: "Beneficiary Coordination",
            status:
              diag.estate_hygiene?.beneficiary_coordination_status === "coordinated"
                ? "Complete"
                : diag.estate_hygiene?.beneficiary_coordination_status === "uncoordinated"
                  ? "Not Started"
                  : "Not Assessed",
            detail: diag.estate_hygiene?.beneficiary_coordination_status || "Not yet reviewed",
          },
        ]
    : [];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Toolbar — hidden in print */}
      <div className="print:hidden sticky top-0 z-20 border-b border-[#e2e8f0] bg-[#fafafa]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="text-sm text-[#334155]">
              <span className="font-semibold">Stabilization Map</span>
              <span className="ml-2 text-xs uppercase tracking-wider text-[#a37c58]">
                {map.generation_status.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editing && <AutoSaveIndicator status={autoSave} />}
            {editing ? (
              <>
                <Button size="sm" variant="outline" onClick={async () => {
                  if (autoSave.isDirty) await autoSave.flush();
                  setEditing(false);
                  load();
                }}>Done</Button>
                <Button size="sm" onClick={save} disabled={autoSave.saving}>
                  {autoSave.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save & Close
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating || isGenerating}>
                  {regenerating || isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Regenerate
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={isGenerating}>Edit</Button>
                <Button size="sm" onClick={() => window.print()} disabled={isGenerating}>
                  <Printer className="mr-2 h-4 w-4" /> Print / PDF
                </Button>
              </>
            )}
          </div>
        </div>
        {map.generation_status === "failed" && (
          <div className="border-t border-red-300 bg-red-50 px-6 py-2 text-xs text-red-700">
            Generation failed: {map.generation_error || "Unknown error"}. Click Regenerate to retry.
          </div>
        )}
        {isGenerating && (
          <div className="border-t border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-800">
            Georgia is drafting this map. Auto-refreshing every 3 seconds…
          </div>
        )}
      </div>

      {/* Causal AI Platform — staff-only, never printed/exported. */}
      {isHouseholdMap && (
        <div className="mx-auto max-w-[1100px] px-6 pt-6 print:hidden">
          <ActiveRiskFlags flags={causalFlags} />
        </div>
      )}

      {/* Editor pane */}
      {editing && (
        <div className="mx-auto max-w-[1100px] px-6 py-6 print:hidden">
          <EditorForm
            map={map}
            onChange={updateField}
            onUpdateDiagnosticInput={updateDiagnosticInput}
            onUpdateActionPlanItem={updateActionPlanItem}
            onAddActionPlanItem={addActionPlanItem}
            onRemoveActionPlanItem={removeActionPlanItem}
          />
        </div>
      )}

      {/* Document — A4 preview (landscape for legacy maps, portrait + 2 pages for household maps) */}
      <div
        className={`mx-auto ${isHouseholdMap ? "max-w-[210mm]" : "max-w-[297mm]"} px-6 py-6 print:p-0 print:max-w-none`}
      >
        <div
          className="stab-doc bg-white shadow-lg print:shadow-none"
          style={{
            width: isHouseholdMap ? "210mm" : "297mm",
            minHeight: isHouseholdMap ? "297mm" : "210mm",
            display: "flex",
            fontFamily: "'DM Sans', sans-serif",
            color: "#334155",
          }}
        >
          {/* Sidebar */}
          <aside
            style={{
              width: isHouseholdMap ? "60mm" : "72mm",
              backgroundColor: "#1e293b",
              color: "#fff",
              padding: isHouseholdMap ? "10mm 6mm" : "10mm 7mm",
              display: "flex",
              flexDirection: "column",
              gap: "6mm",
              flexShrink: 0,
            }}
          >
            <div>
              <img
                src={pwLogoWhite}
                alt="ProsperWise"
                style={{ width: isHouseholdMap ? "42mm" : "48mm", height: "auto", display: "block", marginBottom: "3mm" }}
              />
              <div style={{ fontSize: "9pt", fontWeight: 300, color: "rgba(255,255,255,.5)", letterSpacing: ".08em", textTransform: "uppercase" }}>
                Sovereignty Operating System™
              </div>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "16pt", fontWeight: 300, lineHeight: 1.3 }}>
              Don't Invest. <em style={{ fontStyle: "italic", color: "rgba(255,255,255,.7)" }}>Integrate.</em>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
            <div>
              <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.4)", marginBottom: "2mm" }}>Our Process</div>
              <div style={{ marginBottom: "3mm" }}>
                <strong style={{ fontSize: "8.5pt", fontWeight: 600 }}>1 · Stabilization</strong>
                <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Secure your funds, lower the noise, buy time to think clearly.</p>
              </div>
              <div style={{ marginBottom: "3mm" }}>
                <strong style={{ fontSize: "8.5pt", fontWeight: 600 }}>2 · Charter</strong>
                <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Define your governing constitution and liquidity rules.</p>
              </div>
              <div style={{ marginBottom: "3mm" }}>
                <strong style={{ fontSize: "8.5pt", fontWeight: 600 }}>3 · Integration</strong>
                <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Deploy capital, coordinate your team, silence the noise.</p>
              </div>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
            <div>
              {isHouseholdMap ? (
                <>
                  <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600 }}>Prepared By:<br />Rolf Issler, BMgt, CLU</strong>
                  <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Sudden Wealth Specialist, Family CFO</p>
                </>
              ) : (
                <>
                  <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600 }}>Rolf Issler</strong>
                  <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Founder · Sudden Wealth Specialist · Fee-Only · Canada</p>
                </>
              )}
            </div>
            <div style={{ marginTop: "auto", paddingTop: "4mm" }}>
              <div style={{ fontSize: "6.5pt", color: "rgba(255,255,255,.4)", lineHeight: 1.5 }}>
                © {new Date().getFullYear()} ProsperWise Advisors · www.prosperwise.ca<br />
                Data residency: Canada. All client data stored and processed in Canadian data centers in compliance with PIPEDA.
              </div>
            </div>
          </aside>

          {/* Main */}
          <main style={{ flex: 1, padding: "10mm 10mm 0 10mm", display: "flex", flexDirection: "column", gap: "5mm" }}>
            <div style={{ marginBottom: isHouseholdMap ? "3mm" : 0 }}>
              <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: isHouseholdMap ? "3mm" : "1.5mm" }}>
                Stabilization Map &nbsp;·&nbsp; Prepared for <strong>{fullName}</strong>
                {sessionDateLabel && <> &nbsp;·&nbsp; {sessionDateLabel}</>}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: isHouseholdMap ? "25pt" : "26pt", fontWeight: 300, color: "#334155", lineHeight: isHouseholdMap ? 1.3 : 1.1, letterSpacing: "-0.005em" }}>
                {isHouseholdMap ? (
                  "Sovereignty Survey™"
                ) : (
                  <>
                    {map.event_type} &nbsp;·&nbsp; {map.event_context || "Post-Close Governance"}<br />
                    Your Sovereignty OS — Session One Findings
                  </>
                )}
              </div>
              <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: isHouseholdMap ? "4mm" : "2.5mm" }} />
            </div>

            {/* Insight */}
            <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 5mm", display: "flex", flexDirection: "column", gap: "1mm" }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontStyle: "italic", fontSize: "7.5pt", fontWeight: 400, color: "#334155", lineHeight: 1.55 }}>
                {map.situation_summary || "—"}
              </div>
              <div style={{ fontSize: "7.5pt", color: "#334155" }}>{map.urgency_flag || "—"}</div>
            </div>

            {isHouseholdMap ? (
              <>
                {/* Capital & Asset Protection */}
                <div>
                  <div style={colLabel}>Capital &amp; Asset Protection</div>

                  <div style={{ marginBottom: "3mm" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "8.5pt", fontWeight: 600, color: "#334155" }}>Total Assets (AUM)</span>
                      <span style={{ fontSize: "8.5pt", fontWeight: 600, color: "#334155" }}>{fmtCurrency(diag.aum)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1mm 6mm", marginTop: "1.5mm", paddingLeft: "3mm" }}>
                      {(
                        [
                          ["Holding Tank", diag.holding_tank_total],
                          ["Vineyard", diag.vineyard_total],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "7.5pt", color: "#64748b" }}>
                          <span>{label}</span>
                          <span>{fmtCurrency(value ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                    <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "1.5mm 0 1.5mm 3mm" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1mm 6mm", paddingLeft: "3mm" }}>
                      {(
                        [
                          ["Liquidity Reserve", diag.storehouse_reserves?.liquidity],
                          ["Strategic Reserve", diag.storehouse_reserves?.strategic],
                          ["Philanthropic Trust", diag.storehouse_reserves?.philanthropic],
                          ["Legacy Trust", diag.storehouse_reserves?.legacy],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "7.5pt", color: "#64748b" }}>
                          <span>{label}</span>
                          <span>{fmtCurrency(value ?? 0)}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "2mm" }}>
                      <span style={{ fontSize: "8.5pt", fontWeight: 600, color: "#334155" }}>Total Liabilities</span>
                      <span style={{ fontSize: "8.5pt", fontWeight: 600, color: "#c0392b" }}>
                        -{fmtCurrency((diag.personal_liabilities_total ?? 0) + (diag.corp_liabilities_total ?? 0))}
                      </span>
                    </div>
                    <hr style={{ border: "none", borderTop: "1.5px solid #334155", margin: "1.5mm 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "9.5pt", fontWeight: 700, color: "#334155" }}>Net Worth</span>
                      <span style={{ fontSize: "9.5pt", fontWeight: 700, color: "#334155" }}>{fmtCurrency(diag.net_worth ?? diag.aum)}</span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4mm" }}>
                    {typeof diag.sbd_clawback === "number" && map.track_type === "corporate" && (
                      <StatRow label="SBD Clawback" value={fmtCurrency(diag.sbd_clawback)} />
                    )}
                    {diag.active_asset_ratio && map.track_type === "corporate" && (
                      <StatRow
                        label="Active Asset Ratio"
                        value={`${Math.round(diag.active_asset_ratio.ratio * 100)}%${diag.active_asset_ratio.belowLcgeThreshold ? " (below 90% LCGE)" : " (meets 90% LCGE)"}`}
                      />
                    )}
                    <StatRow label="Asset Protection" value={fmtCurrency(diag.insurance_coverage_total ?? 0)} />
                  </div>
                </div>

                {/* Corporate Balance Sheet — per-entity assets/liabilities/net, corporate track only */}
                {map.track_type === "corporate" && diag.corporations && diag.corporations.length > 0 && (
                  <div>
                    <div style={colLabel}>Corporate Balance Sheet</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1mm 4mm", fontSize: "7.5pt" }}>
                      <span style={{ color: "#94a3b8", fontWeight: 600 }}>Entity</span>
                      <span style={{ color: "#94a3b8", fontWeight: 600, textAlign: "right" }}>Assets</span>
                      <span style={{ color: "#94a3b8", fontWeight: 600, textAlign: "right" }}>Liabilities</span>
                      <span style={{ color: "#94a3b8", fontWeight: 600, textAlign: "right" }}>Net</span>
                      {diag.corporations.map((c) => (
                        <Fragment key={c.id}>
                          <span style={{ color: "#334155" }}>{c.name}</span>
                          <span style={{ color: "#64748b", textAlign: "right" }}>{fmtCurrency(c.total_assets)}</span>
                          <span style={{ color: "#c0392b", textAlign: "right" }}>-{fmtCurrency(c.total_liabilities)}</span>
                          <span style={{ color: "#334155", fontWeight: 600, textAlign: "right" }}>{fmtCurrency(c.net_assets)}</span>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {/* Governance & Deceleration Risk Vectors — corporate track moved to its own
                    page (below, after this stab-doc closes): the balance sheet section alone
                    pushes corporate-track content past 297mm, so cramming the governance cards
                    on too just clips them at print time. Personal track still fits, unchanged. */}
                {map.track_type !== "corporate" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(60mm, 1fr))", gap: "3mm" }}>
                    {governanceCards.map((c) => (
                      <StatusCard key={c.label} label={c.label} status={c.status} detail={c.detail} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Two col */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm" }}>
                  <div>
                    <div style={colLabel}>What You're Currently Exposed To</div>
                    {[map.risk_1, map.risk_2, map.risk_3, map.risk_4, map.risk_5].map((r, i) => (
                      <div key={i} style={colItem}>
                        <div style={dot} />
                        <p style={colText}>{r || "—"}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={colLabel}>Your Immediate Next Steps</div>
                    {[map.next_step_1, map.next_step_2, map.next_step_3, map.next_step_4, map.next_step_5].map((s, i) => (
                      <div key={i} style={colItem}>
                        <div style={sq} />
                        <p style={colText}>{s || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3mm" }}>
                  <StatusCard label="Storehouse" status={map.storehouse_status} detail={map.storehouse_detail} />
                  <StatusCard label="Solicitation Protocol" status={map.solicitation_status} detail={map.solicitation_detail} />
                  <StatusCard label="Sovereignty Charter" status={map.sovereignty_charter_status} detail={map.sovereignty_charter_detail} />
                  <StatusCard label="Tax Assessment" status={map.tax_status} detail={map.tax_detail} />
                </div>
              </>
            )}

            {/* Footer — household maps carry the footer to page 2, after the action plan */}
            {!isHouseholdMap && (
              <div style={{ background: "#a37c58", color: "#fff", margin: "auto -10mm 0 -10mm", padding: "3mm 10mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "8.5pt", fontWeight: 500, maxWidth: "60%" }}>{map.footer_note}</div>
              </div>
            )}
          </main>
        </div>

        {/* Page 2 — Governance & Deceleration Risk Vectors (corporate track only —
            the balance sheet section alone already fills page 1 for a corporate
            household, so the governance cards get their own page instead of
            being clipped at print time). */}
        {isHouseholdMap && map.track_type === "corporate" && (
          <div
            className="stab-doc-page2 bg-white shadow-lg print:shadow-none mt-6 print:mt-0"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "12mm",
              display: "flex",
              flexDirection: "column",
              gap: "5mm",
              fontFamily: "'DM Sans', sans-serif",
              color: "#334155",
              pageBreakBefore: "always",
              breakBefore: "page",
            }}
          >
            <div>
              <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
                Stabilization Map &nbsp;·&nbsp; Prepared for <strong>{fullName}</strong>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "18pt", fontWeight: 300, color: "#334155", lineHeight: 1.1 }}>
                Governance &amp; Deceleration Risk Vectors
              </div>
              <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "2.5mm" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(60mm, 1fr))", gap: "4mm" }}>
              {governanceCards.map((c) => (
                <StatusCard key={c.label} label={c.label} status={c.status} detail={c.detail} />
              ))}
              {diag.intercompany_loan_flags?.map((f) => (
                <StatusCard
                  key={f.id}
                  label={f.description}
                  status={f.isOverdue ? "Not Established" : "Partial"}
                  detail={`${fmtCurrency(f.current_balance)}${f.due_date ? ` — due ${f.due_date}` : ""}${f.isOverdue ? " (OVERDUE — s.15(2) deemed-income risk)" : " (due soon)"}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Page 3 — 90-Day Stabilization Action Plan (household maps only) */}
        {isHouseholdMap && (
          <div
            className="stab-doc-page2 bg-white shadow-lg print:shadow-none mt-6 print:mt-0"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "12mm",
              display: "flex",
              flexDirection: "column",
              gap: "5mm",
              fontFamily: "'DM Sans', sans-serif",
              color: "#334155",
              pageBreakBefore: "always",
              breakBefore: "page",
            }}
          >
            <div>
              <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
                Stabilization Map &nbsp;·&nbsp; Prepared for <strong>{fullName}</strong>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "18pt", fontWeight: 300, color: "#334155", lineHeight: 1.1 }}>
                90-Day Stabilization Plan
              </div>
              <hr style={{ width: "18mm", height: "3px", background: "#a37c58", border: "none", marginTop: "2.5mm" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8mm", flex: 1 }}>
              {ACTION_PHASES.map((phase) => (
                <div key={phase.key}>
                  <div style={{ fontSize: "8pt", fontWeight: 600, color: "#334155", marginBottom: "2mm" }}>
                    {phase.label} <span style={{ color: "#94a3b8", fontWeight: 400 }}>· {phase.window}</span>
                  </div>
                  {(map.action_plan?.[phase.key] ?? []).length === 0 ? (
                    <p style={{ ...colText, color: "#94a3b8" }}>—</p>
                  ) : (
                    map.action_plan[phase.key].map((item, i) => (
                      <div key={i} style={{ marginBottom: "3mm" }}>
                        <p style={{ ...colText, fontWeight: 600 }}>{item.title || "—"}</p>
                        {item.detail && <p style={{ ...colText, color: "#64748b" }}>{item.detail}</p>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ background: "#a37c58", color: "#fff", margin: "auto -12mm 0 -12mm", padding: "3mm 12mm", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "8.5pt", fontWeight: 500 }}>{map.footer_note}</div>
            </div>
          </div>
        )}

        {map.logic_trace && !editing && (
          <div className="mt-6 rounded-lg border border-[#e2e8f0] bg-white p-4 text-xs text-[#64748b] print:hidden">
            <div className="mb-1 font-semibold uppercase tracking-wider text-[#a37c58]">AI Logic Trace (staff only)</div>
            <p className="whitespace-pre-wrap">{map.logic_trace}</p>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4 ${isHouseholdMap ? "portrait" : "landscape"}; margin: 0; }
          body { background: white !important; }
          .stab-doc, .stab-doc-page2 { box-shadow: none !important; }
        }
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
      `}</style>
    </div>
  );
}

const colLabel: React.CSSProperties = { fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm", paddingBottom: "1.5mm", borderBottom: "1px solid #e2e8f0" };
const colItem: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "3mm", marginBottom: "2.5mm" };
const colText: React.CSSProperties = { fontSize: "8.5pt", color: "#334155", lineHeight: 1.4 };
const dot: React.CSSProperties = { width: "6px", height: "6px", borderRadius: "50%", background: "#a37c58", flexShrink: 0, marginTop: "2pt" };
const sq: React.CSSProperties = { width: "6px", height: "6px", background: "#a37c58", flexShrink: 0, marginTop: "2pt" };

function StatusCard({ label, status, detail }: { label: string; status: string; detail: string }) {
  const kind = STATUS_KIND[status] || "amber";
  return (
    <div style={{ background: "#fafafa", borderLeft: "3px solid #a37c58", padding: "3mm 4mm" }}>
      <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600, color: "#334155", marginBottom: "1mm" }}>
        {label}&nbsp;
        <span style={{ color: STATUS_COLOR[kind], fontSize: "7pt", letterSpacing: ".08em", textTransform: "uppercase" }}>
          {status}
        </span>
      </strong>
      <p style={{ fontSize: "7.5pt", color: "#334155", lineHeight: 1.5 }}>{detail || "—"}</p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={colItem}>
      <div style={dot} />
      <p style={colText}>
        <strong>{label}:</strong> {value}
      </p>
    </div>
  );
}

interface EditorFormProps {
  map: SMap;
  onChange: (k: keyof SMap, v: string) => void;
  onUpdateDiagnosticInput: (k: keyof DiagnosticInputs, v: unknown) => void;
  onUpdateActionPlanItem: (phase: keyof ActionPlan, index: number, field: keyof ActionItem, value: string) => void;
  onAddActionPlanItem: (phase: keyof ActionPlan) => void;
  onRemoveActionPlanItem: (phase: keyof ActionPlan, index: number) => void;
}

const WILL_OPTS = ["missing", "outdated", "current"] as const;
const POA_OPTS = ["missing", "current"] as const;
const BENEFICIARY_OPTS = ["uncoordinated", "coordinated"] as const;

function EditorForm({
  map,
  onChange,
  onUpdateDiagnosticInput,
  onUpdateActionPlanItem,
  onAddActionPlanItem,
  onRemoveActionPlanItem,
}: EditorFormProps) {
  const isHouseholdMap = Boolean(map.household_id);
  const inputs = map.diagnostic_inputs ?? {};

  const F = (key: keyof SMap, label: string, multiline = false) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {multiline ? (
        <Textarea value={(map[key] as string) || ""} onChange={(e) => onChange(key, e.target.value)} rows={2} />
      ) : (
        <Input value={(map[key] as string) || ""} onChange={(e) => onChange(key, e.target.value)} />
      )}
    </div>
  );
  const S = (key: keyof SMap, label: string, opts: string[]) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={(map[key] as string) || opts[0]} onValueChange={(v) => onChange(key, v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  const N = (key: keyof DiagnosticInputs, label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        placeholder={placeholder}
        value={(inputs[key] as number | undefined) ?? ""}
        onChange={(e) => onUpdateDiagnosticInput(key, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </div>
  );
  const IS = (key: keyof DiagnosticInputs, label: string, opts: readonly string[]) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select
        value={(inputs[key] as string) ?? "__unset__"}
        onValueChange={(v) => onUpdateDiagnosticInput(key, v === "__unset__" ? null : v)}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">Not set</SelectItem>
          {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4 rounded-lg border border-[#e2e8f0] bg-white p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {F("client_first_name", "First Name")}
        {F("client_last_name", "Last Name")}
        <div className="space-y-1">
          <Label className="text-xs">Session Date</Label>
          <Input type="date" value={map.session_date || ""} onChange={(e) => onChange("session_date", e.target.value)} />
        </div>
      </div>

      {isHouseholdMap ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Track</Label>
            <Select value={map.track_type || "personal"} onValueChange={(v) => onChange("track_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="corporate">Corporate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {F("situation_summary", "Situation Summary", true)}
          {F("urgency_flag", "Urgency Flag", true)}

          <div className="space-y-2 rounded-md border border-[#e2e8f0] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#a37c58]">Diagnostic Inputs</div>
            <p className="text-[11px] text-muted-foreground">
              These come from documents on file (T2 financials, the USA) — type in what the advisor reads, the
              system computes the figures. Fee drag is paused until CRM3's fee-disclosure data is live.
            </p>
            {map.track_type === "corporate" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {N("corporate_passive_income_annual", "Corporate Passive Income (annual $)")}
                {N("active_operational_assets_value", "Active Operational Assets ($)")}
                <div className="space-y-1">
                  <Label className="text-xs">USA Last Reviewed</Label>
                  <Input
                    type="date"
                    value={(inputs.usa_last_reviewed_date as string) || ""}
                    onChange={(e) => onUpdateDiagnosticInput("usa_last_reviewed_date", e.target.value || null)}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {IS("will_status", "Will Status", WILL_OPTS)}
                {IS("poa_status", "Power of Attorney", POA_OPTS)}
                {IS("beneficiary_coordination_status", "Beneficiary Coordination", BENEFICIARY_OPTS)}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-[#e2e8f0] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#a37c58]">90-Day Action Plan</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {ACTION_PHASES.map((phase) => (
                <div key={phase.key} className="space-y-2">
                  <div className="text-xs font-medium text-[#334155]">
                    {phase.label} <span className="text-muted-foreground">· {phase.window}</span>
                  </div>
                  {(map.action_plan?.[phase.key] ?? []).map((item, i) => (
                    <div key={i} className="space-y-1 rounded border border-[#e2e8f0] p-2">
                      <div className="flex items-center gap-1">
                        <Input
                          className="text-xs"
                          placeholder="Title"
                          value={item.title}
                          onChange={(e) => onUpdateActionPlanItem(phase.key, i, "title", e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => onRemoveActionPlanItem(phase.key, i)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        className="text-xs"
                        placeholder="Detail"
                        rows={2}
                        value={item.detail}
                        onChange={(e) => onUpdateActionPlanItem(phase.key, i, "detail", e.target.value)}
                      />
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => onAddActionPlanItem(phase.key)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {S("event_type", "Event Type", EVENT_TYPES)}
            <div className="space-y-1">
              <Label className="text-xs">Event Context (subtitle)</Label>
              <Select
                value={EVENT_CONTEXTS.includes(map.event_context) ? map.event_context : "__custom__"}
                onValueChange={(v) => onChange("event_context", v === "__custom__" ? (map.event_context || "") : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_CONTEXTS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="mt-1"
                placeholder="Custom subtitle (overrides preset)"
                value={map.event_context || ""}
                onChange={(e) => onChange("event_context", e.target.value)}
              />
            </div>
          </div>
          {F("situation_summary", "Situation Summary", true)}
          {F("urgency_flag", "Urgency Flag", true)}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#a37c58]">Risks</div>
              {[1, 2, 3, 4, 5].map((n) => F(`risk_${n}` as keyof SMap, `Risk ${n}`))}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#a37c58]">Next Steps</div>
              {[1, 2, 3, 4, 5].map((n) => F(`next_step_${n}` as keyof SMap, `Next Step ${n}`))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {S("storehouse_status", "Storehouse Status", STOREHOUSE_OPTS)}
            {F("storehouse_detail", "Storehouse Detail")}
            {S("solicitation_status", "Solicitation Status", SOLICITATION_OPTS)}
            {F("solicitation_detail", "Solicitation Detail")}
            {S("sovereignty_charter_status", "Sovereignty Charter Status", CHARTER_OPTS)}
            {F("sovereignty_charter_detail", "Sovereignty Charter Detail")}
            {S("tax_status", "Tax Status", TAX_OPTS)}
            {F("tax_detail", "Tax Detail")}
          </div>
        </>
      )}
      {F("footer_note", "Footer Note", true)}
    </div>
  );
}
