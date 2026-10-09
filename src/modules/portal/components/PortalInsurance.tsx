import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { policyTypeLabel, groupPolicies } from "@/shared/lib/insurance";

interface PortalInsuranceProps {
  policies: Array<{
    id: string;
    carrier: string;
    policy_number: string | null;
    policy_type: string;
    coverage_amount: number | null;
    cash_value: number | null;
    contact_id?: string | null;
    insured_name?: string | null;
    renewal_date?: string | null;
  }>;
  defaultCollapsed?: boolean;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export function PortalInsurance({ policies, defaultCollapsed = false }: PortalInsuranceProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const [openRiders, setOpenRiders] = useState<Set<string>>(new Set());
  if (!policies || policies.length === 0) return null;

  const totalCoverage = policies.reduce((sum, p) => sum + (p.coverage_amount || 0), 0);
  const groups = groupPolicies(policies);
  const toggleRiders = (key: string) => setOpenRiders((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <Card>
      <CardContent
        className="p-5 space-y-2 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            <h3 className="font-serif text-sm font-semibold text-foreground">The Shield</h3>
          </div>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <p className="font-serif text-lg font-semibold tabular-nums text-foreground">{formatCurrency(totalCoverage)}</p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-accent/10">
          <span>Asset Protection</span>
          <Badge variant="secondary" className="text-[10px]">
            {groups.length} polic{groups.length !== 1 ? "ies" : "y"}
          </Badge>
        </div>
      </CardContent>
      {open && (
        <CardContent className="px-5 pb-5 pt-0 space-y-2">
          {groups.map((g) => {
            const p = g.base;
            const ridersOpen = openRiders.has(g.key);
            return (
              <div key={g.key} className="border-t border-border/60 py-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.carrier}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.policy_number && (
                        <span className="text-[10px] text-muted-foreground">#{p.policy_number}</span>
                      )}
                      <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                        {policyTypeLabel(p.policy_type)}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    {g.totalCoverage > 0 && (
                      <p className="text-sm font-semibold">{formatCurrency(g.totalCoverage)}</p>
                    )}
                    {p.cash_value != null && p.cash_value > 0 && (
                      <p className="text-[10px] text-muted-foreground">Cash Value: {formatCurrency(p.cash_value)}</p>
                    )}
                  </div>
                </div>
                {g.riders.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleRiders(g.key)}
                      className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {ridersOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Base coverage and {g.riders.length} rider{g.riders.length !== 1 ? "s" : ""}
                    </button>
                    {ridersOpen && (
                      <div className="mt-1 ml-1 space-y-1 border-l border-border/60 pl-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{policyTypeLabel(p.policy_type)} (base)</span>
                          <span className="tabular-nums text-foreground">{formatCurrency(p.coverage_amount || 0)}</span>
                        </div>
                        {g.riders.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {policyTypeLabel(r.policy_type)} rider{r.renewal_date ? ` · renews ${r.renewal_date}` : ""}
                            </span>
                            <span className="tabular-nums text-foreground">{formatCurrency(r.coverage_amount || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
