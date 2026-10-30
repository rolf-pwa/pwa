import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { ListRowStatic } from "@/shared/components/ListRow";
import { supabase } from "@/shared/integrations/supabase/client";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

type Confidence = "high" | "medium" | "low";
interface Finding { type: string; key: string; title: string; evidence: { label: string; value: string }[]; confidence: Confidence; nextStep: string }
interface Gap { field: string; why: string; blocks: string[] }
interface HouseholdResult {
  householdId: string; label: string; tier: string | null; groupedAum: number; error?: string;
  evaluation: { findings: Finding[]; gaps: Gap[]; completeness: number };
}
interface Report {
  generatedAt: string;
  summary: { households: number; findingsByType: Record<string, number>; findingsByConfidence: Record<Confidence, number>; topGaps: { field: string; households: number }[]; averageCompleteness: number };
  households: HouseholdResult[];
}

const TYPE_LABELS: Record<string, string> = {
  insurance_coverage_gap: "Insurance cover gap", debt_protection: "Debt protection", charter_candidate: "Sovereignty Charter",
  tier_upgrade: "Near a tier line", consolidation: "Outside assets", corporate_structuring: "Corporate structuring",
  estate_gap: "Estate gaps", idle_cash: "Idle cash", policy_event: "Policy renewal",
};
const TIER_LABELS: Record<string, string> = { tier_0: "Tier 0", tier_1: "Tier 1", tier_2a: "Tier 2A", tier_2b: "Tier 2B", tier_3: "Tier 3", tier_4: "Tier 4" };
const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const confidenceClass: Record<Confidence, string> = { high: "bg-primary/10 text-primary", medium: "bg-muted text-foreground", low: "bg-muted text-muted-foreground" };

export default function BookOfBusiness() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("book-of-business-report", { body: {} });
    if (err || data?.error) setError(err?.message || data?.error || "The report could not be run.");
    else setReport(data as Report);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const rows = report ? [...report.households].sort((a, b) => b.evaluation.findings.length - a.evaluation.findings.length || a.label.localeCompare(b.label)) : [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">Book of Business</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Where the book could use more products or services, found by fixed rules over the data in the CRM. These are prompts for a conversation, never recommendations to a client. Missing data is listed separately, so a quiet household may just be an empty one.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Run again
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && !report && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading every household. This takes a minute.</div>}

        {report && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader><CardTitle>Households</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{report.summary.households}</div>
                  <p className="text-sm text-muted-foreground">Data on file: {pct(report.summary.averageCompleteness)} on average</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Opportunities</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{report.summary.findingsByConfidence.high + report.summary.findingsByConfidence.medium + report.summary.findingsByConfidence.low}</div>
                  <p className="text-sm text-muted-foreground">
                    {report.summary.findingsByConfidence.high} sure · {report.summary.findingsByConfidence.medium} likely · {report.summary.findingsByConfidence.low} to confirm
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>By type</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {Object.entries(report.summary.findingsByType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                    <div key={t} className="flex justify-between"><span>{TYPE_LABELS[t] ?? t}</span><span className="tabular-nums">{n}</span></div>
                  ))}
                  {Object.keys(report.summary.findingsByType).length === 0 && <span className="text-muted-foreground">None found</span>}
                </CardContent>
              </Card>
            </div>

            {report.summary.topGaps.length > 0 && (
              <Card>
                <CardHeader><CardTitle>What is missing most</CardTitle></CardHeader>
                <CardContent>
                  <p className="mb-2 text-sm text-muted-foreground">Fixing these unlocks the most rules. Each count is households.</p>
                  <div className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2">
                    {report.summary.topGaps.map((g) => (
                      <div key={g.field} className="flex justify-between"><span>{g.field}</span><span className="tabular-nums">{g.households}</span></div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div>
              {rows.map((h) => {
                const isOpen = open === h.householdId;
                const { findings, gaps, completeness } = h.evaluation;
                return (
                  <div key={h.householdId} className="border-b border-border last:border-0">
                    <ListRowStatic className="cursor-pointer border-0" onClick={() => setOpen(isOpen ? null : h.householdId)}>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                      <span className="w-16 text-muted-foreground">{h.tier ? TIER_LABELS[h.tier] ?? h.tier : "No tier"}</span>
                      <span className="w-24 text-right tabular-nums text-muted-foreground">{money(h.groupedAum)}</span>
                      <span className="w-28 text-right tabular-nums">{findings.length} found</span>
                      <span className={cn("w-28 text-right tabular-nums", completeness < 0.6 && "text-destructive")}>{pct(completeness)} on file</span>
                    </ListRowStatic>
                    {isOpen && (
                      <div className="space-y-4 bg-muted/30 px-10 py-4 text-sm">
                        {h.error && <p className="text-destructive">This household could not be read: {h.error}</p>}
                        <Link to={`/households/${h.householdId}`} className="text-primary hover:underline">Open household</Link>
                        {findings.length > 0 && (
                          <div className="space-y-3">
                            {findings.map((f) => (
                              <div key={`${f.type}:${f.key}`}>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className={confidenceClass[f.confidence]}>{f.confidence === "high" ? "Sure" : f.confidence === "medium" ? "Likely" : "To confirm"}</Badge>
                                  <span className="text-muted-foreground">{TYPE_LABELS[f.type] ?? f.type}</span>
                                </div>
                                <p className="mt-1 font-medium">{f.title}</p>
                                <ul className="mt-1 text-muted-foreground">
                                  {f.evidence.map((e, i) => <li key={i}>{e.label}: {e.value}</li>)}
                                </ul>
                                <p className="mt-1">Next: {f.nextStep}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {gaps.length > 0 && (
                          <div>
                            <p className="font-medium">Missing data</p>
                            <ul className="mt-1 text-muted-foreground">
                              {gaps.map((g, i) => <li key={i}>{g.field}: {g.why}</li>)}
                            </ul>
                          </div>
                        )}
                        {findings.length === 0 && gaps.length === 0 && <p className="text-muted-foreground">Nothing found and nothing missing.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Run {new Date(report.generatedAt).toLocaleString("en-CA")}. Reads only; nothing is saved.</p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
