import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { toast } from "sonner";
import {
  SERVICE_TIER_LABEL,
  SERVICE_TIER_BAND,
  SERVICE_TIER_CADENCE,
  SERVICE_TIER_ORDER,
  type ServiceTier,
} from "@/shared/lib/serviceTier";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import {
  TreesIcon,
  Home,
  User,
  Crown,
  Shield,
  Baby,
  ChevronRight,
  ChevronDown,
  Loader2,
  ArrowLeft,
  Wallet,
  Grape,
  Landmark,
  Anchor,
  ExternalLink,
  Layers,
  RefreshCw,
} from "lucide-react";
import { FamilyRollup } from "@/modules/crm/components/FamilyRollup";
import { FamilyTaskRollup } from "@/modules/crm/components/FamilyTaskRollup";
import { AddCompanyDialog } from "@/modules/crm/components/AddCompanyDialog";
import { CollapsibleCard } from "@/shared/components/CollapsibleCard";
import { policyTypeLabel } from "@/shared/lib/insurance";

const ROLE_ICONS: Record<string, typeof Crown> = {
  head_of_family: Crown,
  head_of_household: Home,
  spouse: Shield,
  beneficiary: User,
  minor: Baby,
};

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  head_of_household: "Head of Household",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const roleRank = (r: string | null | undefined) => {
  const v = (r || "").toLowerCase();
  if (v === "hof" || v === "head_of_family" || v.includes("head of family")) return 0;
  if (v === "hoh" || v === "head_of_household" || v.includes("head of household")) return 1;
  if (v === "spouse") return 2;
  if (v === "beneficiary") return 3;
  if (v === "minor") return 4;
  return 5;
};

const FamilyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<any>(null);
  const [households, setHouseholds] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [vineyard, setVineyard] = useState<any[]>([]);
  const [storehouses, setStorehouses] = useState<any[]>([]);
  const [holdingTank, setHoldingTank] = useState<any[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<any[]>([]);
  const [openHouseholds, setOpenHouseholds] = useState<Set<string>>(new Set());
  const [openSidebarHoldingTank, setOpenSidebarHoldingTank] = useState(false);
  const [openSidebarVineyard, setOpenSidebarVineyard] = useState(false);
  const [openSidebarStorehouses, setOpenSidebarStorehouses] = useState(false);
  const [recomputingTier, setRecomputingTier] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const { data: fam } = await supabase
      .from("families")
      .select("*")
      .eq("id", id)
      .single();

    if (!fam) {
      setLoading(false);
      return;
    }
    setFamily(fam);

    const [{ data: hhs }, { data: cs }] = await Promise.all([
      supabase.from("households").select("*").eq("family_id", id).order("label"),
      supabase
        .from("contacts")
        .select("id, first_name, last_name, family_role, household_id, email, phone, is_minor")
        .eq("family_id", id),
    ]);

    setHouseholds(hhs || []);
    setContacts(cs || []);
    // Open all households by default
    setOpenHouseholds(new Set((hhs || []).map((h: any) => h.id)));

    const memberIds = (cs || []).map((c: any) => c.id);
    if (memberIds.length > 0) {
      const [{ data: v }, { data: s }, { data: t }, { data: ins }] = await Promise.all([
        supabase.from("vineyard_accounts").select("id, contact_id, account_name, account_type, current_value, book_value").in("contact_id", memberIds),
        supabase.from("storehouses").select("id, contact_id, storehouse_number, label, current_value, book_value, asset_type").in("contact_id", memberIds),
        supabase.from("holding_tank").select("id, contact_id, account_name, account_type, current_value, book_value, custodian, expected_deposit_date").in("contact_id", memberIds).neq("status", "moved"),
        supabase.from("insurance_policies").select("id, contact_id, policy_type, carrier, cash_value, coverage_amount, cash_value_storehouse_id, coverage_storehouse_id").in("contact_id", memberIds),
      ]);
      setVineyard(v || []);
      setStorehouses(s || []);
      setHoldingTank(t || []);
      setInsurancePolicies(ins || []);
    } else {
      setVineyard([]);
      setStorehouses([]);
      setHoldingTank([]);
      setInsurancePolicies([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!family) {
    return (
      <AppLayout>
        <div className="text-center py-24">
          <p className="text-muted-foreground">Family not found.</p>
          <Button variant="link" onClick={() => navigate("/families")}>
            Back to Families
          </Button>
        </div>
      </AppLayout>
    );
  }

  const sumByContact = (rows: any[]) => {
    const map: Record<string, number> = {};
    rows.forEach((r) => {
      map[r.contact_id] = (map[r.contact_id] || 0) + (Number(r.current_value) || 0);
    });
    return map;
  };

  const vineyardByContact = sumByContact(vineyard);
  const storehouseByContact = sumByContact(storehouses.filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts'));
  const holdingByContact = sumByContact(holdingTank);
  // Cash value always belongs to Strategic Reserve, by policy — not linked to a specific
  // storehouse account row, so it can't be broken by deleting a manual account.
  const insuranceCashByContact: Record<string, number> = {};
  insurancePolicies.forEach((p: any) => {
    insuranceCashByContact[p.contact_id] = (insuranceCashByContact[p.contact_id] || 0) + (Number(p.cash_value) || 0);
  });

  const totalVineyard = vineyard.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const totalStorehouses = storehouses
    .filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
    .reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const insuranceCashInStorehouses = insurancePolicies
    .reduce((s: number, p: any) => s + (Number(p.cash_value) || 0), 0);
  const totalHolding = holdingTank.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const totalAUM = totalVineyard + totalStorehouses + insuranceCashInStorehouses + totalHolding;

  const storehouseBreakdown = [1, 2, 3, 4].map((num) => {
    const shForNum = storehouses.filter((s: any) => s.storehouse_number === num);
    const shIds = new Set(shForNum.map((s: any) => s.id));
    const isLegacy = num === 4;
    const shTotal = shForNum
      .filter((s: any) => isLegacy || s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
      .reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0);
    const cashTotal = num === 2
      ? insurancePolicies.reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0)
      : 0;
    const coverageTotal = isLegacy
      ? insurancePolicies
          .filter((p: any) => p.coverage_storehouse_id && shIds.has(p.coverage_storehouse_id))
          .reduce((sum: number, p: any) => sum + (Number(p.coverage_amount) || 0), 0)
      : 0;
    return { num, count: shForNum.length, total: shTotal + cashTotal + coverageTotal };
  });
  const storehousesCount = storehouseBreakdown.reduce((s, r) => s + r.count, 0);
  const storehousesDisplayTotal = storehouseBreakdown.reduce((s, r) => s + r.total, 0);

  const toggleHousehold = (hid: string) => {
    setOpenHouseholds((prev) => {
      const next = new Set(prev);
      next.has(hid) ? next.delete(hid) : next.add(hid);
      return next;
    });
  };

  const contactsByHousehold = (hid: string) =>
    contacts
      .filter((c) => c.household_id === hid)
      .sort((a, b) => roleRank(a.family_role) - roleRank(b.family_role));

  const householdTotal = (hid: string) => {
    const mems = contactsByHousehold(hid).map((c) => c.id);
    let total = 0;
    mems.forEach((m) => {
      total += (vineyardByContact[m] || 0) + (storehouseByContact[m] || 0) + (holdingByContact[m] || 0) + (insuranceCashByContact[m] || 0);
    });
    return total;
  };

  const contactTotal = (cid: string) =>
    (vineyardByContact[cid] || 0) + (storehouseByContact[cid] || 0) + (holdingByContact[cid] || 0) + (insuranceCashByContact[cid] || 0);

  const storehouseName = (num: number) => {
    const names: Record<number, string> = {
      1: "Liquidity Reserve",
      2: "Strategic Reserve",
      3: "Philanthropic Trust",
      4: "Legacy Trust",
    };
    return names[num] || "Storehouse";
  };

  const handleRecomputeTier = async () => {
    setRecomputingTier(true);
    try {
      const { data, error } = await supabase.functions.invoke("service-tier-recompute", {
        body: { familyId: family.id },
      });
      if (error) throw error;
      toast.success(
        data?.transitions?.length ? `Tier updated — ${SERVICE_TIER_LABEL[data.transitions[0].newTier as ServiceTier]}` : "Recomputed — no tier change.",
      );
      await fetchData();
    } catch {
      toast.error("Couldn't recompute this family's service tier.");
    } finally {
      setRecomputingTier(false);
    }
  };

  const handleOverrideTier = async (tier: ServiceTier) => {
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("families")
      .update({
        service_tier: tier,
        service_tier_source: "manual_override",
        service_tier_overridden_at: new Date().toISOString(),
        service_tier_overridden_by: userRes?.user?.id,
      } as any)
      .eq("id", family.id);
    if (error) {
      toast.error("Couldn't set the service tier override.");
      return;
    }
    setFamily({ ...family, service_tier: tier, service_tier_source: "manual_override" });
    toast.success(`Service tier manually set to ${SERVICE_TIER_LABEL[tier]}`);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Family Tree", href: "/families" },
            { label: `${family.name} Family` },
          ]}
        />

        {/* Header */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/families")}
                  className="shrink-0 -ml-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="h-12 w-12 shrink-0 rounded-full bg-sanctuary-green text-sanctuary-bronze flex items-center justify-center">
                  <TreesIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold truncate">{family.name} Family</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {households.length} {households.length === 1 ? "Household" : "Households"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {contacts.length} {contacts.length === 1 ? "Individual" : "Individuals"}
                    </Badge>
                    {family.fee_tier && (
                      <Badge className="bg-sanctuary-bronze/20 text-sanctuary-bronze border-sanctuary-bronze/30 uppercase text-[10px]">
                        {family.fee_tier} Fee Tier
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fee tier rollup */}
        <FamilyRollup
          familyId={family.id}
          familyName={family.name}
          feeTier={family.fee_tier}
          totalAssets={Number(family.total_family_assets) || totalAUM}
          annualSavings={Number(family.annual_savings) || 0}
          discountPct={Number(family.fee_tier_discount_pct) || 0}
          onRecalculated={fetchData}
        />

        <div className="flex gap-4 items-start">
          {/* Sidebar */}
          <div className="w-80 shrink-0 space-y-4">
            <CollapsibleCard
              icon={Wallet}
              iconBgClassName="bg-sanctuary-bronze/10"
              iconColorClassName="text-sanctuary-bronze"
              title="Assets Under Management"
              headerRight={
                <p className="text-xl font-bold text-sanctuary-bronze">{formatCurrency(totalAUM)}</p>
              }
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Grape className="h-3.5 w-3.5" /> Portfolio
                  </span>
                  <span className="font-semibold text-primary">{formatCurrency(totalVineyard)}</span>
                </div>
                {storehouseBreakdown.map(({ num, total }) => {
                  if (total === 0) return null;
                  return (
                    <div key={num} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Landmark className="h-3.5 w-3.5" /> {storehouseName(num)}
                      </span>
                      <span className="font-semibold text-accent">{formatCurrency(total)}</span>
                    </div>
                  );
                })}
                {totalHolding > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Anchor className="h-3.5 w-3.5" /> Holding Tank
                    </span>
                    <span className="font-semibold text-amber-600">{formatCurrency(totalHolding)}</span>
                  </div>
                )}
              </div>
            </CollapsibleCard>

            {/* Client Service Tier -- Phase A, staff-only (see plan file). Not
                visible to clients anywhere; client-facing rollout targeted
                January 2027. */}
            <CollapsibleCard
              icon={Layers}
              iconBgClassName="bg-sanctuary-bronze/10"
              iconColorClassName="text-sanctuary-bronze"
              title="Service Tier"
              subtitle="Staff-only — not visible to clients"
              headerRight={
                family.service_tier ? (
                  <Badge className="bg-sanctuary-bronze/20 text-sanctuary-bronze border-sanctuary-bronze/30 text-[10px]">
                    {SERVICE_TIER_LABEL[family.service_tier as ServiceTier]}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Not classified</Badge>
                )
              }
              defaultCollapsed={false}
            >
              <div className="space-y-3 text-sm">
                {family.service_tier && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{SERVICE_TIER_BAND[family.service_tier as ServiceTier]}</p>
                    <p className="text-xs text-muted-foreground">{SERVICE_TIER_CADENCE[family.service_tier as ServiceTier]}</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Grouped AUM (managed only)</span>
                  <span className="font-semibold">
                    {family.grouped_aum_cad != null ? formatCurrency(Number(family.grouped_aum_cad)) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Ratified Charter on file</span>
                  <span className="font-semibold">{family.has_ratified_charter ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-semibold">
                    {family.service_tier_source === "manual_override" ? "Manual override" : "Computed"}
                  </span>
                </div>
                {family.service_tier_computed_at && (
                  <p className="text-[11px] text-muted-foreground">
                    Last recomputed {new Date(family.service_tier_computed_at).toLocaleString("en-CA")}
                  </p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleRecomputeTier}
                  disabled={recomputingTier}
                >
                  {recomputingTier ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Recompute Now
                </Button>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Manual override</p>
                  <Select value={family.service_tier || undefined} onValueChange={(v) => handleOverrideTier(v as ServiceTier)}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Set tier manually" /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TIER_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>{SERVICE_TIER_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleCard>

            {insurancePolicies.length > 0 && (() => {
              const totalCoverage = insurancePolicies.reduce((s: number, p: any) => s + (Number(p.coverage_amount) || 0), 0);
              const contactById = new Map(contacts.map((c: any) => [c.id, c]));
              const ownerName = (p: any) => {
                const c = contactById.get(p.contact_id);
                return c ? `${c.first_name} ${c.last_name}` : "Family";
              };
              return (
                <CollapsibleCard
                  icon={Shield}
                  iconBgClassName="bg-sanctuary-bronze/10"
                  iconColorClassName="text-sanctuary-bronze"
                  title="Insurance"
                  headerRight={
                    <p className="text-xl font-bold text-sanctuary-bronze">{formatCurrency(totalCoverage)}</p>
                  }
                  contentClassName="space-y-2"
                >
                  {insurancePolicies.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Shield className="h-3.5 w-3.5" /> {policyTypeLabel(p.policy_type)} — {ownerName(p)}
                      </span>
                      <span className="font-semibold text-foreground">{formatCurrency(p.coverage_amount)}</span>
                    </div>
                  ))}
                </CollapsibleCard>
              );
            })()}

            {/* Holding Tank */}
            <Card className="border-amber-500/20">
              <CardHeader
                className="pb-2 cursor-pointer select-none"
                onClick={() => setOpenSidebarHoldingTank((o) => !o)}
              >
                <div className="flex items-center gap-3">
                  <Anchor className="h-5 w-5 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-serif">Holding Tank</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {holdingTank.length} account{holdingTank.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-amber-600">{formatCurrency(totalHolding)}</p>
                  </div>
                  {openSidebarHoldingTank ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              </CardHeader>
              {openSidebarHoldingTank && (
                <CardContent className="space-y-2 pt-0">
                  {holdingTank.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No accounts</p>
                  ) : (
                    holdingTank.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{account.account_name}</p>
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                            {account.account_type}
                          </Badge>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-sm font-semibold">{formatCurrency(account.current_value || 0)}</p>
                          {account.book_value != null && (
                            <p className="text-[10px] text-muted-foreground">
                              BOY: {formatCurrency(account.book_value)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              )}
            </Card>

            {/* Vineyard */}
            <Card>
              <CardHeader
                className="pb-2 cursor-pointer select-none"
                onClick={() => setOpenSidebarVineyard((o) => !o)}
              >
                <div className="flex items-center gap-3">
                  <Grape className="h-5 w-5 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-serif">The Vineyard</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {vineyard.length} account{vineyard.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold">{formatCurrency(totalVineyard)}</p>
                  </div>
                  {openSidebarVineyard ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              </CardHeader>
              {openSidebarVineyard && (
                <CardContent className="space-y-2 pt-0">
                  {vineyard.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No accounts</p>
                  ) : (
                    vineyard.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{account.account_name}</p>
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                            {account.account_type}
                          </Badge>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-sm font-semibold">{formatCurrency(account.current_value || 0)}</p>
                          {account.book_value != null && (
                            <p className="text-[10px] text-muted-foreground">
                              BOY: {formatCurrency(account.book_value)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              )}
            </Card>

            {/* Storehouses */}
            <Card>
              <CardHeader
                className="pb-2 cursor-pointer select-none"
                onClick={() => setOpenSidebarStorehouses((o) => !o)}
              >
                <div className="flex items-center gap-3">
                  <Landmark className="h-5 w-5 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-serif">Storehouses</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {storehousesCount} account{storehousesCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold">{formatCurrency(storehousesDisplayTotal)}</p>
                  </div>
                  {openSidebarStorehouses ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              </CardHeader>
              {openSidebarStorehouses && (
                <CardContent className="space-y-2 pt-0">
                  {storehouseBreakdown.filter((r) => r.count > 0 || r.total > 0).map((r) => (
                    <div key={r.num} className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                      <span className="text-xs font-medium">{storehouseName(r.num)}</span>
                      <span className="text-sm font-semibold text-accent">{formatCurrency(r.total)}</span>
                    </div>
                  ))}
                  {storehouses.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No accounts</p>
                  ) : (
                    storehouses.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{account.label}</p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                              {storehouseName(account.storehouse_number)}
                            </Badge>
                            {account.asset_type && (
                              <span className="text-[10px] text-muted-foreground">{account.asset_type}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-sm font-semibold">{formatCurrency(account.current_value || 0)}</p>
                          {account.book_value != null && (
                            <p className="text-[10px] text-muted-foreground">
                              BOY: {formatCurrency(account.book_value)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          {/* Main column — Households & Members */}
          <div className="flex-1 min-w-0">
            <Card>
              <CardHeader className="pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Home className="h-4 w-4 text-sanctuary-bronze" />
                  Households & Members
                </CardTitle>
                <AddCompanyDialog
                  members={contacts
                    .filter((c) => !c.is_minor)
                    .map((c) => {
                      const hh = households.find((h) => h.id === c.household_id);
                      return {
                        id: c.id,
                        name: `${c.first_name} ${c.last_name || ""}`.trim(),
                        sublabel: hh?.label,
                      };
                    })}
                  onCreated={fetchData}
                />
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {households.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">
                    No households in this family yet.
                  </p>
                ) : (
                  <div className="border-t border-border divide-y divide-border">
                    {households.map((hh) => {
                      const isOpen = openHouseholds.has(hh.id);
                      const members = contactsByHousehold(hh.id);
                      const hhTotal = householdTotal(hh.id);
                      return (
                        <Collapsible
                          key={hh.id}
                          open={isOpen}
                          onOpenChange={() => toggleHousehold(hh.id)}
                        >
                          <div className="flex items-center gap-2 px-6 py-3 hover:bg-muted/30">
                            <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left min-w-0">
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <Home className="h-4 w-4 text-sanctuary-bronze shrink-0" />
                              <span className="font-medium truncate">{hh.label}</span>
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {members.length} {members.length === 1 ? "member" : "members"}
                              </Badge>
                            </CollapsibleTrigger>
                            <span className="text-sm font-semibold text-sanctuary-bronze shrink-0">
                              {formatCurrency(hhTotal)}
                            </span>
                            <Button asChild variant="ghost" size="sm" className="shrink-0">
                              <Link to={`/households/${hh.id}`}>
                                Open <ExternalLink className="ml-1 h-3 w-3" />
                              </Link>
                            </Button>
                          </div>
                          <CollapsibleContent>
                            {members.length === 0 ? (
                              <p className="px-12 pb-4 text-xs text-muted-foreground">
                                No members assigned.
                              </p>
                            ) : (
                              <div className="pb-2">
                                {members.map((m) => {
                                  const Icon = ROLE_ICONS[m.family_role] || User;
                                  const cTotal = contactTotal(m.id);
                                  return (
                                    <div
                                      key={m.id}
                                      className="flex items-center gap-2 pl-14 pr-6 py-2 hover:bg-muted/20"
                                    >
                                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      <Link
                                        to={`/contacts/${m.id}`}
                                        className="text-sm font-medium hover:underline truncate flex-1"
                                      >
                                        {m.first_name} {m.last_name || ""}
                                      </Link>
                                      {m.family_role && (
                                        <Badge variant="outline" className="text-[9px] uppercase">
                                          {ROLE_LABELS[m.family_role] || m.family_role}
                                        </Badge>
                                      )}
                                      <span className="text-xs text-muted-foreground shrink-0 w-32 text-right">
                                        {formatCurrency(cTotal)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="mt-4">
              <FamilyTaskRollup familyId={family.id} members={contacts} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default FamilyDetail;
