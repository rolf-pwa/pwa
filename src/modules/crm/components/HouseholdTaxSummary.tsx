import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { householdTotals, type Computed, type TaxData } from "../lib/householdTax";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);

/**
 * The family's tax picture: one row per person and the household total, for last year's return and this year's
 * projection. Read only; each person's figures are edited on their own contact record (Tax tab).
 */
export function HouseholdTaxSummary({ householdId }: { householdId: string }) {
  const [data, setData] = useState<TaxData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.functions.invoke("household-tax", { body: { household_id: householdId, action: "load" } });
    if (err || res?.error) setError(err?.message ?? res?.error ?? "Couldn't load");
    else setData(res as TaxData);
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="py-8 text-sm text-destructive">Couldn't load the tax picture: {error}</p>;
  if (!data) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading tax picture…</div>;
  if (!data.people.length) return <p className="py-8 text-sm text-muted-foreground">No household members yet.</p>;

  const base = householdTotals(data.people, "baseline");
  const proj = householdTotals(data.people, "projection");
  const cols: { label: string; get: (c: Computed) => string }[] = [
    { label: "Total income", get: (c) => money(c.totalIncome) },
    { label: "Taxable income", get: (c) => money(c.taxableIncome) },
    { label: "Income tax", get: (c) => money(c.totalTax) },
    { label: "Effective rate", get: (c) => pct(c.effectiveRate) },
    { label: "After tax", get: (c) => money(c.afterTax) },
  ];
  const Block = ({ title, kind, totals }: { title: string; kind: "baseline" | "projection"; totals: ReturnType<typeof householdTotals> }) => (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Person</th>
              {cols.map((c) => <th key={c.label} className="py-2 pr-4 text-right font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => {
              const c = p[kind].computed;
              const has = !!c && c.totalIncome > 0;
              return (
                <tr key={p.contactId} className="border-b last:border-0">
                  <td className="py-1.5 pr-4"><Link className="underline-offset-2 hover:underline" to={`/contacts/${p.contactId}`}>{p.name}</Link></td>
                  {has ? cols.map((col) => <td key={col.label} className="py-1.5 pr-4 text-right tabular-nums">{col.get(c!)}</td>)
                    : <td className="py-1.5 pr-4 text-right text-xs text-muted-foreground" colSpan={cols.length}>No figures yet. Open their record to add them.</td>}
                </tr>
              );
            })}
            {totals.totals && (
              <tr className="font-semibold">
                <td className="py-1.5 pr-4">Household</td>
                {cols.map((col) => <td key={col.label} className="py-1.5 pr-4 text-right tabular-nums">{col.get(totals.totals!)}</td>)}
              </tr>
            )}
          </tbody>
        </table>
        {totals.missing.length > 0 && totals.counted > 0 && <p className="mt-2 text-xs text-muted-foreground">Not included: {totals.missing.join(", ")} (no figures).</p>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Block title={`${data.baselineYear} return`} kind="baseline" totals={base} />
      <Block title={`${data.year} projection`} kind="projection" totals={proj} />
      <p className="text-xs text-muted-foreground">
        Each person is taxed on their own figures in their own province and the household is the total of those returns. Income splitting, shared-asset allocation and spousal credits are not modelled.
        Edit each person's figures on their contact record. An estimate, not tax advice.
      </p>
    </div>
  );
}
