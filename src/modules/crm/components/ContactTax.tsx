import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { LINE_KEYS, LINE_LABELS, withEdit, type Computed, type LineKey, type TaxColumn, type TaxData, type TaxPerson } from "../lib/householdTax";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);
const signed = (n: number) => (n === 0 ? "—" : `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`);

type Kind = "baseline" | "projection";

/**
 * One person's tax picture: last year's return as the baseline column and this year's projection beside
 * it. Both are editable and saved as you type. Numbers read from the return or the slips show where they came from; a
 * hand-entered figure is kept when the return is read again. The Governance Audit uses the saved projection.
 */
export function ContactTax({ householdId, contactId }: { householdId: string; contactId: string }) {
  const [data, setData] = useState<TaxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [readingSlips, setReadingSlips] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke("household-tax", { body: { household_id: householdId, ...body } });
    if (error) throw error;
    if (res?.error) throw new Error(res.error);
    return res;
  }, [householdId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = (await call({ action: "load" })) as TaxData;
      setData(d);
    } catch (e) { toast.error(`Couldn't load the tax page: ${e instanceof Error ? e.message : String(e)}`); }
    setLoading(false);
  }, [call]);
  useEffect(() => { load(); }, [load]);

  const person = data?.people.find((p) => p.contactId === contactId) ?? null;
  const province = person?.province ?? "BC";

  const patch = (contactId: string, kind: Kind, fn: (c: TaxColumn) => TaxColumn) =>
    setData((d) => d && { ...d, people: d.people.map((p) => (p.contactId === contactId ? { ...p, [kind]: fn(p[kind]) } : p)) });

  const persist = (p: TaxPerson, kind: Kind, col: TaxColumn, prov: string) => {
    const key = `${p.contactId}:${kind}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      try {
        const res = await call({ action: "save", contact_id: p.contactId, kind, province: prov, lines: col.lines, sources: col.sources });
        patch(p.contactId, kind, (c) => ({ ...c, saved: true, computed: res.computed as Computed }));
      } catch (e) { toast.error(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
    }, 700);
  };

  const edit = (p: TaxPerson, kind: Kind, key: LineKey, raw: string) => {
    const col = p[kind];
    const next = withEdit(col.lines, col.sources, key, raw === "" ? 0 : Number(raw));
    const updated = { ...col, ...next };
    patch(p.contactId, kind, () => updated);
    persist(p, kind, updated, province);
  };

  const resetToDetected = (p: TaxPerson) => {
    const sug = p.projection.suggested;
    if (!sug) return;
    const updated: TaxColumn = { ...p.projection, lines: sug, sources: Object.fromEntries(LINE_KEYS.filter((k) => sug[k] > 0).map((k) => [k, "detected"])) };
    patch(p.contactId, "projection", () => updated);
    persist(p, "projection", updated, province);
  };

  const changeProvince = async (prov: string) => {
    if (!person) return;
    try {
      // Saves both columns on the new province and refreshes the computed rows.
      await Promise.all((["baseline", "projection"] as Kind[]).filter((k) => person[k].saved || k === "projection").map((k) => call({ action: "save", contact_id: person.contactId, kind: k, province: prov, lines: person[k].lines, sources: person[k].sources })));
      await load();
    } catch (e) { toast.error(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const readReturn = async () => {
    setReading(true);
    try {
      const r = await call({ action: "readReturn" });
      if (!r.ok || !r.filesRead?.length) toast.message(r.message ?? "No return was found to read.");
      else toast.success(`Read ${r.filesRead.length} file(s) for ${r.savedFor?.join(", ") || "no one"}${r.unmatched?.length ? `; couldn't tell whose: ${r.unmatched.join(", ")}` : ""}.`);
      await load();
    } catch (e) { toast.error(`Couldn't read the return: ${e instanceof Error ? e.message : String(e)}`); }
    setReading(false);
  };

  const readSlips = async () => {
    setReadingSlips(true);
    try {
      const r = await call({ action: "readSlips" });
      if (r.found) toast.success(`Read the ${r.taxYear} tax slips (${r.files.length} file${r.files.length === 1 ? "" : "s"}).`);
      else toast.message(`No ${r.taxYear} T3 or T5 slips were found in the Tax folder.`);
      await load();
    } catch (e) { toast.error(`Couldn't read the slips: ${e instanceof Error ? e.message : String(e)}`); }
    setReadingSlips(false);
  };

  const rows = useMemo(() => LINE_KEYS, []);
  if (loading && !data) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading tax picture…</div>;
  if (!data || !person) return <p className="py-8 text-sm text-muted-foreground">This person is not part of a household yet, so there is no tax picture to build.</p>;

  const b = person.baseline, pr = person.projection;
  const bc = b.computed, pc = pr.computed;
  const srcLabel = (c: TaxColumn, k: LineKey) => ({ return: "from return", detected: "detected", manual: "edited", baseline: "from baseline" }[c.sources[k] ?? "" as never] ?? "");
  const calc: { label: string; get: (c: Computed) => string; bold?: boolean; delta?: (b: Computed, p: Computed) => string }[] = [
    { label: "Total income (as on the return)", get: (c) => money(c.totalIncome), delta: (x, y) => signed(y.totalIncome - x.totalIncome) },
    { label: "Taxable income", get: (c) => money(c.taxableIncome), delta: (x, y) => signed(y.taxableIncome - x.taxableIncome) },
    { label: "Federal tax", get: (c) => money(c.federalTax), delta: (x, y) => signed(y.federalTax - x.federalTax) },
    { label: "Provincial tax", get: (c) => money(c.provincialTax), delta: (x, y) => signed(y.provincialTax - x.provincialTax) },
    { label: "Estimated income tax", get: (c) => money(c.totalTax), bold: true, delta: (x, y) => signed(y.totalTax - x.totalTax) },
    { label: "Effective rate", get: (c) => pct(c.effectiveRate) },
    { label: "Marginal rate", get: (c) => pct(c.marginalRate) },
    { label: "Income after tax (cash)", get: (c) => money(c.afterTax), bold: true, delta: (x, y) => signed(y.afterTax - x.afterTax) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={province} onValueChange={changeProvince}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(data.provinces).map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={readReturn} disabled={reading}>
          {reading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1.5 h-3.5 w-3.5" />}
          Read {data.baselineYear} return from the Vault
        </Button>
        <Button variant="outline" size="sm" onClick={readSlips} disabled={readingSlips}>
          {readingSlips ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1.5 h-3.5 w-3.5" />}
          Read {data.baselineYear} tax slips
        </Button>
        {!pr.saved && pr.suggested && <span className="text-xs text-muted-foreground">The projection is a suggestion until you edit it.</span>}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{person.name} · tax picture</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Income</th>
                <th className="w-44 py-2 pr-4 font-medium">{data.baselineYear} return{b.sourceFile ? <span className="block truncate text-[10px] normal-case tracking-normal" title={b.sourceFile}>{b.sourceFile}</span> : null}</th>
                <th className="w-44 py-2 pr-4 font-medium">{data.year} projection</th>
                <th className="w-28 py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-1.5 pr-4">{LINE_LABELS[k]}</td>
                  {([["baseline", b], ["projection", pr]] as const).map(([kind, col]) => (
                    <td key={kind} className="py-1.5 pr-4">
                      <Input type="number" min={k === "rental_income" ? undefined : 0} step="1" className="h-8" value={col.lines[k] === 0 ? "" : String(col.lines[k])} placeholder="0" onChange={(e) => edit(person, kind, k, e.target.value)} />
                      <span className="text-[10px] text-muted-foreground">{srcLabel(col, k)}</span>
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{signed(pr.lines[k] - b.lines[k])}</td>
                </tr>
              ))}
              {calc.map((r) => (
                <tr key={r.label} className={`border-b last:border-0 ${r.bold ? "font-semibold" : ""}`}>
                  <td className="py-1.5 pr-4">{r.label}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{bc ? r.get(bc) : "—"}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{pc ? r.get(pc) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{bc && pc && r.delta ? r.delta(bc, pc) : ""}</td>
                </tr>
              ))}
              {b.reported && (
                <tr className="text-xs text-muted-foreground">
                  <td className="py-2 pr-4">Printed on the {data.baselineYear} return</td>
                  <td className="py-2 pr-4" colSpan={3}>Total income {money(b.reported.total_income)} · Taxable income {money(b.reported.taxable_income)} · Tax payable {money(b.reported.total_tax_payable)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-3">
            {pr.suggested && <Button variant="ghost" size="sm" onClick={() => resetToDetected(person)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset projection to what the records show</Button>}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Dividends are entered as the actual amount and grossed up here; capital gains as the full gain, taxed at the inclusion rate. Tax comes from the {data.tableYear} federal and provincial tables and the basic personal amount,
            plus any credit amounts you enter. OAS recovery tax and income splitting are not included. An estimate, not tax advice.
            {data.slipMixYear ? ` Suggested withdrawals are split the way the ${data.slipMixYear} tax slips split their income.` : ""}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
