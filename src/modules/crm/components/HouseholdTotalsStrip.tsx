import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/** One line of headline totals (Total Assets, Liabilities, Net Worth), the same figures as the Review's balance sheet. */
export function HouseholdTotalsStrip({ householdId }: { householdId: string }) {
  const [b, setB] = useState<{ totalAssets: number; liabilities: number; netWorth: number } | null>(null);
  useEffect(() => {
    let live = true;
    supabase.functions.invoke("household-dashboard", { body: { household_id: householdId } }).then(({ data }) => {
      if (live && data?.balance) setB(data.balance);
    });
    return () => { live = false; };
  }, [householdId]);
  const items: [string, number | null][] = [["Total Assets", b?.totalAssets ?? null], ["Liabilities", b?.liabilities ?? null], ["Net Worth", b?.netWorth ?? null]];
  return (
    <div className="grid grid-cols-3 gap-4 rounded-lg border bg-card px-5 py-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-semibold tabular-nums ${label === "Liabilities" ? "text-destructive" : ""}`}>{value === null ? "—" : money(value)}</p>
        </div>
      ))}
    </div>
  );
}
