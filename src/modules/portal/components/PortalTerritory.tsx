import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Progress } from "@/shared/components/ui/progress";
import { Grape, Landmark, Castle, Sword, Wheat, Lock, Users, Home, Eye, EyeOff, Globe, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";
import { PortalAccountSnapshot } from "./PortalAccountSnapshot";
import { formatCurrency } from "@/modules/portal/lib/portalAum";

const STOREHOUSE_CONFIG = [
  { num: 1, name: "Liquidity Reserve", icon: Castle },
  { num: 2, name: "Strategic Reserve", icon: Sword },
  { num: 3, name: "Philanthropic Trust", icon: Wheat },
  { num: 4, name: "Legacy Trust", icon: Lock },
];

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of Family",
  spouse: "Spouse",
  beneficiary: "Beneficiary",
  minor: "Minor",
};

const SCOPE_LABELS: Record<string, string> = {
  private: "Private",
  household_shared: "Household",
  family_shared: "Family",
};

const SCOPE_ICONS: Record<string, typeof Lock> = {
  private: EyeOff,
  household_shared: Home,
  family_shared: Globe,
};

const SCOPE_COLORS: Record<string, string> = {
  private: "border-muted-foreground/30 text-muted-foreground bg-muted/50",
  household_shared: "border-accent/30 text-accent bg-accent/5",
  family_shared: "border-primary/30 text-primary bg-primary/5",
};

const SCOPE_OPTIONS = ["private", "household_shared", "family_shared"] as const;

interface Props {
  vineyardAccounts: any[];
  storehouses: any[];
  contact: any;
  family?: any | null;
  household?: any | null;
  householdMembers?: any[];
  scopeLabel?: string;
  portalToken?: string;
  onScopeChange?: () => void;
  corporations?: any[];
  insurancePolicies?: any[];
  section?: "vineyard" | "storehouses" | "all";
  defaultCollapsed?: boolean;
}

