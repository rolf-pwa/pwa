import { useState } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

// Mirrors supabase/functions/_shared/causal-dag-evaluator.ts's TypeScript
// shapes exactly (the single source of truth for these fields) — a plain
// type-only duplication, not runtime logic, so there's no drift risk the
// way duplicating the actual DAG rules would carry.
type PressureIndex = "Low" | "Moderate" | "High" | "Critical";

interface HubFinancialState {
  liquid_capital_cad?: number;
  illiquid_capital_cad?: number;
  monthly_burn_rate_cad?: number;
  financial_literacy_score?: number;
  tax_liability_identified?: boolean;
  existing_fiduciary_team?: boolean;
}

interface HubRelationalState {
  spousal_alignment_score?: number;
  begging_hand_pressure_index?: PressureIndex;
  secrecy_isolation_score?: number;
  dependents_count?: number;
}

interface HubEmotionalState {
  ticker_shock_vulnerability?: "Low" | "Moderate" | "High";
  decision_behavior_type?: "Paralysis" | "Balanced" | "Impulsive";
  guilt_survivor_index?: number;
  imposter_syndrome_score?: number;
  psychological_stage_goldbart?: "Honeymoon" | "Wealth_Acceptance" | "Identity_Consolidation" | "Stewardship";
  transition_phase_bradley?: "Anticipation" | "Ending" | "Passage" | "New_Normal";
}

export type EventSpokeType = "inheritance" | "business_exit" | "executive_retirement" | "pre_exit_growth";

interface InheritanceSpoke {
  bereavement_stage?: "Acute_Grief" | "Early_Processing" | "Acceptance" | "Complicated_Grief";
  blood_money_custodianship_score?: number;
  sibling_equity_friction_score?: number;
  executor_role_conflict?: boolean;
  legacy_asset_concentration_pct?: number;
  bc_probate_exposure?: boolean;
}

interface BusinessExitSpoke {
  identity_detachment_score?: number;
  daily_purpose_void_score?: number;
  builder_vs_steward_mindset?: string;
  need_for_control_score?: number;
  angel_investment_urgency_index?: PressureIndex;
  earn_out_obligations?: boolean;
}

interface ExecutiveRetirementSpoke {
  company_stock_loyalty_score?: number;
  equity_concentration_pct?: number;
  corporate_status_deprivation_score?: number;
  tax_acceleration_vulnerability_index?: PressureIndex;
  expense_account_decoupling_index?: number;
}

interface PreExitGrowthSpoke {
  paper_vs_liquid_ratio?: number;
  anticipation_phase_stage?: string;
  premature_commitment_index?: PressureIndex;
  transaction_probability?: number;
  qsbs_or_estate_staging_completed?: boolean;
}

type EventSpokeData = InheritanceSpoke | BusinessExitSpoke | ExecutiveRetirementSpoke | PreExitGrowthSpoke;

export interface RiskFlag {
  rule_id: string;
  risk_name: string;
  severity: "Low" | "Moderate" | "High" | "Critical";
  action: string;
}

export interface OntologyAssessment {
  id: string;
  assessment_date: string;
  financial_state: HubFinancialState | null;
  relational_state: HubRelationalState | null;
  emotional_state: HubEmotionalState | null;
  event_spoke_type: EventSpokeType | null;
  event_spoke_data: EventSpokeData | null;
  source_georgia2_lead_id: string | null;
  seeded_from: Record<string, unknown> | null;
}

export interface OntologySavePayload {
  financial_state: HubFinancialState;
  relational_state: HubRelationalState;
  emotional_state: HubEmotionalState;
  event_spoke_type: EventSpokeType | null;
  event_spoke_data: EventSpokeData | null;
}

interface Props {
  latest: OntologyAssessment | null;
  saving: boolean;
  onSave: (payload: OntologySavePayload) => void;
}

const PRESSURE_OPTIONS: PressureIndex[] = ["Low", "Moderate", "High", "Critical"];
const SPOKE_LABELS: Record<EventSpokeType, string> = {
  inheritance: "Inheritance",
  business_exit: "Business Exit / IPO",
  executive_retirement: "Executive Retirement",
  pre_exit_growth: "Pre-Exit Growth",
};

