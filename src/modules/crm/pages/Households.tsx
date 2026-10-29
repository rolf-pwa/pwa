import { isFormer } from "@/shared/lib/retention";
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { ListRow } from "@/shared/components/ListRow";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { CrmTabs } from "@/modules/crm/components/CrmTabs";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Home,
  Search,
  Loader2,
  ChevronRight,
  Anchor,
  Lock,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { familyTitle } from "@/shared/lib/utils";

interface HouseholdListItem {
  id: string;
  label: string;
  address: string | null;
  family_id: string;
  familyName: string;
  memberCount: number;
  totalAssets: number;
  holdingTankTotal: number;
  holdingTankCount: number;
  governance_status: string | null;
  fiduciary_entity: string | null;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const Households = () => {
  const [households, setHouseholds] = useState<HouseholdListItem[]>([]);
  const [search, setSearch] = useState("");
  const [governanceFilter, setGovernanceFilter] = useState<string>("all");
  const [fiduciaryFilter, setFiduciaryFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [
      { data: hhData },
      { data: families },
      { data: contacts },
      { data: vineyard },
      { data: storehouses },
      { data: holdingTank },
    ] = await Promise.all([
      supabase.from("households").select("*").order("label"),
      supabase.from("families").select("id, name"),
      supabase.from("contacts").select("id, first_name, last_name, household_id"),
      supabase.from("vineyard_accounts").select("contact_id, current_value"),
      supabase.from("storehouses").select("contact_id, current_value, asset_type"),
      supabase.from("holding_tank").select("household_id, current_value").eq("status", "holding"),
    ]);

    const familyMap = new Map((families || []).map((f: any) => [f.id, f.name]));

    // Build a contact→household map for asset aggregation
    const contactHouseholdMap = new Map<string, string>();
    (contacts || []).forEach((c: any) => {
      if (c.household_id) contactHouseholdMap.set(c.id, c.household_id);
    });

    // Aggregate assets per household
    const householdAssets = new Map<string, number>();
    for (const acc of vineyard || []) {
      const hhId = contactHouseholdMap.get(acc.contact_id);
      if (hhId) {
        householdAssets.set(hhId, (householdAssets.get(hhId) || 0) + (Number(acc.current_value) || 0));
      }
    }
    for (const acc of storehouses || []) {
      if (acc.asset_type === 'Primary Residence & Protected Legacy Accounts') continue;
      const hhId = contactHouseholdMap.get(acc.contact_id);
      if (hhId) {
        householdAssets.set(hhId, (householdAssets.get(hhId) || 0) + (Number(acc.current_value) || 0));
      }
    }

    // Aggregate holding tank per household
    const hhHoldingTotal = new Map<string, number>();
    const hhHoldingCount = new Map<string, number>();
    for (const ht of holdingTank || []) {
      if (ht.household_id) {
        hhHoldingTotal.set(ht.household_id, (hhHoldingTotal.get(ht.household_id) || 0) + (Number(ht.current_value) || 0));
        hhHoldingCount.set(ht.household_id, (hhHoldingCount.get(ht.household_id) || 0) + 1);
      }
    }

    const result: HouseholdListItem[] = (hhData || []).filter((hh: any) => !isFormer(hh)).map((hh: any) => ({
      id: hh.id,
      label: hh.label,
      address: hh.address,
      family_id: hh.family_id,
      familyName: familyMap.get(hh.family_id) || "Unknown",
      memberCount: (contacts || []).filter((c: any) => c.household_id === hh.id).length,
      totalAssets: (householdAssets.get(hh.id) || 0) + (hhHoldingTotal.get(hh.id) || 0),
      holdingTankTotal: hhHoldingTotal.get(hh.id) || 0,
      holdingTankCount: hhHoldingCount.get(hh.id) || 0,
      governance_status: hh.governance_status,
      fiduciary_entity: hh.fiduciary_entity,
    }));

    setHouseholds(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = households.filter((hh) => {
    const matchesSearch =
      hh.label.toLowerCase().includes(search.toLowerCase()) ||
      hh.familyName.toLowerCase().includes(search.toLowerCase());
    const matchesGovernance = governanceFilter === "all" || hh.governance_status === governanceFilter;
    const matchesFiduciary = fiduciaryFilter === "all" || hh.fiduciary_entity === fiduciaryFilter;
    return matchesSearch && matchesGovernance && matchesFiduciary;
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Households" },
          ]}
        />
        <CrmTabs />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Households</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {households.length} household{households.length !== 1 ? "s" : ""} across all families
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search households or families…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={governanceFilter} onValueChange={setGovernanceFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Governance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Governance</SelectItem>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="core">Core</SelectItem>
              <SelectItem value="stabilization">Transition</SelectItem>
              <SelectItem value="sovereign">Sovereign</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fiduciaryFilter} onValueChange={setFiduciaryFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Fiduciary" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fiduciaries</SelectItem>
              <SelectItem value="pws">PWS — Strategy</SelectItem>
              <SelectItem value="pwa">PWA — Advisors</SelectItem>
            </SelectContent>
          </Select>
          {(governanceFilter !== "all" || fiduciaryFilter !== "all") && (
            <button
              onClick={() => {
                setGovernanceFilter("all");
                setFiduciaryFilter("all");
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>

        <div>
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No households found.</p>
            ) : (
              <div>
                {filtered.map((hh) => (
                  <ListRow key={hh.id} to={`/households/${hh.id}`}>
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 shrink-0">
                            <Home className="h-4 w-4 text-primary" />
                          </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-serif text-base font-semibold leading-tight">{hh.label}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {familyTitle(hh.familyName)}
                                  {hh.address && ` · ${hh.address}`}
                                </span>
                                {hh.governance_status && hh.governance_status !== "none" && (
                                  <Badge
                                    variant="outline"
                                    className={
                                      hh.governance_status === "stabilization"
                                        ? "text-[10px] border-sanctuary-green/30 text-sanctuary-green bg-sanctuary-green/10"
                                        : hh.governance_status === "sovereign"
                                          ? "text-[10px] border-sanctuary-bronze/30 text-sanctuary-bronze bg-sanctuary-bronze/10"
                                          : "text-[10px]"
                                    }
                                  >
                                    {hh.governance_status === "stabilization"
                                      ? "Transition"
                                      : hh.governance_status === "sovereign"
                                        ? "Sovereign"
                                        : "Core"}
                                  </Badge>
                                )}
                                {hh.fiduciary_entity && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {hh.fiduciary_entity.toUpperCase()}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-foreground">
                                {formatCurrency(hh.totalAssets)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">Assets Under Management</p>
                            </div>
                            {hh.holdingTankCount > 0 && (
                              <div className="text-right">
                                <p className="text-sm font-semibold text-amber-600">
                                  {formatCurrency(hh.holdingTankTotal)}
                                </p>
                                <p className="text-[10px] text-amber-600/70 flex items-center gap-0.5 justify-end">
                                  <Anchor className="h-2.5 w-2.5" />
                                  {hh.holdingTankCount} staged
                                </p>
                              </div>
                            )}
                            <Badge variant="secondary" className="shrink-0">
                              {hh.memberCount} member{hh.memberCount !== 1 ? "s" : ""}
                            </Badge>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  to={`/vault/household/${hh.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded-md text-sanctuary-bronze hover:bg-sanctuary-bronze/10 transition-colors"
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">Household Vault</TooltipContent>
                            </Tooltip>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          </div>
                  </ListRow>
                ))}
              </div>
            )}
        </div>

      </div>
    </AppLayout>
  );
};

export default Households;
