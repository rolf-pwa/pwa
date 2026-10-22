import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Check, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { policyTypeLabel } from "@/shared/lib/insurance";
import { supabase } from "@/shared/integrations/supabase/client";
import { alternativesText, type Quote } from "@/shared/lib/quotes";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { finalizeInsuranceDoc, getInsuranceFiles, listInsuranceDocs, previewInsuranceDoc, sendInsuranceDoc, voidInsuranceDoc, type InsDoc, type InsDocPreview, type InsFile, type InsFiles, type ReasonWhyFields } from "@/modules/crm/lib/reviewAgent";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });
const STATUS: Record<InsDoc["status"], string> = { sent: "Waiting on the client", partly_signed: "Partly signed", signed: "Signed", void: "Voided" };

interface RwForm { insuredId: string; policyId: string; need: string; product: string; carrier: string; benefits: string; coverageAmount: string; premium: string; frequency: string; includeNeeds: boolean; includeCost: boolean; alternatives: string; replacement: string }
const emptyRw = (insuredId: string): RwForm => ({ insuredId, policyId: "", need: "", product: "", carrier: "", benefits: "", coverageAmount: "", premium: "", frequency: "monthly", includeNeeds: true, includeCost: true, alternatives: "", replacement: "" });
const toFields = (f: RwForm): ReasonWhyFields => ({ insuredId: f.insuredId, need: f.need, product: f.product, carrier: f.carrier, benefits: f.benefits.split("\n").map((b) => b.trim()).filter(Boolean), coverageAmount: Number(f.coverageAmount) || null, premium: Number(f.premium) || null, frequency: f.frequency, includeNeeds: f.includeNeeds, includeCost: f.includeCost, alternatives: f.alternatives, replacement: f.replacement });

/**
 * Documents the client signs in the portal. Preparing one reads the current master from Drive and shows exactly what the client will see; sending puts a
 * "Sign your documents" card in their portal. Signed copies are filed as PDFs in the household's Advisor Files and tick the checklist.
 */