function ScoreScale({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border text-sm font-medium transition-colors",
            value === n
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:border-primary/60",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function PressureSelect({
  value,
  onChange,
}: {
  value: PressureIndex | undefined;
  onChange: (v: PressureIndex) => void;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as PressureIndex)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Not set" />
      </SelectTrigger>
      <SelectContent>
        {PRESSURE_OPTIONS.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SEVERITY_TONE: Record<RiskFlag["severity"], string> = {
  Low: "border-border bg-muted/40 text-foreground",
  Moderate: "border-amber-300 bg-amber-50 text-amber-900",
  High: "border-orange-300 bg-orange-50 text-orange-900",
  Critical: "border-destructive/40 bg-destructive/5 text-destructive",
};

/** Staff-facing Hub & Spoke Ontology assessment — manual entry only in this
 *  pass (Phase 1). AI-assisted drafting from a real transcript arrives with
 *  Phase 2's Delta Engine; this form is the honest, staff-typed baseline
 *  until then. Every field is optional and this never blocks anything —
 *  matches StepHouseholdContext.tsx's own "everything optional" convention. */
export function StepOntologyAssessment({ latest, saving, onSave }: Props) {
  const [financial, setFinancial] = useState<HubFinancialState>(latest?.financial_state ?? {});
  const [relational, setRelational] = useState<HubRelationalState>(latest?.relational_state ?? {});
  const [emotional, setEmotional] = useState<HubEmotionalState>(latest?.emotional_state ?? {});
  const [spokeType, setSpokeType] = useState<EventSpokeType | "">(latest?.event_spoke_type ?? "");
  const [spokeData, setSpokeData] = useState<EventSpokeData>(latest?.event_spoke_data ?? {});

  const patchFinancial = (p: Partial<HubFinancialState>) => setFinancial((prev) => ({ ...prev, ...p }));
  const patchRelational = (p: Partial<HubRelationalState>) => setRelational((prev) => ({ ...prev, ...p }));
  const patchEmotional = (p: Partial<HubEmotionalState>) => setEmotional((prev) => ({ ...prev, ...p }));
  const patchSpoke = (p: Partial<EventSpokeData>) => setSpokeData((prev) => ({ ...prev, ...p }));

  const save = () =>
    onSave({
      financial_state: financial,
      relational_state: relational,
      emotional_state: emotional,
      event_spoke_type: spokeType || null,
      event_spoke_data: spokeType ? spokeData : null,
    });

  return (
    <div className="space-y-6">
      {latest?.seeded_from ? (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Seeded from Ask Georgia</p>
            <p className="mt-1">
              This household's diagnostic answers from before conversion are on file for reference — the
              fields below are the real assessment and start blank until filled in by staff.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Financial State</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Liquid capital (CAD)</Label>
            <Input
              type="number"
              value={financial.liquid_capital_cad ?? ""}
              onChange={(e) => patchFinancial({ liquid_capital_cad: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Illiquid capital (CAD)</Label>
            <Input
              type="number"
              value={financial.illiquid_capital_cad ?? ""}
              onChange={(e) => patchFinancial({ illiquid_capital_cad: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Monthly burn rate (CAD)</Label>
            <Input
              type="number"
              value={financial.monthly_burn_rate_cad ?? ""}
              onChange={(e) => patchFinancial({ monthly_burn_rate_cad: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Financial literacy (1-10)</Label>
            <ScoreScale value={financial.financial_literacy_score} onChange={(n) => patchFinancial({ financial_literacy_score: n })} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="ont-tax-id"
              checked={financial.tax_liability_identified ?? false}
              onCheckedChange={(c) => patchFinancial({ tax_liability_identified: c === true })}
            />
            <Label htmlFor="ont-tax-id" className="text-sm font-normal">
              Tax liability identified
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="ont-fiduciary-team"
              checked={financial.existing_fiduciary_team ?? false}
              onCheckedChange={(c) => patchFinancial({ existing_fiduciary_team: c === true })}
            />
            <Label htmlFor="ont-fiduciary-team" className="text-sm font-normal">
              Existing fiduciary team in place
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Relational State</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Spousal/partner alignment (1-10)</Label>
            <ScoreScale value={relational.spousal_alignment_score} onChange={(n) => patchRelational({ spousal_alignment_score: n })} />
          </div>
          <div className="space-y-1.5">
            <Label>Secrecy/isolation (1-10)</Label>
            <ScoreScale value={relational.secrecy_isolation_score} onChange={(n) => patchRelational({ secrecy_isolation_score: n })} />
          </div>
          <div className="space-y-1.5">
            <Label>"Begging hand" pressure index</Label>
            <PressureSelect
              value={relational.begging_hand_pressure_index}
              onChange={(v) => patchRelational({ begging_hand_pressure_index: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Dependents count</Label>
            <Input
              type="number"
              value={relational.dependents_count ?? ""}
              onChange={(e) => patchRelational({ dependents_count: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Emotional State</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Guilt/survivor index (1-10)</Label>
            <ScoreScale value={emotional.guilt_survivor_index} onChange={(n) => patchEmotional({ guilt_survivor_index: n })} />
          </div>
          <div className="space-y-1.5">
            <Label>Imposter syndrome (1-10)</Label>
            <ScoreScale value={emotional.imposter_syndrome_score} onChange={(n) => patchEmotional({ imposter_syndrome_score: n })} />
          </div>
          <div className="space-y-1.5">
            <Label>Ticker shock vulnerability</Label>
            <Select
              value={emotional.ticker_shock_vulnerability ?? ""}
              onValueChange={(v) => patchEmotional({ ticker_shock_vulnerability: v as HubEmotionalState["ticker_shock_vulnerability"] })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {(["Low", "Moderate", "High"] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Decision behavior type</Label>
            <Select
              value={emotional.decision_behavior_type ?? ""}
              onValueChange={(v) => patchEmotional({ decision_behavior_type: v as HubEmotionalState["decision_behavior_type"] })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {(["Paralysis", "Balanced", "Impulsive"] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Psychological stage (Goldbart)</Label>
            <Select
              value={emotional.psychological_stage_goldbart ?? ""}
              onValueChange={(v) =>
                patchEmotional({ psychological_stage_goldbart: v as HubEmotionalState["psychological_stage_goldbart"] })
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {(["Honeymoon", "Wealth_Acceptance", "Identity_Consolidation", "Stewardship"] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Transition phase (Bradley)</Label>
            <Select
              value={emotional.transition_phase_bradley ?? ""}
              onValueChange={(v) => patchEmotional({ transition_phase_bradley: v as HubEmotionalState["transition_phase_bradley"] })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {(["Anticipation", "Ending", "Passage", "New_Normal"] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Event Spoke</CardTitle>
          <p className="text-xs text-muted-foreground">Which catalyst-specific detail applies to this household.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Spoke type</Label>
            <Select
              value={spokeType}
              onValueChange={(v) => {
                setSpokeType(v as EventSpokeType);
                setSpokeData({});
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SPOKE_LABELS) as EventSpokeType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {SPOKE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {spokeType === "inheritance" && (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bereavement stage</Label>
                <Select
                  value={(spokeData as InheritanceSpoke).bereavement_stage ?? ""}
                  onValueChange={(v) => patchSpoke({ bereavement_stage: v as InheritanceSpoke["bereavement_stage"] })}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Acute_Grief", "Early_Processing", "Acceptance", "Complicated_Grief"] as const).map((o) => (
                      <SelectItem key={o} value={o}>
                        {o.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Blood-money custodianship (1-10)</Label>
                <ScoreScale
                  value={(spokeData as InheritanceSpoke).blood_money_custodianship_score}
                  onChange={(n) => patchSpoke({ blood_money_custodianship_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sibling equity friction (1-10)</Label>
                <ScoreScale
                  value={(spokeData as InheritanceSpoke).sibling_equity_friction_score}
                  onChange={(n) => patchSpoke({ sibling_equity_friction_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Legacy asset concentration (%)</Label>
                <Input
                  type="number"
                  value={(spokeData as InheritanceSpoke).legacy_asset_concentration_pct ?? ""}
                  onChange={(e) =>
                    patchSpoke({ legacy_asset_concentration_pct: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ont-executor-conflict"
                  checked={(spokeData as InheritanceSpoke).executor_role_conflict ?? false}
                  onCheckedChange={(c) => patchSpoke({ executor_role_conflict: c === true })}
                />
                <Label htmlFor="ont-executor-conflict" className="text-sm font-normal">
                  Executor role conflict
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ont-bc-probate"
                  checked={(spokeData as InheritanceSpoke).bc_probate_exposure ?? false}
                  onCheckedChange={(c) => patchSpoke({ bc_probate_exposure: c === true })}
                />
                <Label htmlFor="ont-bc-probate" className="text-sm font-normal">
                  BC probate exposure
                </Label>
              </div>
            </div>
          )}

          {spokeType === "business_exit" && (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Identity detachment (1-10)</Label>
                <ScoreScale
                  value={(spokeData as BusinessExitSpoke).identity_detachment_score}
                  onChange={(n) => patchSpoke({ identity_detachment_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Daily purpose void (1-10)</Label>
                <ScoreScale
                  value={(spokeData as BusinessExitSpoke).daily_purpose_void_score}
                  onChange={(n) => patchSpoke({ daily_purpose_void_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Need for control (1-10)</Label>
                <ScoreScale
                  value={(spokeData as BusinessExitSpoke).need_for_control_score}
                  onChange={(n) => patchSpoke({ need_for_control_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Builder vs. steward mindset</Label>
                <Input
                  value={(spokeData as BusinessExitSpoke).builder_vs_steward_mindset ?? ""}
                  onChange={(e) => patchSpoke({ builder_vs_steward_mindset: e.target.value })}
                  placeholder="e.g. Pure_Builder"
                />
                <p className="text-[11px] text-muted-foreground">
                  The Angel Depletion rule checks for the exact value "Pure_Builder".
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Angel investment urgency</Label>
                <PressureSelect
                  value={(spokeData as BusinessExitSpoke).angel_investment_urgency_index}
                  onChange={(v) => patchSpoke({ angel_investment_urgency_index: v })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ont-earnout"
                  checked={(spokeData as BusinessExitSpoke).earn_out_obligations ?? false}
                  onCheckedChange={(c) => patchSpoke({ earn_out_obligations: c === true })}
                />
                <Label htmlFor="ont-earnout" className="text-sm font-normal">
                  Earn-out obligations
                </Label>
              </div>
            </div>
          )}

          {spokeType === "executive_retirement" && (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Company stock loyalty (1-10)</Label>
                <ScoreScale
                  value={(spokeData as ExecutiveRetirementSpoke).company_stock_loyalty_score}
                  onChange={(n) => patchSpoke({ company_stock_loyalty_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Corporate status deprivation (1-10)</Label>
                <ScoreScale
                  value={(spokeData as ExecutiveRetirementSpoke).corporate_status_deprivation_score}
                  onChange={(n) => patchSpoke({ corporate_status_deprivation_score: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Expense account decoupling (1-10)</Label>
                <ScoreScale
                  value={(spokeData as ExecutiveRetirementSpoke).expense_account_decoupling_index}
                  onChange={(n) => patchSpoke({ expense_account_decoupling_index: n })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Equity concentration (%)</Label>
                <Input
                  type="number"
                  value={(spokeData as ExecutiveRetirementSpoke).equity_concentration_pct ?? ""}
                  onChange={(e) => patchSpoke({ equity_concentration_pct: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tax acceleration vulnerability</Label>
                <PressureSelect
                  value={(spokeData as ExecutiveRetirementSpoke).tax_acceleration_vulnerability_index}
                  onChange={(v) => patchSpoke({ tax_acceleration_vulnerability_index: v })}
                />
              </div>
            </div>
          )}

          {spokeType === "pre_exit_growth" && (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Paper-vs-liquid ratio (0-1)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(spokeData as PreExitGrowthSpoke).paper_vs_liquid_ratio ?? ""}
                  onChange={(e) => patchSpoke({ paper_vs_liquid_ratio: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Transaction probability (0-1)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(spokeData as PreExitGrowthSpoke).transaction_probability ?? ""}
                  onChange={(e) => patchSpoke({ transaction_probability: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Anticipation phase stage</Label>
                <Input
                  value={(spokeData as PreExitGrowthSpoke).anticipation_phase_stage ?? ""}
                  onChange={(e) => patchSpoke({ anticipation_phase_stage: e.target.value })}
                  placeholder="e.g. Term_Sheet_Signed"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Premature commitment index</Label>
                <PressureSelect
                  value={(spokeData as PreExitGrowthSpoke).premature_commitment_index}
                  onChange={(v) => patchSpoke({ premature_commitment_index: v })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ont-qsbs"
                  checked={(spokeData as PreExitGrowthSpoke).qsbs_or_estate_staging_completed ?? false}
                  onCheckedChange={(c) => patchSpoke({ qsbs_or_estate_staging_completed: c === true })}
                />
                <Label htmlFor="ont-qsbs" className="text-sm font-normal">
                  QSBS / estate staging completed
                </Label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save Assessment
      </Button>
    </div>
  );
}

export function ActiveRiskFlags({ flags }: { flags: RiskFlag[] }) {
  if (flags.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active Risk Flags</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No Causal DAG rules currently fire for this household — either the inputs they depend on aren't
          filled in yet, or none of the thresholds are met.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Active Risk Flags</CardTitle>
        <p className="text-xs text-muted-foreground">Computed deterministically — never by the AI.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {flags.map((f) => (
          <div key={f.rule_id} className={cn("rounded-lg border p-3", SEVERITY_TONE[f.severity])}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-sm font-semibold">{f.risk_name}</p>
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wider">{f.severity}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed">{f.action}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
