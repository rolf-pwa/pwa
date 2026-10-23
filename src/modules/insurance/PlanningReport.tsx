import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { supabase } from "@/shared/integrations/supabase/client";
import { filePlanningReport, getPlanningReports, previewPlanningReport, type FiledReport } from "@/modules/crm/lib/reviewAgent";

const KINDS = [{ key: "life", label: "Life insurance" }, { key: "critical_illness", label: "Critical illness" }, { key: "disability", label: "Disability (with BOE)" }] as const;
const METHOD_KIND: Record<string, string> = { dime: "life", critical_illness: "critical_illness", disability: "disability" };
const QUOTE_KIND = (t: string) => (["term", "whole_life", "universal_life"].includes(t) ? "life" : t);

interface Person { id: string; name: string; analyses: Set<string>; recommended: Set<string> }

/**
 * The Insurance Planning Report for the client: pick the people, the kinds of cover and whether to show the options compared, add a note, look at the PDF,
 * then file it in Advisor Files / Reports. It is built from the saved needs analyses and the recommended quotes, so each person's readiness is shown first.
 */
export function PlanningReport({ householdId }: { householdId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.map((k) => k.key)));
  const [options, setOptions] = useState(true);
  const [note, setNote] = useState("");
  const [reports, setReports] = useState<FiledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"preview" | "file" | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: cs } = await supabase.from("contacts").select("id, first_name, last_name, full_name, is_minor").eq("household_id", householdId).order("created_at");
    const adults = (cs ?? []).filter((c) => !c.is_minor);
    const ids = adults.map((c) => c.id);
    const [{ data: an }, { data: qs }, rep] = await Promise.all([
      ids.length ? (supabase.from("insurance_needs_analyses" as any) as any).select("contact_id, method").in("contact_id", ids) : { data: [] },
      ids.length ? (supabase.from("insurance_quotes" as any) as any).select("contact_id, policy_type, status").in("contact_id", ids).eq("status", "recommended") : { data: [] },
      getPlanningReports(householdId).catch(() => ({ reports: [] as FiledReport[] })),
    ]);
    const list: Person[] = adults.map((c) => ({
      id: c.id, name: c.full_name || `${c.first_name} ${c.last_name}`.trim(),
      analyses: new Set(((an ?? []) as any[]).filter((a) => a.contact_id === c.id).map((a) => METHOD_KIND[a.method]).filter(Boolean)),
      recommended: new Set(((qs ?? []) as any[]).filter((q) => q.contact_id === c.id).map((q) => QUOTE_KIND(q.policy_type))),
    }));
    setPeople(list); setChosen(new Set(ids)); setReports(rep.reports); setLoading(false);
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const toggle = (set: Set<string>, key: string, put: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); put(n); setPdfUrl(null); };
  const request = () => ({ householdId, contactIds: [...chosen], kinds: [...kinds], includeOptions: options, coverNote: note });
  const ready = chosen.size > 0 && kinds.size > 0;

  const preview = async () => {
    setBusy("preview");
    try {
      const r = await previewPlanningReport(request());
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not build the report"); } finally { setBusy(null); }
  };
  const file = async () => {
    setBusy("file");
    try { const r = await filePlanningReport(request()); toast.success(`Filed in Advisor Files: ${r.name}`); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not file the report"); } finally { setBusy(null); }
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-5" data-testid="planning-report">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">Insurance Planning Report</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">The report for the client: where they stand, how it was worked out, what you recommend and what it costs. It uses the saved needs analyses and the quotes marked recommended.</p>
          <div>
            <p className="mb-1.5 text-xs font-medium">Who is in it</p>
            <div className="space-y-1.5">
              {people.map((p) => (
                <label key={p.id} className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={chosen.has(p.id)} onCheckedChange={() => toggle(chosen, p.id, setChosen)} aria-label={`Include ${p.name}`} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">Needs saved: {KINDS.filter((k) => p.analyses.has(k.key)).map((k) => k.label).join(", ") || "none yet"}. Recommended: {KINDS.filter((k) => p.recommended.has(k.key)).map((k) => k.label).join(", ") || "none yet"}.</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">What is covered</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {KINDS.map((k) => <label key={k.key} className="flex items-center gap-2"><Checkbox checked={kinds.has(k.key)} onCheckedChange={() => toggle(kinds, k.key, setKinds)} aria-label={k.label} />{k.label}</label>)}
              <label className="flex items-center gap-2"><Checkbox checked={options} onCheckedChange={(v) => { setOptions(v === true); setPdfUrl(null); }} aria-label="Show the options compared" />Show the options we compared</label>
            </div>
          </div>
          <label className="block text-xs">A note from Rolf (optional, at the top of the report)
            <textarea className="mt-1 block min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={note} onChange={(e) => { setNote(e.target.value); setPdfUrl(null); }} placeholder="For example: thank you for the time on Tuesday. Here is where we landed." />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!ready || busy !== null} onClick={() => void preview()}>{busy === "preview" ? "Building…" : "Preview the PDF"}</Button>
            <Button size="sm" disabled={!ready || busy !== null} onClick={() => void file()}>{busy === "file" ? "Filing…" : "File in Advisor Files"}</Button>
          </div>
        </CardContent>
      </Card>

      {pdfUrl && <iframe title="Report preview" src={pdfUrl} className="h-[80vh] w-full rounded-md border" data-testid="report-preview" />}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Filed reports</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm" data-testid="filed-reports">
          {reports.length === 0 && <p className="text-muted-foreground">Nothing filed yet.</p>}
          {reports.map((r) => (
            <p key={r.id} className="flex flex-wrap items-center gap-2">
              <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{r.pdf_name}</a>
              <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-CA")}</span>
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
