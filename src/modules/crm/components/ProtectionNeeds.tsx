import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { supabase } from "@/shared/integrations/supabase/client";
import { fileNeedsAnalysisPdf, getInsuranceFiles, type InsFile } from "@/modules/crm/lib/reviewAgent";
import { CI_DEFAULTS, DISABILITY_DEFAULTS, criticalIllness, disability, type CriticalIllnessInputs, type DisabilityInputs } from "@/shared/lib/protectionNeeds";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

type Method = "disability" | "critical_illness";
interface Saved { id: string; created_at: string; inputs: Record<string, unknown>; results: Record<string, any>; note: string | null; pdf_url: string | null }
type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
interface Field<T> { key: NumKey<T>; label: string; hint?: string; suffix?: string }

/** The saved versions of one person's analysis of one kind, the note and the save, and filing a version as a PDF. */
function useAnalysis(method: Method, person: { id: string }, householdId: string | null) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<InsFile[]>([]);
  const [fileId, setFileId] = useState("");
  const [filing, setFiling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await (supabase.from("insurance_needs_analyses" as any) as any).select("id, created_at, inputs, results, note, pdf_url").eq("contact_id", person.id).eq("method", method).order("created_at", { ascending: false }).limit(10);
    setSaved((data ?? []) as Saved[]);
    setLoading(false);
  }, [person.id, method]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (householdId) getInsuranceFiles(householdId).then((r) => { const open = r.files.filter((f) => f.status === "open"); setFiles(open); setFileId((c) => c || open[0]?.id || ""); }).catch(() => setFiles([])); }, [householdId]);

  const save = async (inputs: object, results: object) => {
    setSaving(true);
    const { error } = await (supabase.from("insurance_needs_analyses" as any) as any).insert({ household_id: householdId, contact_id: person.id, method, inputs, results, note: note.trim() || null, created_by: "advisor" });
    setSaving(false);
    if (error) return toast.error("Could not save the analysis. Try again.");
    toast.success("Analysis saved");
    setNote("");
    void load();
  };
  const filePdf = async (analysisId: string) => {
    setFiling(analysisId);
    try { const r = await fileNeedsAnalysisPdf(analysisId, fileId || undefined); toast.success(r.attached ? "Filed as a PDF and added to the insurance file" : "Filed as a PDF in Advisor Files"); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not file the PDF"); } finally { setFiling(null); }
  };
  return { saved, loading, saving, note, setNote, files, fileId, setFileId, filing, save, filePdf, last: saved[0] };
}

