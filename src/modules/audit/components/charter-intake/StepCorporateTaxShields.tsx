import { useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import type { GovernanceSnapshot } from "../../hooks/useCharterIntake";
import { FieldWithSuggestion } from "./StepFiduciaryGuidance";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

interface Props {
  trackType: "personal" | "corporate";
  corporatePassiveIncomeAnnual: number | null;
  activeOperationalAssetsValue: number | null;
  cdaBalance: number | null;
  taxFrictionShieldsNote: string | null;
  governanceSnapshot: GovernanceSnapshot | null;
  recomputing: boolean;
  drafting: boolean;
  saving: boolean;
  draftSuggestion?: string;
  onRecompute: () => void;
  onDraft: () => void;
  onSave: (fields: {
    corporate_passive_income_annual: number | null;
    active_operational_assets_value: number | null;
    cda_balance: number | null;
    tax_friction_shields_note: string;
  }) => void;
  onSkip: () => void;
}

export function StepCorporateTaxShields({
  trackType,
  corporatePassiveIncomeAnnual,
  activeOperationalAssetsValue,
  cdaBalance,
  taxFrictionShieldsNote,
  governanceSnapshot,
  recomputing,
  drafting,
  saving,
  draftSuggestion,
  onRecompute,
  onDraft,
  onSave,
  onSkip,
}: Props) {
  const [passiveIncome, setPassiveIncome] = useState(corporatePassiveIncomeAnnual?.toString() ?? "");
  const [activeAssets, setActiveAssets] = useState(activeOperationalAssetsValue?.toString() ?? "");
  const [cda, setCda] = useState(cdaBalance?.toString() ?? "");
  const [note, setNote] = useState(taxFrictionShieldsNote ?? "");

  if (trackType === "personal") {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <h2 className="font-serif text-lg font-semibold text-foreground">Corporate Tax Friction Shields</h2>
            <p className="text-sm text-muted-foreground italic">
              This household has no active corporate structure — Corporate Tax Friction Shields are not
              applicable.
            </p>
          </div>
          <Button onClick={onSkip}>Save and continue</Button>
        </CardContent>
      </Card>
    );
  }

  const taxShields = governanceSnapshot?.tax_shields;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">Corporate Tax Friction Shields</h2>
          <p className="text-sm text-muted-foreground">
            SBD passive-income clawback monitoring and the LCGE 90% active-asset-ratio test, fed by two
            advisor-entered figures — this CRM has no P&amp;L or active-vs-investment asset classification
            to derive these from automatically.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="passive-income">Corporate Passive Income (Annual)</Label>
            <Input id="passive-income" type="number" value={passiveIncome} onChange={(e) => setPassiveIncome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="active-assets">Active Operational Assets Value</Label>
            <Input id="active-assets" type="number" value={activeAssets} onChange={(e) => setActiveAssets(e.target.value)} />
          </div>
        </div>

        <Button size="sm" variant="outline" disabled={recomputing} onClick={onRecompute}>
          {recomputing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Recompute
        </Button>

        {taxShields ? (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">SBD Clawback</p>
              <p className="font-medium">{formatCurrency(taxShields.sbd_clawback)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Asset Ratio</p>
              <p className="font-medium">
                {Math.round(taxShields.active_asset_ratio.ratio * 100)}%
                {taxShields.active_asset_ratio.belowLcgeThreshold && (
                  <span className="ml-1 text-xs text-amber-600">(below 90% LCGE threshold)</span>
                )}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Total Corporate Assets (real, computed)</p>
              <p className="font-medium">{formatCurrency(taxShields.total_corp_assets)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">Not yet computed.</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cda-balance">Capital Dividend Account (CDA) Balance</Label>
          <p className="text-xs text-muted-foreground">
            Must be verified by staff — no formula computes this figure; enter the corporation's actual CDA
            balance.
          </p>
          <Input id="cda-balance" type="number" value={cda} onChange={(e) => setCda(e.target.value)} />
        </div>

        <Button variant="outline" size="sm" disabled={drafting} onClick={onDraft}>
          {drafting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Draft with AI
        </Button>

        <FieldWithSuggestion
          id="tax-friction-note"
          label="Corporate Tax Friction Shields Commentary"
          value={note}
          onChange={setNote}
          suggestion={draftSuggestion}
        />

        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              corporate_passive_income_annual: passiveIncome.trim() ? Number(passiveIncome) : null,
              active_operational_assets_value: activeAssets.trim() ? Number(activeAssets) : null,
              cda_balance: cda.trim() ? Number(cda) : null,
              tax_friction_shields_note: note,
            })
          }
        >
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
}