export function ComplianceDocuments({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [docs, setDocs] = useState<InsDoc[] | null>(null);
  const [files, setFiles] = useState<InsFile[]>([]);
  const [preview, setPreview] = useState<InsDocPreview | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [fileId, setFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [policies, setPolicies] = useState<InsFiles["policies"]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [rw, setRw] = useState<RwForm | null>(null);
  const [rwPreview, setRwPreview] = useState<InsDocPreview | null>(null);
  const [rwText, setRwText] = useState("");
  const [quotes, setQuotes] = useState<(Quote & { contact_id: string })[]>([]);

  const load = useCallback(async () => {
    try {
      const [d, f, qs] = await Promise.all([listInsuranceDocs(householdId), getInsuranceFiles(householdId), (supabase.from("insurance_quotes" as any) as any).select("*").eq("household_id", householdId).order("created_at")]);
      setQuotes((qs.data ?? []) as any[]);
      setDocs(d.documents); setPeople((d.adults ?? []).map((a) => ({ id: a.id, name: a.name }))); setFiles(f.files.filter((x) => x.status === "open")); setPolicies(f.policies);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the documents"); setDocs([]); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };

  const prepare = (ids?: string[]) => run(async () => {
    const p = await previewInsuranceDoc(householdId, "disclosure_privacy", ids);
    setPreview(p); setPicked(ids ?? p.signers.map((s) => s.id)); setFileId((cur) => cur || files[0]?.id || "");
  });
  const togglePerson = async (id: string) => { const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; if (next.length) { setPicked(next); await prepare(next); } };

  const openRw = () => { setRw(emptyRw(people[0]?.id ?? "")); setRwPreview(null); setFileId((cur) => cur || files[0]?.id || ""); };
  const prefill = (policyId: string) => {
    const pol = policies.find((x) => x.id === policyId);
    setRw((cur) => cur && ({ ...cur, policyId, ...(pol ? { product: policyTypeLabel(pol.policy_type), carrier: pol.carrier, coverageAmount: pol.coverage_amount ? String(pol.coverage_amount) : "", premium: pol.premium_amount ? String(pol.premium_amount) : "", frequency: pol.premium_frequency && pol.premium_frequency !== "single" ? pol.premium_frequency : "monthly", insuredId: pol.contact_id || cur.insuredId } : {}) }));
  };
  const prefillQuote = (quoteId: string) => {
    const q = quotes.find((x) => x.id === quoteId);
    if (!q) return;
    const same = quotes.filter((x) => x.contact_id === q.contact_id && x.policy_type === q.policy_type);
    setRw((cur) => cur && ({ ...cur, insuredId: q.contact_id, product: q.product, carrier: q.carrier, coverageAmount: q.coverage_amount ? String(q.coverage_amount) : "", premium: q.premium_amount ? String(q.premium_amount) : "", frequency: q.premium_frequency && q.premium_frequency !== "single" ? q.premium_frequency : "monthly", alternatives: alternativesText(same) }));
  };
  const draftRw = () => run(async () => { const p = await previewInsuranceDoc(householdId, "reason_why", rw ? [rw.insuredId] : undefined, rw ? toFields(rw) : undefined); setRwPreview(p); setRwText(p.md); });

  if (!docs) return <Loader2 className="h-5 w-5 animate-spin" />;
  const live = docs.find((d) => d.kind === "disclosure_privacy" && (d.status === "sent" || d.status === "partly_signed"));
  return (
    <Card data-testid="compliance-documents">
      <CardHeader className="pb-3"><CardTitle className="text-lg">Documents to sign</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <FileSignature className="h-5 w-5" />
          <div className="min-w-0 flex-1"><p className="font-medium">Advisor Disclosure and Privacy Consent</p><p className="text-xs text-muted-foreground">Read fresh from your Google Doc each time. The client signs in their portal.</p></div>
          <Button size="sm" disabled={busy} onClick={() => void prepare()}>{live ? "Prepare a new copy" : "Prepare"}</Button>
        </div>

        {preview && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid="doc-preview">
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium">Preview: what the client will read</p><Badge variant="outline" className="text-[10px]">Master version {preview.version ?? "not stated"}, edited {day(preview.modified)}</Badge></div>
            {preview.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
            <div className="max-h-96 overflow-y-auto rounded border bg-background p-4 text-sm leading-relaxed">
              <ReactMarkdown components={{ h1: ({ children }) => <h2 className="mt-4 text-lg font-semibold">{children}</h2>, p: ({ children }) => <p className="mt-2">{children}</p>, ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-6">{children}</ol> }}>{preview.md.replace("{{casl_choice}}", "**[The client chooses here whether they agree to receive commercial electronic messages, and adds their initials.]**")}</ReactMarkdown>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <fieldset className="flex flex-wrap items-center gap-3"><legend className="sr-only">Who signs</legend>
                {preview.signers.length > 0 && <span className="text-xs text-muted-foreground">Signers:</span>}
                {preview.signers.map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => void togglePerson(s.id)} disabled={busy} />{s.name}</label>)}
              </fieldset>
              {files.length > 0 && <label className="flex items-center gap-1.5 text-xs">Tick it off in<select className="h-8 rounded-md border bg-background px-2" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
              <Button disabled={busy || picked.length === 0} onClick={() => void run(async () => { await sendInsuranceDoc(householdId, "disclosure_privacy", picked, fileId || undefined); setPreview(null); }, "Sent to the client portal")}>Send to the client portal</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">If the client has a signature pending for an earlier copy, it is voided so they only see this one.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <FileSignature className="h-5 w-5" />
          <div className="min-w-0 flex-1"><p className="font-medium">Reason-why letter</p><p className="text-xs text-muted-foreground">Built from your Drive template, the saved needs analysis and the recommended policy. You edit it before it goes; the client confirms it in their portal.</p></div>
          <Button size="sm" variant="outline" disabled={busy} onClick={openRw}>Draft a letter</Button>
        </div>

        {rw && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid="rw-form">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">Insured<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={rw.insuredId} onChange={(e) => setRw({ ...rw, insuredId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="text-xs">Prefill from a policy on file<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={rw.policyId} onChange={(e) => prefill(e.target.value)}><option value="">None</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.carrier}, {policyTypeLabel(p.policy_type)}{p.insured_name ? `, ${p.insured_name}` : ""}</option>)}</select></label>
              {quotes.some((q) => q.status !== "rejected") && <label className="text-xs md:col-span-2">Prefill from a quote (also fills the alternatives considered)<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" defaultValue="" onChange={(e) => prefillQuote(e.target.value)}><option value="">None</option>{quotes.filter((q) => q.status !== "rejected").sort((a, b) => (a.status === "recommended" ? -1 : 0) - (b.status === "recommended" ? -1 : 0)).map((q) => <option key={q.id} value={q.id}>{q.status === "recommended" ? "Recommended: " : ""}{q.carrier}, {q.product} ({people.find((p) => p.id === q.contact_id)?.name ?? ""})</option>)}</select></label>}
              <label className="text-xs md:col-span-2">What the client wants the coverage to do<Input className="mt-1" placeholder="for example: replace your income, pay off the mortgage and cover final expenses" value={rw.need} onChange={(e) => setRw({ ...rw, need: e.target.value })} /></label>
              <label className="text-xs">Product<Input className="mt-1" placeholder="for example: 20-year term" value={rw.product} onChange={(e) => setRw({ ...rw, product: e.target.value })} /></label>
              <label className="text-xs">Carrier<Input className="mt-1" value={rw.carrier} onChange={(e) => setRw({ ...rw, carrier: e.target.value })} /></label>
              <label className="text-xs md:col-span-2">Benefits (one per line)<textarea className="mt-1 block min-h-[84px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={rw.benefits} onChange={(e) => setRw({ ...rw, benefits: e.target.value })} /></label>
              <label className="text-xs">Coverage amount<Input className="mt-1" inputMode="numeric" value={rw.coverageAmount} onChange={(e) => setRw({ ...rw, coverageAmount: e.target.value })} /></label>
              <div className="flex gap-2"><label className="flex-1 text-xs">Premium<Input className="mt-1" inputMode="decimal" value={rw.premium} onChange={(e) => setRw({ ...rw, premium: e.target.value })} /></label><label className="text-xs">Per<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={rw.frequency} onChange={(e) => setRw({ ...rw, frequency: e.target.value })}><option value="monthly">month</option><option value="quarterly">quarter</option><option value="semi_annual">6 months</option><option value="annual">year</option></select></label></div>
              <label className="text-xs md:col-span-2">Alternatives considered (optional)<textarea className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="the quotes or products compared, and why this one" value={rw.alternatives} onChange={(e) => setRw({ ...rw, alternatives: e.target.value })} /></label>
              <label className="text-xs md:col-span-2">Replacing existing coverage (optional)<textarea className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="only if a policy is being replaced: what the client gives up and gains" value={rw.replacement} onChange={(e) => setRw({ ...rw, replacement: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={rw.includeNeeds} onChange={(e) => setRw({ ...rw, includeNeeds: e.target.checked })} />Include how the amount was worked out (from the saved needs analysis)</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={rw.includeCost} onChange={(e) => setRw({ ...rw, includeCost: e.target.checked })} />Include the cost</label>
              <Button size="sm" disabled={busy || !rw.insuredId} onClick={() => void draftRw()}>Draft the letter</Button>
              <Button size="sm" variant="ghost" onClick={() => { setRw(null); setRwPreview(null); }}>Cancel</Button>
            </div>
            {rwPreview && (
              <div className="space-y-2" data-testid="rw-preview">
                {rwPreview.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
                <label className="text-xs font-medium">The letter (edit anything; this is exactly what the client will read)<textarea className="mt-1 block min-h-[260px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={rwText} onChange={(e) => setRwText(e.target.value)} /></label>
                <div className="flex flex-wrap items-center gap-3">
                  {files.length > 0 && <label className="flex items-center gap-1.5 text-xs">Tick it off in<select className="h-8 rounded-md border bg-background px-2" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
                  <Button disabled={busy || /_{3,}/.test(rwText) || !rwText.trim()} onClick={() => void run(async () => { await sendInsuranceDoc(householdId, "reason_why", [rw.insuredId], fileId || undefined, toFields(rw), rwText); setRw(null); setRwPreview(null); }, "Sent to the client portal")}>Send to the client portal</Button>
                  {/_{3,}/.test(rwText) && <span className="text-xs text-amber-700">There are still blanks (____) to fill in.</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {docs.length > 0 && (
          <ul className="space-y-2" data-testid="doc-list">
            {docs.map((d) => (
              <li key={d.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <Badge variant={d.status === "signed" ? "default" : "secondary"} className="text-[10px]">{STATUS[d.status]}</Badge>
                  <span className="text-xs text-muted-foreground">sent {day(d.sent_at)}{d.template_version ? `, master ${d.template_version}` : ""}</span>
                  {d.pdf_url && <a href={d.pdf_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">Signed copy<ExternalLink className="h-3 w-3" /></a>}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{d.signers.map((s) => <li key={s.contact_id} className="flex items-center gap-1.5">{s.status === "signed" ? <Check className="h-3 w-3 text-green-700" /> : <span className="h-3 w-3 rounded-full border" />}{s.name}: {s.status === "signed" && s.signed_at ? `signed ${day(s.signed_at)}${s.casl_choice ? `, CASL ${s.casl_choice}` : ""}` : "not yet signed"}</li>)}</ul>
                <div className="mt-2 flex gap-2">
                  {(d.status === "sent" || d.status === "partly_signed") && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => { const why = window.prompt("Why are you voiding this? The client will no longer see it.") ?? ""; if (why.trim()) void run(() => voidInsuranceDoc(d.id, why.trim()), "Voided"); }}>Void</Button>}
                  {d.status === "signed" && !d.pdf_url && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void run(async () => { const r = await finalizeInsuranceDoc(d.id); if (!r.ok) throw new Error(r.message); }, "Filed")}>File the signed copy</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
