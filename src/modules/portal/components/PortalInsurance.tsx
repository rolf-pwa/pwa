import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { policyTypeLabel, groupPolicies } from "@/shared/lib/insurance";
import { categoryOf, coverageSummary, coverageText } from "@/shared/lib/insuranceSummary";

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

  const summary = coverageSummary(policies);
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
        <div className="space-y-0.5" data-testid="coverage-summary">
          {summary.map((l) => (
            <p key={l.category} className="flex items-baseline justify-between gap-3 text-sm"><span className="text-muted-foreground">{l.label}</span><span className="font-serif text-base font-semibold tabular-nums text-foreground">{l.text}</span></p>
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-accent/10">
          <span>Your protection in force</span>
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
                    {coverageSummary([g.base, ...g.riders]).filter((l) => l.total > 0).map((l) => (
                      <p key={l.category} className="text-sm font-semibold">{coverageSummary([g.base, ...g.riders]).length > 1 ? `${l.label}: ` : ""}{l.text}</p>
                    ))}
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
                          <span className="tabular-nums text-foreground">{coverageText(categoryOf(p.policy_type), p.coverage_amount || 0)}</span>
                        </div>
                        {g.riders.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {policyTypeLabel(r.policy_type)} rider{r.renewal_date ? ` · renews ${r.renewal_date}` : ""}
                            </span>
                            <span className="tabular-nums text-foreground">{coverageText(categoryOf(r.policy_type), r.coverage_amount || 0)}</span>
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

/**
 * A card on the dashboard: the cover this person has in force, by kind (life, critical illness, disability), each in its own terms. It opens the full list.
 * Nothing when they have no policies on file.
 */
export function PortalCoverageCard({ policies, onOpen }: { policies: PortalInsuranceProps["policies"]; onOpen: () => void }) {
  const summary = coverageSummary(policies ?? []);
  if (!summary.length) return null;
  return (
    <Card data-testid="coverage-card"><CardContent className="space-y-2 p-4">
      <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-accent" /><p className="font-serif text-sm font-semibold">Your protection</p></div>
      <div className="space-y-0.5">{summary.map((l) => <p key={l.category} className="flex items-baseline justify-between gap-3 text-sm"><span className="text-muted-foreground">{l.label}</span><span className="font-semibold tabular-nums">{l.text}</span></p>)}</div>
      <button type="button" className="text-xs text-primary hover:underline" onClick={onOpen}>See your policies</button>
    </CardContent></Card>
  );
}
