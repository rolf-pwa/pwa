import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

interface Row {
  id: string; group: "holding_tank" | "vineyard" | "storehouse"; owner: string; name: string; accountType: string | null; last4: string | null;
  boy: number | null; boySource: "statement" | "prior_year_end" | "imported" | null; current: number | null; withdrawalsYtd: number | null; growth: number | null; change: number | null; changePct: number | null; asOf: string | null;
}
interface Totals { boy: number; current: number; withdrawals: number; growth: number; change: number; changePct: number | null; withBoy: number; withoutBoy: number }
interface Group { rows: Row[]; totals: Totals }
interface Dashboard {
  year: number; asOf: string | null;
  balance: { holdingTank: number; vineyard: number; liquidity: number; strategic: number; philanthropic: number; legacy: number; totalAssets: number; liabilities: number; netWorth: number; harvest: number | null; creditCapacity?: number; notes: string[] };
  groups: Record<"holding_tank" | "vineyard" | "storehouse", Group>;
  all: Totals;
}

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const signed = (n: number | null) => (n === null ? "—" : n === 0 ? "$0" : `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`);
const pct = (n: number | null) => (n === null ? "" : ` (${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%)`);
const tone = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "text-emerald-700" : "text-destructive");

function BsLine({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-0.5 text-sm ${strong ? "font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span><span className={`tabular-nums ${negative ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * The Review's numbers without generating it: the balance sheet (same allocation rules as the Sovereignty Review) and
 * each account's start-of-year and current value, withdrawals so far this year and the growth once withdrawals are added
 * back. BOY comes from the year's saved snapshots; an account with none shows a dash and is left out of the totals.
 */
export function VineyardDashboard({ householdId }: { householdId: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error: err } = await supabase.functions.invoke("household-dashboard", { body: { household_id: householdId } });
    if (err || res?.error) setError(err?.message ?? res?.error ?? "Couldn't load");
    else { setData(res as Dashboard); setError(null); }
    setLoading(false);
  }, [householdId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="py-6 text-sm text-destructive">Couldn't load the dashboard: {error}</p>;
  if (!data) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…</div>;

  const b = data.balance;
  // Holding Tank and the Storehouses have their own panels in the sidebar; the dashboard's account table is the Vineyard.
  const sections: { key: "holding_tank" | "vineyard" | "storehouse"; title: string }[] = [{ key: "vineyard", title: "The Vineyard" }];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Balance sheet · {data.year}{data.asOf ? <span className="ml-2 text-xs font-normal text-muted-foreground">statements as of {data.asOf}</span> : null}</CardTitle>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} title="Refresh">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</Button>
        </CardHeader>
        <CardContent className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Assets</p>
            {b.holdingTank > 0 && <BsLine label="Holding Tank" value={money(b.holdingTank)} />}
            <BsLine label="Vineyard" value={money(b.vineyard)} />
            <BsLine label="Liquidity Reserve" value={money(b.liquidity)} />
            <BsLine label="Strategic Reserve" value={money(b.strategic)} />
            <BsLine label="Philanthropic Trust" value={money(b.philanthropic)} />
            <BsLine label="Legacy Trust" value={money(b.legacy)} />
            <div className="mt-1 border-t pt-1"><BsLine label="Total Assets" value={money(b.totalAssets)} strong /></div>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Liabilities &amp; Net Worth</p>
            <BsLine label="Liabilities" value={money(b.liabilities)} negative />
            {(b.creditCapacity ?? 0) > 0 && <BsLine label="Undrawn credit (offsets the Strategic Reserve)" value={money(b.creditCapacity)} negative />}
            <BsLine label="Net Worth" value={money(b.netWorth)} strong />
            <div className="mt-3 border-t pt-2">
              <BsLine label="Harvest to date (all withdrawals)" value={b.harvest === null ? "—" : money(b.harvest)} strong />
              <BsLine label="Vineyard growth, withdrawals added back" value={data.groups.vineyard.totals.withBoy ? signed(data.groups.vineyard.totals.growth) : "—"} />
            </div>
          </div>
          {b.notes.length > 0 && <p className="text-[11px] text-muted-foreground md:col-span-2">{b.notes.join(" ")}</p>}
        </CardContent>
      </Card>

      {sections.map(({ key, title }) => {
        const g = data.groups[key];
        if (!g.rows.length) return null;
        return (
          <Card key={key}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 text-right font-medium">Start of year</th>
                    <th className="py-2 pr-3 text-right font-medium">Current</th>
                    <th className="py-2 pr-3 text-right font-medium">Change</th>
                    {key !== "storehouse" && <th className="py-2 pr-3 text-right font-medium">Withdrawn YTD</th>}
                    {key !== "storehouse" && <th className="py-2 text-right font-medium" title="Current value plus withdrawals, less start of year">Growth</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        {r.name}{r.last4 ? <span className="text-xs text-muted-foreground"> ···{r.last4}</span> : null}
                        <span className="block text-[11px] text-muted-foreground">{[r.owner, r.accountType].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" title={r.boySource === "statement" ? "Read from the statement's beginning-of-year figure" : r.boySource === "prior_year_end" ? "Closing value of the December 31 statement" : r.boySource === "imported" ? "Imported start-of-year value" : "No start-of-year value on file"}>{money(r.boy)}{r.boySource === "prior_year_end" ? <span className="text-[10px] text-muted-foreground"> Dec 31</span> : null}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.current)}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${tone(r.change)}`}>{signed(r.change)}{pct(r.changePct)}</td>
                      {key !== "storehouse" && <td className="py-1.5 pr-3 text-right tabular-nums">{r.withdrawalsYtd === null ? "—" : money(r.withdrawalsYtd)}</td>}
                      {key !== "storehouse" && <td className={`py-1.5 text-right tabular-nums ${tone(r.growth)}`}>{signed(r.growth)}</td>}
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5 pr-3">Total{g.totals.withoutBoy > 0 ? <span className="block text-[11px] font-normal text-muted-foreground">Start of year, change and growth cover {g.totals.withBoy} of {g.totals.withBoy + g.totals.withoutBoy} accounts (no start-of-year value on file for the rest)</span> : null}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{g.totals.withBoy ? money(g.totals.boy) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(g.totals.current)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${tone(g.totals.withBoy ? g.totals.change : null)}`}>{g.totals.withBoy ? signed(g.totals.change) + pct(g.totals.changePct) : "—"}</td>
                    {key !== "storehouse" && <td className="py-1.5 pr-3 text-right tabular-nums">{money(g.totals.withdrawals)}</td>}
                    {key !== "storehouse" && <td className={`py-1.5 text-right tabular-nums ${tone(g.totals.withBoy ? g.totals.growth : null)}`}>{g.totals.withBoy ? signed(g.totals.growth) : "—"}</td>}
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Balance sheet figures follow the Sovereignty Review (income funds counted in Liquidity when there is no Liquidity Reserve, insurance cash value in Strategic, real estate in Legacy), so the two always agree.
        Account values are the latest statement read; start of year is the saved snapshot for {data.year}. <Link className="underline" to={`/vault/household/${householdId}`}>Open the Vault</Link> to file or scan new statements.
      </p>
    </div>
  );
}
