import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { AppLayout } from "@/shared/components/AppLayout";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { SidebarSection } from "@/shared/components/SidebarSection";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import {
  EXPENSE_KEYS, EXPENSE_LABELS, emptyYear, equity, incomeUse, netRentalIncome, ownershipTotal, totalExpenses, type YearLines,
} from "../lib/rentalProperty";
import { annualInterest, TYPE_LABELS, type LiabilityType } from "../lib/liabilities";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const toNum = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

interface Property {
  id: string; household_id: string; name: string; address: string | null; city: string | null; province: string | null;
  purchase_price: number | null; purchase_date: string | null; current_value: number | null; value_as_of: string | null;
  storehouse_id: string | null; mortgage_liability_id: string | null; net_income_use: "household" | "debt_paydown"; paydown_liability_id: string | null; notes: string | null;
}
interface Owner { contact_id: string; ownership_pct: number }
interface Member { id: string; name: string }
interface Liab { id: string; description: string; liability_type: string; current_balance: number; interest_rate_pct: number | null }

/** A rental property's own page: value and equity, owners, the linked mortgage, and annual rent and expenses by category. */
export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [prop, setProp] = useState<Property | null>(null);
  const [householdLabel, setHouseholdLabel] = useState("");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [liabs, setLiabs] = useState<Liab[]>([]);
  const [years, setYears] = useState<Record<number, YearLines>>({});
  const [loading, setLoading] = useState(true);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const thisYear = new Date().getFullYear();
  const shownYears = [thisYear - 2, thisYear - 1, thisYear];

  const load = useCallback(async () => {
    if (!id) return;
    const { data: p } = await supabase.from("rental_properties").select("*").eq("id", id).maybeSingle();
    if (!p) { setLoading(false); return; }
    setProp({ ...p, purchase_price: p.purchase_price === null ? null : Number(p.purchase_price), current_value: p.current_value === null ? null : Number(p.current_value) } as Property);
    const [{ data: hh }, { data: contacts }, { data: ow }, { data: yr }] = await Promise.all([
      supabase.from("households").select("label").eq("id", p.household_id).maybeSingle(),
      supabase.from("contacts").select("id, first_name, last_name").eq("household_id", p.household_id),
      supabase.from("rental_property_owners").select("contact_id, ownership_pct").eq("property_id", id),
      supabase.from("rental_property_years").select("*").eq("property_id", id),
    ]);
    setHouseholdLabel(hh?.label ?? "Household");
    const people = (contacts ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") }));
    setMembers(people);
    setOwners((ow ?? []).map((o) => ({ contact_id: o.contact_id, ownership_pct: Number(o.ownership_pct) })));
    const map: Record<number, YearLines> = {};
    for (const r of (yr ?? []) as any[]) map[r.tax_year] = Object.fromEntries(Object.keys(emptyYear()).map((k) => [k, Number(r[k]) || 0])) as YearLines;
    setYears(map);
    if (people.length) {
      const { data: l } = await supabase.from("liabilities").select("id, description, liability_type, current_balance, interest_rate_pct").eq("holder_type", "contact").in("contact_id", people.map((x) => x.id));
      setLiabs((l ?? []).map((x) => ({ ...x, current_balance: Number(x.current_balance) || 0, interest_rate_pct: x.interest_rate_pct === null ? null : Number(x.interest_rate_pct) })) as Liab[]);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const later = (key: string, fn: () => Promise<void>) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { fn().catch((e) => toast.error(`Not saved: ${e instanceof Error ? e.message : String(e)}`)); }, 700);
  };

  const patchProp = (patch: Partial<Property>, { syncValue = false }: { syncValue?: boolean } = {}) => {
    if (!prop) return;
    const next = { ...prop, ...patch };
    setProp(next);
    later("prop", async () => {
      const { error } = await supabase.from("rental_properties").update({
        name: next.name, address: next.address, city: next.city, province: next.province, purchase_price: next.purchase_price, purchase_date: next.purchase_date,
        current_value: next.current_value, value_as_of: next.value_as_of, mortgage_liability_id: next.mortgage_liability_id,
        net_income_use: next.net_income_use, paydown_liability_id: next.paydown_liability_id, notes: next.notes, updated_at: new Date().toISOString(),
      }).eq("id", next.id);
      if (error) throw error;
      // The value is kept in the property's real-estate entry in the Legacy Trust, so every document counts it once.
      if (syncValue && next.storehouse_id) {
        const { error: sErr } = await supabase.from("storehouses").update({ current_value: next.current_value, label: next.name } as never).eq("id", next.storehouse_id);
        if (sErr) throw sErr;
      }
    });
  };

  const setYearValue = (year: number, key: keyof YearLines, raw: string) => {
    const row = { ...(years[year] ?? emptyYear()), [key]: Math.max(0, toNum(raw) ?? 0) };
    setYears((prev) => ({ ...prev, [year]: row }));
    later(`y${year}`, async () => {
      const { error } = await supabase.from("rental_property_years").upsert({ property_id: id!, tax_year: year, ...row, updated_at: new Date().toISOString() }, { onConflict: "property_id,tax_year" });
      if (error) throw error;
    });
  };

  const saveOwners = async (next: Owner[], removed?: string) => {
    setOwners(next);
    try {
      if (removed) await supabase.from("rental_property_owners").delete().eq("property_id", id!).eq("contact_id", removed);
      if (next.length) {
        const { error } = await supabase.from("rental_property_owners").upsert(next.map((o) => ({ property_id: id!, ...o })), { onConflict: "property_id,contact_id" });
        if (error) throw error;
      }
    } catch (e) { toast.error(`Ownership not saved: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const remove = async () => {
    const { error } = await supabase.from("rental_properties").delete().eq("id", id!);
    if (error) { toast.error("Couldn't remove the property."); return; }
    toast.success("Property removed. Its real-estate entry in the Legacy Trust is kept.");
    navigate(`/households/${prop!.household_id}`);
  };

  const mortgage = liabs.find((l) => l.id === prop?.mortgage_liability_id) ?? null;
  const interestEstimate = mortgage ? annualInterest({ liability_type: mortgage.liability_type, current_balance: mortgage.current_balance, interest_rate_pct: mortgage.interest_rate_pct }) : null;
  const current = years[thisYear] ?? emptyYear();
  const net = netRentalIncome(current);
  const use = useMemo(() => incomeUse(net, prop?.net_income_use ?? "household", !!(prop?.paydown_liability_id)), [net, prop?.net_income_use, prop?.paydown_liability_id]);
  const unowned = members.filter((m) => !owners.some((o) => o.contact_id === m.id));

  if (loading) return <AppLayout><p className="p-8 text-muted-foreground">Loading…</p></AppLayout>;
  if (!prop) return <AppLayout><p className="p-8 text-muted-foreground">Property not found.</p></AppLayout>;

  const cell = (year: number, key: keyof YearLines) => (
    <Input type="number" min={0} className="h-8 text-right" value={(years[year]?.[key] ?? 0) === 0 ? "" : String(years[year]![key])} placeholder="0" onChange={(e) => setYearValue(year, key, e.target.value)} />
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" }, { label: "Households", href: "/households" },
          { label: householdLabel, href: `/households/${prop.household_id}` }, { label: prop.name },
        ]} />
        <div>
          <Input className="h-auto border-0 px-0 font-serif text-2xl shadow-none focus-visible:ring-0" value={prop.name} onChange={(e) => patchProp({ name: e.target.value }, { syncValue: true })} />
          <div className="grid max-w-2xl grid-cols-3 gap-2">
            <Input placeholder="Address" value={prop.address ?? ""} onChange={(e) => patchProp({ address: e.target.value || null })} />
            <Input placeholder="City" value={prop.city ?? ""} onChange={(e) => patchProp({ city: e.target.value || null })} />
            <Input placeholder="Province" value={prop.province ?? ""} onChange={(e) => patchProp({ province: e.target.value || null })} />
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Income and expenses</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 text-left font-medium" />
                      {shownYears.map((y) => <th key={y} className="w-36 py-2 pr-3 text-right font-medium">{y}{y === thisYear ? " (this year)" : ""}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b"><td className="py-1.5 pr-3 font-medium">Rent collected</td>{shownYears.map((y) => <td key={y} className="py-1.5 pr-3">{cell(y, "rent_collected")}</td>)}</tr>
                    {EXPENSE_KEYS.map((k) => (
                      <tr key={k} className="border-b last:border-0"><td className="py-1.5 pr-3 text-muted-foreground">{EXPENSE_LABELS[k]}</td>{shownYears.map((y) => <td key={y} className="py-1.5 pr-3">{cell(y, k)}</td>)}</tr>
                    ))}
                    <tr className="border-t"><td className="py-1.5 pr-3 text-muted-foreground">Total expenses</td>{shownYears.map((y) => <td key={y} className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{money(totalExpenses(years[y] ?? {}))}</td>)}</tr>
                    <tr className="font-semibold"><td className="py-1.5 pr-3">Net rental income</td>{shownYears.map((y) => { const n = netRentalIncome(years[y] ?? {}); return <td key={y} className={`py-1.5 pr-3 text-right tabular-nums ${n < 0 ? "text-destructive" : ""}`}>{money(n)}</td>; })}</tr>
                  </tbody>
                </table>
                {interestEstimate !== null && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    The linked {TYPE_LABELS[mortgage!.liability_type as LiabilityType] ?? "loan"} ({mortgage!.description}) costs about {money(interestEstimate)} a year in interest.{" "}
                    <button className="underline" onClick={() => setYearValue(thisYear, "mortgage_interest", String(interestEstimate))}>Use it for {thisYear}</button>
                  </p>
                )}
                <p className="mt-3 text-sm">
                  Net rental income this year: <span className="font-semibold tabular-nums">{money(net)}</span>
                  {" · "}to the household <span className="tabular-nums">{money(use.toHousehold)}</span>
                  {" · "}to debt paydown <span className="tabular-nums">{money(use.toPaydown)}</span>
                </p>
              </CardContent>
            </Card>
          </div>

          <aside className="min-w-0 space-y-3">
            <SidebarSection title="Value" meta={money(prop.current_value)} defaultOpen>
              <div className="space-y-3 px-2 pb-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Current value ($)</Label><Input type="number" value={prop.current_value ?? ""} onChange={(e) => patchProp({ current_value: toNum(e.target.value), value_as_of: new Date().toISOString().slice(0, 10) }, { syncValue: true })} /></div>
                  <div className="space-y-1"><Label className="text-xs">As of</Label><Input type="date" value={prop.value_as_of ?? ""} onChange={(e) => patchProp({ value_as_of: e.target.value || null })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Purchase price ($)</Label><Input type="number" value={prop.purchase_price ?? ""} onChange={(e) => patchProp({ purchase_price: toNum(e.target.value) })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Purchased</Label><Input type="date" value={prop.purchase_date ?? ""} onChange={(e) => patchProp({ purchase_date: e.target.value || null })} /></div>
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Equity (value less mortgage)</span><span className="font-medium tabular-nums">{money(equity(prop.current_value, mortgage?.current_balance ?? null))}</span></div>
                <p className="text-[11px] text-muted-foreground">{prop.storehouse_id ? "The value is kept in this property's real-estate entry in the Legacy Trust, so it is counted once." : "Not linked to a Legacy Trust entry."}</p>
              </div>
            </SidebarSection>

            <SidebarSection title="Ownership" meta={`${ownershipTotal(owners)}%`} defaultOpen>
              <div className="space-y-2 px-2 pb-2">
                {owners.map((o) => (
                  <div key={o.contact_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{members.find((m) => m.id === o.contact_id)?.name ?? "Member"}</span>
                    <Input type="number" min={1} max={100} className="h-8 w-20 text-right" value={o.ownership_pct}
                      onChange={(e) => saveOwners(owners.map((x) => (x.contact_id === o.contact_id ? { ...x, ownership_pct: Math.min(100, Math.max(1, Number(e.target.value) || 1)) } : x)))} />
                    <span className="text-xs text-muted-foreground">%</span>
                    {owners.length > 1 && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveOwners(owners.filter((x) => x.contact_id !== o.contact_id), o.contact_id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                  </div>
                ))}
                {unowned.length > 0 && (
                  <Select onValueChange={(v) => saveOwners([...owners, { contact_id: v, ownership_pct: Math.max(1, 100 - ownershipTotal(owners)) }])}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Add an owner" /></SelectTrigger>
                    <SelectContent>{unowned.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {ownershipTotal(owners) !== 100 && <p className="text-[11px] text-destructive">Shares add to {ownershipTotal(owners)}%, not 100%.</p>}
                <p className="text-[11px] text-muted-foreground">Net rental income is split between owners by these shares for tax.</p>
              </div>
            </SidebarSection>

            <SidebarSection title="Mortgage and net income" defaultOpen>
              <div className="space-y-3 px-2 pb-2">
                <div className="space-y-1">
                  <Label className="text-xs">Mortgage or loan on this property</Label>
                  <Select value={prop.mortgage_liability_id ?? "none"} onValueChange={(v) => patchProp({ mortgage_liability_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {liabs.map((l) => <SelectItem key={l.id} value={l.id}>{l.description} · {money(l.current_balance)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Managed on the household's <Link className="underline" to={`/households/${prop.household_id}`}>Liabilities</Link> tab.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Net rental income goes</Label>
                  <Select value={prop.net_income_use} onValueChange={(v) => patchProp({ net_income_use: v as Property["net_income_use"], paydown_liability_id: v === "debt_paydown" ? prop.paydown_liability_id ?? prop.mortgage_liability_id : prop.paydown_liability_id })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="household">To the household</SelectItem>
                      <SelectItem value="debt_paydown">To pay down a mortgage or HELOC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {prop.net_income_use === "debt_paydown" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Pays down</Label>
                    <Select value={prop.paydown_liability_id ?? "none"} onValueChange={(v) => patchProp({ paydown_liability_id: v === "none" ? null : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose a loan</SelectItem>
                        {liabs.map((l) => <SelectItem key={l.id} value={l.id}>{l.description} · {money(l.current_balance)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </SidebarSection>

            <SidebarSection title="Notes">
              <div className="px-2 pb-2"><Textarea rows={4} value={prop.notes ?? ""} onChange={(e) => patchProp({ notes: e.target.value || null })} /></div>
            </SidebarSection>

            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove property</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this rental property?</AlertDialogTitle>
                  <AlertDialogDescription>"{prop.name}", its owners and its income and expense history will be removed. Its real-estate entry in the Legacy Trust stays, with the last value.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={remove}>Remove</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
