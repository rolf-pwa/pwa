import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { supabase } from "@/shared/integrations/supabase/client";
import { fileNeedsAnalysisPdf, getInsuranceFiles, type InsFile } from "@/modules/crm/lib/reviewAgent";
import { DIME_DEFAULTS, dime, splitLiabilities, type DimeInputs } from "@/shared/lib/needsAnalysis";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

const FIELDS: { key: keyof DimeInputs; label: string; hint?: string; group: string }[] = [
  { key: "debt", label: "Debts (not the mortgage)", hint: "Filled from the liabilities on file", group: "D" },
  { key: "annualIncome", label: "Gross annual income", group: "I" },
  { key: "incomeYears", label: "Years of income to replace", group: "I" },
  { key: "survivorIncome", label: "Survivor's income that carries on", hint: "Taken off the income to replace", group: "I" },
  { key: "mortgage", label: "Mortgage", hint: "Filled from the liabilities on file", group: "M" },
  { key: "finalExpenses", label: "Final expenses", group: "E" },
  { key: "taxesAndLegal", label: "Taxes at death, legal and probate", hint: "Deferred tax on RRSP/RRIF and gains", group: "E" },
  { key: "education", label: "Education still to fund", group: "E" },
  { key: "liquidAssets", label: "Liquid assets the family would use", group: "Available" },
  { key: "cppDeathBenefit", label: "CPP/QPP death benefit", group: "Available" },
];

interface Saved { id: string; created_at: string; inputs: Partial<DimeInputs>; results: ReturnType<typeof dime>; note: string | null; pdf_url: string | null }

/**
 * The life insurance need for one person by DIME (Debt, Income, Mortgage, Estate). Debts and the mortgage come from the liabilities on file and the cover
 * in force from their policies; everything can be changed. Each save is kept with its date, so the file shows what the need was and when.
 */
export function NeedsAnalysis({ person, householdId, lifeInsurance }: { person: { id: string; name: string }; householdId: string | null; lifeInsurance: number }) {
  const [inputs, setInputs] = useState<DimeInputs>({ ...DIME_DEFAULTS, lifeInsurance });
  const [saved, setSaved] = useState<Saved[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<InsFile[]>([]);
  const [fileId, setFileId] = useState("");
  const [filing, setFiling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: liabs }, { data: prior }] = await Promise.all([
      supabase.from("liabilities").select("liability_type, current_balance").eq("contact_id", person.id),
      (supabase.from("insurance_needs_analyses" as any) as any).select("id, created_at, inputs, results, note, pdf_url").eq("contact_id", person.id).eq("method", "dime").order("created_at", { ascending: false }).limit(10),
    ]);
    const { debt, mortgage } = splitLiabilities((liabs ?? []) as any[]);
    const last = (prior ?? [])[0] as Saved | undefined;
    // Start from the last saved analysis when there is one; the debts, mortgage and cover in force always reflect what is on file now.
    setInputs({ ...DIME_DEFAULTS, ...(last?.inputs ?? {}), debt, mortgage, lifeInsurance } as DimeInputs);
    setSaved((prior ?? []) as Saved[]);
    setLoading(false);
  }, [person.id, lifeInsurance]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (householdId) getInsuranceFiles(householdId).then((r) => { const open = r.files.filter((f) => f.status === "open"); setFiles(open); setFileId((c) => c || open[0]?.id || ""); }).catch(() => setFiles([])); }, [householdId]);

  const filePdf = async (analysisId: string) => {
    setFiling(analysisId);
    try { const r = await fileNeedsAnalysisPdf(analysisId, fileId || undefined); toast.success(r.attached ? "Filed as a PDF and added to the insurance file" : "Filed as a PDF in Advisor Files"); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not file the PDF"); } finally { setFiling(null); }
  };

  const r = useMemo(() => dime(inputs), [inputs]);
  const set = (key: keyof DimeInputs, v: string) => setInputs((p) => ({ ...p, [key]: v === "" ? 0 : Number(v) }));

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from("insurance_needs_analyses" as any) as any).insert({ household_id: householdId, contact_id: person.id, method: "dime", inputs, results: r, note: note.trim() || null, created_by: "advisor" });
    setSaving(false);
    if (error) return toast.error("Could not save the analysis. Try again.");
    toast.success("Analysis saved");
    setNote("");
    void load();
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  const bar = r.percentMet >= 100 ? "bg-emerald-600" : r.percentMet >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <Card data-testid={`needs-${person.id}`}>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Life insurance need: {person.name}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-y-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{f.label}{f.hint && <span className="block text-xs text-muted-foreground">{f.hint}</span>}</span>
              <Input type="number" min={0} className="w-36 text-right" value={inputs[f.key] || ""} placeholder="0" onChange={(e) => set(f.key, e.target.value)} />
            </label>
          ))}
          <div className="flex items-center justify-between gap-3 text-sm"><span>Life insurance in force<span className="block text-xs text-muted-foreground">From the policies on file</span></span><span className="font-medium">{money(inputs.lifeInsurance)}</span></div>
        </div>

        <table className="w-full text-sm" data-testid="dime-table">
          <tbody>
            {([["D", "Debt", r.debt], ["I", "Income", r.income], ["M", "Mortgage", r.mortgage], ["E", "Estate", r.estate]] as const).map(([k, n, v]) => <tr key={k} className="border-b"><td className="py-1.5"><span className="mr-2 font-semibold">{k}</span>{n}</td><td className="py-1.5 text-right">{money(v)}</td></tr>)}
            <tr className="border-b font-medium"><td className="py-1.5">Total need</td><td className="py-1.5 text-right">{money(r.need)}</td></tr>
            <tr className="border-b"><td className="py-1.5">Available (insurance, liquid assets, CPP)</td><td className="py-1.5 text-right">{money(r.available)}</td></tr>
            <tr className="font-semibold"><td className="py-1.5">{r.surplus > 0 ? "Surplus" : "Shortfall"}</td><td className={`py-1.5 text-right ${r.shortfall > 0 ? "text-red-600" : "text-emerald-700"}`}>{money(r.shortfall > 0 ? r.shortfall : r.surplus)}</td></tr>
          </tbody>
        </table>
        <div><div className="h-2 w-full rounded bg-muted"><div className={`h-2 rounded ${bar}`} style={{ width: `${r.percentMet}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{r.percentMet}% of the need is met</p></div>

        <div className="flex items-center gap-2">
          <Input placeholder="Note for this version (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save analysis"}</Button>
        </div>
        {saved.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground" data-testid="needs-history">
            <div className="flex flex-wrap items-center gap-3"><p className="font-medium text-foreground">Saved versions</p>{files.length > 0 && <label className="flex items-center gap-1.5">Add the PDF to<select className="h-7 rounded-md border bg-background px-1.5" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}</div>
            {saved.map((s) => (
              <p key={s.id} className="flex flex-wrap items-center gap-2">
                <span>{new Date(s.created_at).toLocaleDateString("en-CA")}: need {money(s.results.need)}, shortfall {money(s.results.shortfall)}{s.note ? `, ${s.note}` : ""}</span>
                {s.pdf_url && <a href={s.pdf_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">PDF</a>}
                <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={filing === s.id || (!!s.pdf_url && !fileId)} onClick={() => void filePdf(s.id)}>{filing === s.id ? "Filing…" : s.pdf_url ? "Add to the file" : "File as PDF"}</button>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
