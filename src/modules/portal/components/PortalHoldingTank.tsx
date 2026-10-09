import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Anchor, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { PortalAccountSnapshot } from "./PortalAccountSnapshot";

interface PortalHoldingTankProps {
  accounts: Array<{
    id: string;
    account_name: string;
    account_number: string | null;
    account_type: string;
    account_owner: string | null;
    custodian: string | null;
    book_value: number | null;
    current_value: number | null;
    notes: string | null;
    visibility_scope?: string;
    expected_deposit_date?: string | null;
    latest_snapshot?: any;
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

export function PortalHoldingTank({ accounts, defaultCollapsed = false }: PortalHoldingTankProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  if (!accounts || accounts.length === 0) return null;

  const totalValue = accounts.reduce((sum, a) => sum + (a.current_value || 0), 0);

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none pb-3" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2">
          <Anchor className="h-4 w-4 text-accent" />
          <div className="min-w-0">
            <CardTitle className="font-serif text-sm font-semibold">The Holding Tank</CardTitle>
            <p className="text-xs text-muted-foreground">
              Accounts awaiting Charter ratification · {accounts.length} account{accounts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <p className="font-serif text-lg font-semibold tabular-nums text-foreground">{formatCurrency(totalValue)}</p>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="p-0 pt-0">
        {accounts.map((account) => (
          <div key={account.id} className="border-t border-border/60 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{account.account_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {account.custodian && (
                    <span className="text-[10px] text-muted-foreground">{account.custodian}</span>
                  )}
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    {account.account_type}
                  </Badge>
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                {account.current_value != null && (
                  <p className="text-sm font-semibold">{formatCurrency(account.current_value)}</p>
                )}
                {account.book_value != null && !account.latest_snapshot && (
                  <p className="text-[10px] text-muted-foreground">Beginning of Year: {formatCurrency(account.book_value)}</p>
                )}
                {account.expected_deposit_date && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                    <CalendarDays className="h-2.5 w-2.5" />
                    Expected: {new Date(account.expected_deposit_date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </p>
                )}
              </div>
            </div>
            <PortalAccountSnapshot snapshot={account.latest_snapshot} />
          </div>
        ))}
      </CardContent>
      )}
    </Card>
  );
}
