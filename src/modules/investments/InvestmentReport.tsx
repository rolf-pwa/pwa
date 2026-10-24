import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { fileInvestmentReport, getInvestmentRecs, getInvestmentReports, previewInvestmentReport, shareInvestmentReport, unshareInvestmentReport, type InvFiledReport, type InvRecPerson } from "@/modules/crm/lib/reviewAgent";

/**
 * The Investment Recommendation Report for the client: pick the people, whether to list the portfolio's funds, add a note, look at the PDF, file it in Advisor Files /
 * Reports, and share it in the client's portal Documents page. It is built from the saved profiles and recommendations.
 */
export function InvestmentReport({ householdId }: { householdId: string }) {
  const [people, setPeople] = useState<InvRecPerson[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [funds, setFunds] = useState(true);
  const [note, setNote] = useState("");
  const [reports, setReports] = useState<InvFiledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"preview" | "file" | string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  const load = useCallback(async () => {
    const [recs, rep] = await Promise.all([getInvestmentRecs(householdId), getInvestmentReports(householdId).catch(() => ({ reports: [] as InvFiledReport[] }))]);
    setPeople(recs.people); setChosen(new Set(recs.people.map((p) => p.id))); setReports(rep.reports); setLoading(false);
  }, [householdId]);
  useEffect(() => { void load().catch((e) => { toast.error(e instanceof Error ? e.message : "Couldn't load"); setLoading(false); }); }, [load]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setChosen(n); setPdfUrl(null); };
  const request = () => ({ householdId, contactIds: [...chosen], includeFunds: funds, coverNote: note });
  const ready = chosen.size > 0;
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(null); } };

  const preview = () => run("preview", async () => {
    const r = await previewInvestmentReport(request());
    setPdfUrl(URL.createObjectURL(new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" })));
  });
  const file = () => run("file", async () => { const r = await fileInvestmentReport(request()); toast.success(`Filed in Advisor Files: ${r.name}`); await load(); });
  const share = (r: InvFiledReport, on: boolean) => run(r.id, async () => {
    if (on && !window.confirm(`Share ${r.pdf_name} with ${r.contact_ids.length === 1 ? "the client" : "the clients it was prepared for"} in their portal Documents page?${notify ? " They will get a notice in the portal and one short email." : " They will not be notified."}`)) return;
    if (on) { const x = await shareInvestmentReport(r.id, notify, householdId); toast.success(x.notified ? "Shared. The client has been notified." : "Shared in the portal."); } else { await unshareInvestmentReport(r.id, householdId); toast.success("Hidden from the portal. The filed PDF is untouched."); }
    await load();
  });

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-5" data-testid="investment-report">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">Investment Recommendation Report</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">The report for the client: where they stand, how the portfolio was chosen, what you recommend (the iA model portfolio, amount, guarantee and fees) and what happens next. It uses the saved profiles and recommendations.</p>
          <div>
            <p className="mb-1.5 text-xs font-medium">Who is in it</p>
            <div className="space-y-1.5">{people.map((p) => (
              <label key={p.id} className="flex flex-wrap items-center gap-2">
                <Checkbox checked={chosen.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Include ${p.name}`} />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">Risk profile: {p.riskProfile ?? "not recorded"}. Recommendation: {p.rec ? "saved" : "none yet"}.</span>
              </label>
            ))}</div>
          </div>
          <label className="flex items-center gap-2"><Checkbox checked={funds} onCheckedChange={(v) => { setFunds(v === true); setPdfUrl(null); }} aria-label="List the portfolio's funds" />List the funds in the recommended portfolio</label>
          <label className="block text-xs">A note from Rolf (optional, at the top of the report)
            <textarea className="mt-1 block min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={note} onChange={(e) => { setNote(e.target.value); setPdfUrl(null); }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!ready || busy !== null} onClick={() => void preview()}>{busy === "preview" ? "Building…" : "Preview the PDF"}</Button>
            <Button size="sm" disabled={!ready || busy !== null} onClick={() => void file()}>{busy === "file" ? "Filing…" : "File in Advisor Files"}</Button>
          </div>
        </CardContent>
      </Card>
      {pdfUrl && <iframe title="Report preview" src={pdfUrl} className="h-[80vh] w-full rounded-md border" data-testid="report-preview" />}
      <Card>
        <CardHeader className="pb-2"><div className="flex flex-wrap items-center gap-4"><CardTitle className="text-base">Filed reports</CardTitle><label className="flex items-center gap-2 text-xs font-normal"><Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} aria-label="Notify the client when sharing" />Notify the client when I share a report</label></div></CardHeader>
        <CardContent className="space-y-1.5 text-sm" data-testid="filed-reports">
          {reports.length === 0 && <p className="text-muted-foreground">Nothing filed yet.</p>}
          {reports.map((r) => (
            <p key={r.id} className="flex flex-wrap items-center gap-2">
              <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{r.pdf_name}</a>
              <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-CA")}</span>
              {r.shared_at ? <><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">Shared in the portal {new Date(r.shared_at).toLocaleDateString("en-CA")}</span><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === r.id} onClick={() => void share(r, false)}>Hide from the portal</Button></>
                : <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === r.id} onClick={() => void share(r, true)}>Share in the portal</Button>}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