function Versions({ a, summary }: { a: ReturnType<typeof useAnalysis>; summary: (s: Saved) => string }) {
  if (!a.saved.length) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="needs-history">
      <div className="flex flex-wrap items-center gap-3"><p className="font-medium text-foreground">Saved versions</p>{a.files.length > 0 && <label className="flex items-center gap-1.5">Add the PDF to<select className="h-7 rounded-md border bg-background px-1.5" value={a.fileId} onChange={(e) => a.setFileId(e.target.value)}><option value="">no file</option>{a.files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}</div>
      {a.saved.map((s) => (
        <p key={s.id} className="flex flex-wrap items-center gap-2">
          <span>{new Date(s.created_at).toLocaleDateString("en-CA")}: {summary(s)}{s.note ? `, ${s.note}` : ""}</span>
          {s.pdf_url && <a href={s.pdf_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">PDF</a>}
          <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={a.filing === s.id || (!!s.pdf_url && !a.fileId)} onClick={() => void a.filePdf(s.id)}>{a.filing === s.id ? "Filing…" : s.pdf_url ? "Add to the file" : "File as PDF"}</button>
        </p>
      ))}
    </div>
  );
}

function Inputs<T extends object>({ fields, values, set }: { fields: Field<T>[]; values: T; set: (k: NumKey<T>, v: string) => void }) {
  return (
    <div className="grid gap-y-2">
      {fields.map((f) => (
        <label key={String(f.key)} className="flex items-center justify-between gap-3 text-sm">
          <span>{f.label}{f.hint && <span className="block text-xs text-muted-foreground">{f.hint}</span>}</span>
          <span className="flex items-center gap-1.5"><Input type="number" min={0} className="w-32 text-right" value={(values[f.key] as number) || ""} placeholder="0" onChange={(e) => set(f.key, e.target.value)} />{f.suffix && <span className="w-12 text-xs text-muted-foreground">{f.suffix}</span>}</span>
        </label>
      ))}
    </div>
  );
}

const Row = ({ label, value, strong, bad }: { label: string; value: string; strong?: boolean; bad?: boolean }) => <tr className={`border-b ${strong ? "font-semibold" : ""}`}><td className="py-1.5">{label}</td><td className={`py-1.5 text-right ${bad ? "text-red-600" : ""}`}>{value}</td></tr>;
const Bar = ({ pct }: { pct: number }) => <div><div className="h-2 w-full rounded bg-muted"><div className={`h-2 rounded ${pct >= 100 ? "bg-emerald-600" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{pct}% of the need is met</p></div>;

const DI_FIELDS: Field<DisabilityInputs>[] = [
  { key: "annualIncome", label: "Gross annual income", hint: "Salary and dividends for an owner" },
  { key: "replacePercent", label: "Share of income to replace", suffix: "%" },
  { key: "waitingDays", label: "Waiting period", suffix: "days" },
  { key: "benefitMonths", label: "Benefit period", suffix: "months" },
  { key: "groupBenefit", label: "Group disability benefit", hint: "A month, from the client's plan at work", suffix: "/ month" },
  { key: "cppBenefit", label: "CPP/QPP disability benefit", hint: "A month, the amount expected", suffix: "/ month" },
];
const BOE_FIELDS: Field<DisabilityInputs>[] = [
  { key: "boeMonthlyExpenses", label: "Fixed business expenses to keep paying", hint: "Rent, salaries, utilities, insurance", suffix: "/ month" },
  { key: "boeMonths", label: "BOE benefit period", suffix: "months" },
  { key: "boeInForce", label: "BOE benefit in force", suffix: "/ month" },
];

/** The disability need for one person: 70% of gross income by default after a 30-day wait for 2 years, all changeable. A person with a corporation also gets the business overhead expense (BOE) part. */
export function DisabilityNeeds({ person, householdId, inForce }: { person: { id: string; name: string }; householdId: string | null; inForce: number }) {
  const a = useAnalysis("disability", person, householdId);
  const [inputs, setInputs] = useState<DisabilityInputs>({ ...DISABILITY_DEFAULTS, inForce });
  const [owns, setOwns] = useState(false);
  useEffect(() => { (supabase.from("shareholders" as any) as any).select("corporation_id").eq("contact_id", person.id).eq("is_active", true).then(({ data }: any) => { const has = (data ?? []).length > 0; setOwns(has); }); }, [person.id]);
  // Start from the last saved analysis; the cover in force always reflects the policies on file now, and a corporation switches the BOE part on.
  useEffect(() => { if (!a.loading) setInputs({ ...DISABILITY_DEFAULTS, ...(a.last?.inputs ?? {}), inForce, hasCorporation: (a.last?.inputs as any)?.hasCorporation ?? owns } as DisabilityInputs); }, [a.loading, a.last?.id, inForce, owns]);
  const r = useMemo(() => disability(inputs), [inputs]);
  const set = (key: NumKey<DisabilityInputs>, v: string) => setInputs((p) => ({ ...p, [key]: v === "" ? 0 : Number(v) }));
  if (a.loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  const gap = r.gap > 0;
  return (
    <Card data-testid={`disability-${person.id}`}>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Disability need: {person.name}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Inputs fields={DI_FIELDS} values={inputs} set={set} />
        <div className="flex items-center justify-between gap-3 text-sm"><span>Disability cover in force<span className="block text-xs text-muted-foreground">Monthly benefit of the policies on file</span></span><span className="font-medium">{money(inputs.inForce)} / month</span></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={inputs.hasCorporation} onCheckedChange={(v) => setInputs((p) => ({ ...p, hasCorporation: v === true }))} aria-label="Has a corporation" />Owns a corporation: include business overhead expense (BOE) cover</label>
        {inputs.hasCorporation && <Inputs fields={BOE_FIELDS} values={inputs} set={set} />}

        <table className="w-full text-sm" data-testid="disability-table"><tbody>
          <Row label="Monthly income to replace" value={money(r.target)} />
          <Row label="Available (group, CPP/QPP, policies in force)" value={money(r.available)} />
          <Row label={gap ? "Monthly benefit still needed" : "Surplus"} value={money(gap ? r.gap : r.surplus)} strong bad={gap} />
          <Row label={`Income to carry through the ${inputs.waitingDays}-day wait`} value={money(r.waitingBridge)} />
          <Row label={`The gap over ${inputs.benefitMonths} months`} value={money(r.exposure)} />
          {r.boe && <><Row label="BOE: fixed expenses a month" value={money(r.boe.need)} /><Row label={r.boe.gap > 0 ? "BOE benefit still needed" : "BOE covered"} value={money(r.boe.gap)} strong bad={r.boe.gap > 0} /></>}
        </tbody></table>
        <Bar pct={r.percentMet} />

        <div className="flex items-center gap-2">
          <Input placeholder="Note for this version (optional)" value={a.note} onChange={(e) => a.setNote(e.target.value)} />
          <Button onClick={() => void a.save(inputs, r)} disabled={a.saving}>{a.saving ? "Saving…" : "Save analysis"}</Button>
        </div>
        <Versions a={a} summary={(s) => `needs ${money(s.results.gap ?? 0)} a month more${s.results.boe ? `, BOE ${money(s.results.boe.gap ?? 0)}` : ""}`} />
      </CardContent>
    </Card>
  );
}

const CI_FIELDS: Field<CriticalIllnessInputs>[] = [
  { key: "annualIncome", label: "Gross annual income" },
  { key: "incomeYears", label: "Years of income to cover while recovering", suffix: "years" },
  { key: "treatmentCosts", label: "Treatment and recovery costs", hint: "Travel, home help, care and other costs" },
  { key: "debts", label: "Debts to clear", hint: "Optional" },
];

/** The critical illness need for one person: a year of gross income plus recovery costs, all changeable. */
export function CriticalIllnessNeeds({ person, householdId, inForce }: { person: { id: string; name: string }; householdId: string | null; inForce: number }) {
  const a = useAnalysis("critical_illness", person, householdId);
  const [inputs, setInputs] = useState<CriticalIllnessInputs>({ ...CI_DEFAULTS, inForce });
  useEffect(() => { if (!a.loading) setInputs({ ...CI_DEFAULTS, ...(a.last?.inputs ?? {}), inForce } as CriticalIllnessInputs); }, [a.loading, a.last?.id, inForce]);
  const r = useMemo(() => criticalIllness(inputs), [inputs]);
  const set = (key: NumKey<CriticalIllnessInputs>, v: string) => setInputs((p) => ({ ...p, [key]: v === "" ? 0 : Number(v) }));
  if (a.loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  const gap = r.shortfall > 0;
  return (
    <Card data-testid={`ci-${person.id}`}>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Critical illness need: {person.name}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Inputs fields={CI_FIELDS} values={inputs} set={set} />
        <div className="flex items-center justify-between gap-3 text-sm"><span>Critical illness cover in force<span className="block text-xs text-muted-foreground">From the policies on file</span></span><span className="font-medium">{money(inputs.inForce)}</span></div>
        <table className="w-full text-sm" data-testid="ci-table"><tbody>
          <Row label="Income while recovering" value={money(r.income)} />
          <Row label="Treatment and recovery costs" value={money(r.treatment)} />
          <Row label="Debts to clear" value={money(r.debts)} />
          <Row label="Lump sum needed" value={money(r.need)} strong />
          <Row label={gap ? "Shortfall" : "Surplus"} value={money(gap ? r.shortfall : r.surplus)} strong bad={gap} />
        </tbody></table>
        <Bar pct={r.percentMet} />
        <div className="flex items-center gap-2">
          <Input placeholder="Note for this version (optional)" value={a.note} onChange={(e) => a.setNote(e.target.value)} />
          <Button onClick={() => void a.save(inputs, r)} disabled={a.saving}>{a.saving ? "Saving…" : "Save analysis"}</Button>
        </div>
        <Versions a={a} summary={(s) => `need ${money(s.results.need ?? 0)}, shortfall ${money(s.results.shortfall ?? 0)}`} />
      </CardContent>
    </Card>
  );
}
