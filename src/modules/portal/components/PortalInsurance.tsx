import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { policyTypeLabel } from "@/shared/lib/insurance";

interface PortalInsuranceProps {
  policies: Array<{
    id: string;
    carrier: string;
    policy_number: string | null;
    policy_type: string;
    coverage_amount: number | null;
    cash_value: number | null;
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
  if (!policies || policies.length === 0) return null;

  const totalCoverage = policies.reduce((sum, p) => sum + (p.coverage_amount || 0), 0);

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
            {policies.length} polic{policies.length !== 1 ? "ies" : "y"}
          </Badge>
        </div>
      </CardContent>
      {open && (
        <CardContent className="px-5 pb-5 pt-0 space-y-2">
          {policies.map((p) => (
            <div key={p.id} className="border-t border-border/60 py-2">
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
                  {p.coverage_amount != null && p.coverage_amount > 0 && (
                    <p className="text-sm font-semibold">{formatCurrency(p.coverage_amount)}</p>
                  )}
                  {p.cash_value != null && p.cash_value > 0 && (
                    <p className="text-[10px] text-muted-foreground">Cash Value: {formatCurrency(p.cash_value)}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
