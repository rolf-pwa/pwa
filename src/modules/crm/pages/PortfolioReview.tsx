import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { deleteInvestorProfile, getPortfolioPack, saveInvestorProfile, type PortfolioPackResponse } from "@/modules/crm/lib/reviewAgent";
import { CLASS_LABEL, type AssetClass, type DriftStatus } from "../../../../supabase/functions/_shared/portfolio-review";
import { SERVICE_TIER_LABEL, type ServiceTier } from "@/shared/lib/serviceTier";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");
const DRIFT_TEXT: Record<DriftStatus, string> = { within: "Within target", too_much_income: "Too much income", too_little_income: "Too little income", no_target: "No target", no_data: "No fund detail" };
const COLOR: Record<AssetClass, string> = { income: "bg-sky-500", canadian_equity: "bg-emerald-600", us_intl_equity: "bg-emerald-400", equity_other: "bg-emerald-300", other: "bg-muted-foreground/40" };

/** Staff-only prep pack for a household's Portfolio Review: returns from the monthly import, allocation from the statements, drift from the Investor Profile. */
export default function PortfolioReview() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PortfolioPackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [income, setIncome] = useState("");
  const [label, setLabel] = useState("");
  const [band, setBand] = useState("5");
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try { setError(null); setData(await getPortfolioPack(id)); } catch (e: any) { setError(e?.message ?? "Couldn't load the pack"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const v = Number(income);
    if (!id || income === "" || !Number.isFinite(v) || v < 0 || v > 100) { toast.error("Enter the target income share, 0 to 100"); return; }
    setSaving(true);
    try { await saveInvestorProfile({ householdId: id, accountNumber: account || null, label, incomePct: v, bandPct: Number(band) || 5 }); setIncome(""); setLabel(""); await load(); toast.success("Investor Profile saved"); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't save"); }
    finally { setSaving(false); }
  };

  const p = data?.pack;
  const t = p?.household.classTotals;
  const covered = t ? Object.values(t).reduce((s, n) => s + n, 0) : 0;
  const d = p?.household.drift;

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-5 py-6">
        <Link to={data ? `/households/${data.household.id}` : "/households"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to household</Link>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {data && p && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h1 className="font-serif text-2xl font-semibold">Portfolio Review: {data.household.label}</h1>
                <p className="text-sm text-muted-foreground">{data.household.family_name} · values as of {day(p.asOf)}{data.household.service_tier ? ` · ${SERVICE_TIER_LABEL[data.household.service_tier as ServiceTier] ?? data.household.service_tier}` : ""}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">Staff only</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[["Managed value", money(p.totalValue)], ["Year to date (weighted)", pct(p.household.valueWeightedYtd)], ["Since last month", signed(p.household.changeSincePrior)], ["Change this year", signed(p.household.changeYtd)]].map(([k, v]) => (
                <Card key={k}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-serif text-xl font-semibold">{v}</p></CardContent></Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Allocation</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {covered > 0 ? (
                  <>
                    <div className="relative">
                      <div className="flex h-6 overflow-hidden rounded" role="img" aria-label="Allocation by asset class">
                        {(Object.keys(t!) as AssetClass[]).filter((k) => t![k] > 0).map((k) => <div key={k} className={COLOR[k]} style={{ width: `${(t![k] / covered) * 100}%` }} title={`${CLASS_LABEL[k]}: ${money(t![k])}`} />)}
                      </div>
                      {d?.targetIncomePct != null && <div className="absolute -top-1 h-8 w-0.5 bg-foreground" style={{ left: `${d.targetIncomePct}%` }} title={`Target income ${d.targetIncomePct}%`} />}
                    </div>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {(Object.keys(t!) as AssetClass[]).filter((k) => t![k] > 0).map((k) => <li key={k} className="flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOR[k]}`} />{CLASS_LABEL[k]} {pct((t![k] / covered) * 100)} ({money(t![k])})</li>)}
                    </ul>
                    <p>
                      <span className="font-medium">{DRIFT_TEXT[d!.status]}.</span>{" "}
                      {d!.status === "no_target" ? `Income is ${pct(d!.actualIncomePct)}. Add the Investor Profile below to compare.` : d!.status === "within" ? `Income ${pct(d!.actualIncomePct)} against a ${d!.targetIncomePct}% target (±${d!.bandPct}).` : `Income ${pct(d!.actualIncomePct)} against a ${d!.targetIncomePct}% target (±${d!.bandPct}): about ${money(Math.abs(d!.moveToIncome ?? 0))} to move ${d!.status === "too_much_income" ? "into equity" : "into income"}.`}
                    </p>
                    <p className="text-xs text-muted-foreground">Covers {pct(p.household.coveragePct)} of managed value, from the latest statements read in the Vault scan.</p>
                  </>
                ) : <p className="text-muted-foreground">No fund detail yet. Scan the latest statements in the Vault to see the allocation.</p>}
              </CardContent>
            </Card>

            {(p.exceptions.length > 0 || p.gaps.length > 0) && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-lg">To raise and to fix</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {p.exceptions.map((e, i) => <p key={i} className="flex gap-2"><Badge variant={e.severity === "attention" ? "destructive" : "secondary"} className="shrink-0 text-[10px]">{e.severity === "attention" ? "Raise" : "Note"}</Badge>{e.text}</p>)}
                  {p.gaps.map((g, i) => <p key={`g${i}`} className="flex gap-2 text-muted-foreground"><Badge variant="outline" className="shrink-0 text-[10px]">Missing</Badge>{g}</p>)}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Accounts</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2">Account</th><th className="px-2 py-2 text-right">Value</th><th className="px-2 py-2 text-right">Month</th><th className="px-2 py-2 text-right">YTD</th><th className="px-2 py-2 text-right">1Y</th><th className="px-2 py-2 text-right">3Y</th><th className="px-2 py-2 text-right">Income</th><th className="px-4 py-2">Status</th></tr></thead>
                  <tbody>
                    {p.accounts.map((a) => (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="px-4 py-2"><div className="font-medium">{a.name || a.number}</div><div className="text-xs text-muted-foreground">{[a.owner, a.number, a.custodian].filter(Boolean).join(" · ")}</div></td>
                        <td className="px-2 py-2 text-right">{money(a.value)}</td>
                        <td className="px-2 py-2 text-right">{signed(a.changeSincePrior)}</td>
                        <td className="px-2 py-2 text-right">{pct(a.returns.ytd)}</td>
                        <td className="px-2 py-2 text-right">{pct(a.returns.oneYear)}</td>
                        <td className="px-2 py-2 text-right">{pct(a.returns.threeYear)}</td>
                        <td className="px-2 py-2 text-right">{pct(a.incomePct)}</td>
                        <td className="px-4 py-2"><Badge variant={a.drift.status === "too_much_income" || a.drift.status === "too_little_income" ? "destructive" : "secondary"} className="text-[10px]">{DRIFT_TEXT[a.drift.status]}</Badge></td>
                      </tr>
                    ))}
                    {p.accounts.length === 0 && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={8}>No managed accounts found.</td></tr>}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Investor Profile</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">The target mix from the client's Investor Profile (kept in their Investment folder). If it isn't on file, enter it during the review. An account's own profile overrides the household's.</p>
                {data.profiles.map((pr) => (
                  <div key={pr.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span>{pr.account_number ? `Account ${pr.account_number}` : "Whole household"}{pr.label ? ` · ${pr.label}` : ""}: {pr.income_pct}% income / {pr.equity_pct}% equity (±{pr.band_pct}){pr.updated_by ? <span className="text-xs text-muted-foreground"> · set by {pr.updated_by}</span> : null}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove profile" onClick={async () => { try { await deleteInvestorProfile(id!, pr.account_number); await load(); } catch (e: any) { toast.error(e?.message ?? "Couldn't remove"); } }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs">Applies to<select value={account} onChange={(e) => setAccount(e.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"><option value="">Whole household</option>{p.accounts.filter((a) => a.number).map((a) => <option key={a.id} value={a.number!}>{a.name || a.number}</option>)}</select></label>
                  <label className="text-xs">Profile name<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Balanced" className="mt-1 w-36" /></label>
                  <label className="text-xs">Income %<Input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" placeholder="40" className="mt-1 w-20" /></label>
                  <label className="text-xs">Band ±<Input value={band} onChange={(e) => setBand(e.target.value)} inputMode="decimal" className="mt-1 w-16" /></label>
                  <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
