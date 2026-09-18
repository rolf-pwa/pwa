import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Separator } from "@/shared/components/ui/separator";
import { Progress } from "@/shared/components/ui/progress";
import {
  RefreshCw,
  TrendingUp,
  Home,
  User,
  Loader2,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

interface HouseholdAssets {
  householdId: string;
  householdLabel: string;
  individuals: {
    contactId: string;
    name: string;
    vineyardTotal: number;
    storehouseTotal: number;
  }[];
  total: number;
}

interface FamilyRollupProps {
  familyId: string;
  familyName: string;
  feeTier: string;
  totalAssets: number;
  annualSavings: number;
  discountPct: number;
  onRecalculated: () => void;
}

const TIER_THRESHOLDS = [
  { label: "Dynasty", min: 5_000_000, color: "bg-primary" },
  { label: "Legacy", min: 1_000_000, color: "bg-accent" },
  { label: "Sovereign", min: 0, color: "bg-muted-foreground" },
];

export const FamilyRollup = ({
  familyId,
  familyName,
  feeTier,
  totalAssets,
  annualSavings,
  discountPct,
  onRecalculated,
}: FamilyRollupProps) => {
  const [householdBreakdown, setHouseholdBreakdown] = useState<HouseholdAssets[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadBreakdown();
  }, [familyId]);

  const loadBreakdown = async () => {
    setLoading(true);

    // Fetch households
    const { data: households } = await supabase
      .from("households" as any)
      .select("id, label")
      .eq("family_id", familyId)
      .order("label");

    // Fetch contacts in this family
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, household_id")
      .eq("family_id", familyId);

    if (!contacts || !households) {
      setLoading(false);
      return;
    }

    const contactIds = contacts.map((c: any) => c.id);

    // Fetch all assets for these contacts
    const [vineyardRes, storehouseRes] = await Promise.all([
      contactIds.length > 0
        ? supabase
            .from("vineyard_accounts")
            .select("contact_id, current_value")
            .in("contact_id", contactIds)
        : Promise.resolve({ data: [] }),
      contactIds.length > 0
        ? supabase
            .from("storehouses")
            .select("contact_id, current_value, asset_type")
            .in("contact_id", contactIds)
        : Promise.resolve({ data: [] }),
    ]);

    const vineyardData = (vineyardRes.data as any[]) || [];
    const storehouseData = (storehouseRes.data as any[]) || [];

    const breakdown: HouseholdAssets[] = (households as any[]).map((h: any) => {
      const hhContacts = contacts.filter((c: any) => c.household_id === h.id);
      const individuals = hhContacts.map((c: any) => {
        const vTotal = vineyardData
          .filter((v: any) => v.contact_id === c.id)
          .reduce((sum: number, v: any) => sum + (Number(v.current_value) || 0), 0);
        const sTotal = storehouseData
          .filter((s: any) => s.contact_id === c.id && s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
          .reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0);
        return {
          contactId: c.id,
          name: `${c.first_name} ${c.last_name || ""}`.trim(),
          vineyardTotal: vTotal,
          storehouseTotal: sTotal,
        };
      });

      return {
        householdId: h.id,
        householdLabel: h.label,
        individuals,
        total: individuals.reduce((s, i) => s + i.vineyardTotal + i.storehouseTotal, 0),
      };
    });

    setHouseholdBreakdown(breakdown);
    setLoading(false);
  };

  const recalculateFeeTier = async () => {
    setRecalculating(true);
    try {
      const { error } = await supabase.functions.invoke("calculate-family-fee-tier", {
        body: { familyId },
      });
      if (error) throw error;

      toast.success("Fee tier recalculated.");
      onRecalculated();
      await loadBreakdown();
    } catch {
      toast.error("Failed to recalculate fee tier.");
    } finally {
      setRecalculating(false);
    }
  };

  const grandTotal = householdBreakdown.reduce((s, h) => s + h.total, 0);

  // Progress toward next tier
  const nextTierThreshold =
    feeTier === "sovereign" ? 1_000_000 : feeTier === "legacy" ? 5_000_000 : null;
  const progressPct = nextTierThreshold
    ? Math.min(100, (totalAssets / nextTierThreshold) * 100)
    : 100;

  const formatCurrency = (val: number) =>
    val > 0 ? `$${val.toLocaleString()}` : "—";

  if (loading) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
        Loading financial summary...
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/10">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/20"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <BarChart3 className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Financial Rollup</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); recalculateFeeTier(); }}
          disabled={recalculating}
          className="text-xs"
        >
          {recalculating ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Recalculate Tier
        </Button>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Assets</p>
          <p className="text-lg font-semibold">{formatCurrency(totalAssets)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Discount</p>
          <p className="text-lg font-semibold">{discountPct}%</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Annual Savings</p>
          <p className="text-lg font-semibold text-accent">{formatCurrency(annualSavings)}</p>
        </div>
      </div>

      {/* Tier Progress */}
      {nextTierThreshold && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress to {feeTier === "sovereign" ? "Legacy" : "Dynasty"} Tier</span>
            <span>{formatCurrency(totalAssets)} / {formatCurrency(nextTierThreshold)}</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      <Separator />

      {/* Household Breakdown */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Household Breakdown
        </p>
        {householdBreakdown.map((hh) => (
          <div key={hh.householdId} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Home className="h-3.5 w-3.5 text-accent" />
                <span className="text-sm font-medium">{hh.householdLabel} Household</span>
              </div>
              <span className="text-sm font-semibold">{formatCurrency(hh.total)}</span>
            </div>
            {grandTotal > 0 && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${(hh.total / grandTotal) * 100}%` }}
                />
              </div>
            )}
            {hh.individuals.length > 0 && (
              <div className="space-y-1 pl-5">
                {hh.individuals.map((ind) => {
                  const indTotal = ind.vineyardTotal + ind.storehouseTotal;
                  return (
                    <div key={ind.contactId} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span>{ind.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span title="Vineyard">V: {formatCurrency(ind.vineyardTotal)}</span>
                        <span title="Storehouses">S: {formatCurrency(ind.storehouseTotal)}</span>
                        <span className="font-medium text-foreground">{formatCurrency(indTotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {hh.individuals.length === 0 && (
              <p className="text-xs text-muted-foreground pl-5">No members</p>
            )}
          </div>
        ))}
      </div>
      </div>
      )}
    </div>
  );
};
