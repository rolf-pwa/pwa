import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/** One slim line for a person: what they hold, what they owe, and the difference. Assets come from the page's own records. */
export function ContactTotalsStrip({ contactId, assets }: { contactId: string; assets: number }) {
  const [liabilities, setLiabilities] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    supabase.from("liabilities").select("current_balance").eq("holder_type", "contact").eq("contact_id", contactId).then(({ data }) => {
      if (live) setLiabilities((data ?? []).reduce((a, r) => a + (Number(r.current_balance) || 0), 0));
    });
    return () => { live = false; };
  }, [contactId]);
  const items: [string, number | null, string][] = [
    ["Total Assets", assets, ""], ["Liabilities", liabilities, "text-destructive"], ["Net Worth", liabilities === null ? null : assets - liabilities, ""],
  ];
  return (
    <div className="grid grid-cols-3 gap-4 rounded-lg border bg-card px-5 py-3">
      {items.map(([label, value, tone]) => (
        <div key={label}>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value === null ? "—" : money(value)}</p>
        </div>
      ))}
    </div>
  );
}