function ScopeBadge({
  scope,
  assetId,
  assetTable,
  editable,
  portalToken,
  onScopeChange,
}: {
  scope: string;
  assetId: string;
  assetTable: "vineyard_accounts" | "storehouses";
  editable: boolean;
  portalToken?: string;
  onScopeChange?: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState(false);

  const handleScopeChange = async (newScope: string) => {
    if (newScope === scope || updating) return;
    setUpdating(true);
    try {
      const resp = await supabase.functions.invoke("portal-update-scope", {
        body: { portal_token: portalToken, asset_id: assetId, asset_table: assetTable, new_scope: newScope },
      });
      if (resp.error || resp.data?.error) {
        toast.error(resp.data?.error || "Failed to update visibility.");
      } else {
        toast.success(`Visibility set to ${SCOPE_LABELS[newScope]}.`);
        onScopeChange?.();
      }
    } catch {
      toast.error("Failed to update visibility.");
    } finally {
      setUpdating(false);
      setOpen(false);
    }
  };

  const ScopeIcon = SCOPE_ICONS[scope] || EyeOff;

  if (!editable) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium ${SCOPE_COLORS[scope] || SCOPE_COLORS.private}`}>
        <ScopeIcon className="h-2.5 w-2.5" />
        {SCOPE_LABELS[scope] || scope}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={updating}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors hover:opacity-80 ${SCOPE_COLORS[scope] || SCOPE_COLORS.private} ${updating ? "opacity-50" : "cursor-pointer"}`}
      >
        <ScopeIcon className="h-2.5 w-2.5" />
        {SCOPE_LABELS[scope] || scope}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card p-1 shadow-lg min-w-[130px]">
            <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Visibility
            </p>
            {SCOPE_OPTIONS.map((opt) => {
              const OptIcon = SCOPE_ICONS[opt];
              return (
                <button
                  key={opt}
                  onClick={() => handleScopeChange(opt)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                    scope === opt
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <OptIcon className="h-3 w-3" />
                  {SCOPE_LABELS[opt]}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function PortalTerritory({ vineyardAccounts, storehouses, contact, family, household, householdMembers = [], scopeLabel, portalToken, onScopeChange, corporations = [], insurancePolicies = [], section = "all", defaultCollapsed = false }: Props) {
  const showVineyard = section === "all" || section === "vineyard";
  const showStorehouses = section === "all" || section === "storehouses";
  const [vineyardOpen, setVineyardOpen] = useState(!defaultCollapsed);
  const [storehousesOpen, setStorehousesOpen] = useState(!defaultCollapsed);
  const isIndividualSelf = scopeLabel === "My Territory";
  
  // If scopeLabel is provided, assets are already pre-filtered by the parent; show all
  // Otherwise, filter out private assets (legacy individual behavior)
  const visibleAccounts = scopeLabel
    ? vineyardAccounts
    : vineyardAccounts.filter((a: any) => a.visibility_scope !== "private");
  const privateAccountCount = vineyardAccounts.length - visibleAccounts.length;

  // Corporate vineyard totals
  const corpVineyardTotal = corporations.reduce((sum, corp) =>
    sum + (corp.vineyard_accounts || []).reduce((s: number, a: any) => s + (Number(a.current_value) || 0), 0), 0);

  const totalVineyard = visibleAccounts.reduce(
    (sum: number, a: any) => sum + (Number(a.current_value) || 0),
    0
  ) + corpVineyardTotal;

  const byType: Record<string, { accounts: any[]; total: number }> = {};
  visibleAccounts.forEach((a: any) => {
    const t = a.account_type || "Other";
    if (!byType[t]) byType[t] = { accounts: [], total: 0 };
    byType[t].accounts.push(a);
    byType[t].total += Number(a.current_value) || 0;
  });

  const visibleStorehouses = (scopeLabel
    ? storehouses
    : storehouses.filter((s: any) => s.visibility_scope !== "private")
  ).filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts');

  return (
    <div className="space-y-6">
      {/* Vineyard Overview */}
      {showVineyard && (
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => setVineyardOpen((o) => !o)}>
          <div className="flex items-center gap-2">
              <Grape className="h-4 w-4 text-primary" />
            <div>
              <CardTitle className="font-serif text-sm font-semibold">The Vineyard</CardTitle>
              <p className="text-xs text-muted-foreground">Total Asset Portfolio</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="font-serif text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(totalVineyard)}
                </p>
              </div>
              {vineyardOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
        {vineyardOpen && (
        <CardContent className="space-y-4">
          {Object.entries(byType).length > 0 ? (
            Object.entries(byType).map(([type, { accounts, total }]) => (
              <div key={type} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">{type}</h4>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrency(total)}
                  </span>
                </div>
                {accounts.map((acc: any) => (
                  <div
                    key={acc.id}
                    className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground/80">{acc.account_name}</span>
                      <span className="text-sm font-medium text-foreground">
                        {formatCurrency(Number(acc.current_value) || 0)}
                      </span>
                    </div>
                    <PortalAccountSnapshot snapshot={acc.latest_snapshot} />
                    <div className="flex items-center justify-end mt-1.5">
                      <ScopeBadge
                        scope={acc.visibility_scope}
                        assetId={acc.id}
                        assetTable="vineyard_accounts"
                        editable={isIndividualSelf && !!portalToken}
                        portalToken={portalToken}
                        onScopeChange={onScopeChange}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No accounts have been configured yet.</p>
          )}
          {/* Corporate Vineyard Accounts */}
          {corporations.length > 0 && corporations.some(c => (c.vineyard_accounts || []).length > 0) && (
            <>
              <div className="border-t border-border pt-3 mt-2" />
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Corporate Holdings</h4>
              </div>
              {corporations.filter(c => (c.vineyard_accounts || []).length > 0).map((corp: any) => {
                const corpTotal = (corp.vineyard_accounts || []).reduce((s: number, a: any) => s + (Number(a.current_value) || 0), 0);
                // Find logged-in user's ownership percentage
                const selfShare = (corp.shareholders || []).find((sh: any) => sh.contact_id === contact?.id);
                const ownershipPct = selfShare?.ownership_percentage || 0;
                const TYPE_LABELS: Record<string, string> = { opco: "OpCo", holdco: "HoldCo", trust: "Trust", partnership: "Partnership", other: "Entity" };
                return (
                  <div key={corp.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">{corp.name}</span>
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary border border-primary/20">
                          {TYPE_LABELS[corp.corporation_type] || corp.corporation_type}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-foreground">{formatCurrency(corpTotal)}</span>
                    </div>
                    {ownershipPct > 0 && (
                      <p className="text-[10px] text-muted-foreground">Your stake: {ownershipPct}% · {formatCurrency(Math.round(corpTotal * ownershipPct / 100))}</p>
                    )}
                    {(corp.vineyard_accounts || []).map((acc: any) => (
                      <div key={acc.id} className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-foreground/80">{acc.account_name}</span>
                          <span className="text-sm font-medium text-foreground">{formatCurrency(Number(acc.current_value) || 0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}
          {privateAccountCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-muted px-4 py-3 bg-muted/30">
              <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">
                {privateAccountCount} account{privateAccountCount !== 1 ? "s" : ""} protected by Governance Protocol
              </p>
            </div>
          )}
        </CardContent>
        )}
      </Card>
      )}

      {/* Storehouses */}
      {showStorehouses && (
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => setStorehousesOpen((o) => !o)}>
          <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-accent" />
            <div>
              <CardTitle className="font-serif text-sm font-semibold">The Storehouses</CardTitle>
              <p className="text-xs text-muted-foreground">Strategic Asset Allocation</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="font-serif text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(visibleStorehouses.reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0)
                    + insurancePolicies.reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0)
                  )}
                </p>
              </div>
              {storehousesOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
        {storehousesOpen && (
        <CardContent className="space-y-4">
          {STOREHOUSE_CONFIG.map(({ num, name, icon: Icon }) => {
            const accounts = visibleStorehouses.filter((s: any) => s.storehouse_number === num);
            const privateAccounts = storehouses.filter((s: any) => s.storehouse_number === num && s.visibility_scope === "private");
            // Cash value always belongs to Strategic Reserve, by policy.
            const cashValueForGroup = num === 2
              ? insurancePolicies.reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0)
              : 0;
            const total = accounts.reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0) + cashValueForGroup;
            const targetTotal = accounts.reduce((sum: number, s: any) => sum + (Number(s.target_value) || 0), 0);
            const pct = targetTotal > 0 ? Math.min((total / targetTotal) * 100, 100) : 0;

            return (
              <div key={num} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-accent" />
                    <h4 className="text-sm font-medium text-foreground">{name}</h4>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrency(total)}
                  </span>
                </div>
                {accounts.length > 0 ? (
                  <>
                    {targetTotal > 0 && (
                      <div className="space-y-1">
                        <Progress value={pct} className="h-1.5 bg-muted [&>div]:bg-accent" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{Math.round(pct)}% funded</span>
                          <span>Target: {formatCurrency(targetTotal)}</span>
                        </div>
                      </div>
                    )}
                    {accounts.map((acc: any) => {
                      const accCurrent = Number(acc.current_value) || 0;
                      return (
                        <div
                          key={acc.id}
                          className="rounded-lg bg-muted/50 px-4 py-2.5 border border-border"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-sm text-foreground/80">{acc.label || acc.asset_type || acc.notes || "Account"}</span>
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {formatCurrency(accCurrent)}
                            </span>
                          </div>
                          <PortalAccountSnapshot snapshot={acc.latest_snapshot} />
                          <div className="flex items-center justify-end mt-1.5">
                            <ScopeBadge
                              scope={acc.visibility_scope}
                              assetId={acc.id}
                              assetTable="storehouses"
                              editable={isIndividualSelf && !!portalToken}
                              portalToken={portalToken}
                              onScopeChange={onScopeChange}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : privateAccounts.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-4 py-2.5 border border-border text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    <span>Value Protected by Governance Protocol</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pl-6">No accounts configured</p>
                )}
              </div>
            );
          })}
        </CardContent>
        )}
      </Card>
      )}
    </div>
  );
}
