import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Check, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { finalizeInsuranceDoc, getInsuranceFiles, listInsuranceDocs, previewInsuranceDoc, sendInsuranceDoc, voidInsuranceDoc, type InsDoc, type InsDocPreview, type InsFile } from "@/modules/crm/lib/reviewAgent";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });
const STATUS: Record<InsDoc["status"], string> = { sent: "Waiting on the client", partly_signed: "Partly signed", signed: "Signed", void: "Voided" };

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

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([listInsuranceDocs(householdId), getInsuranceFiles(householdId)]);
      setDocs(d.documents); setFiles(f.files.filter((x) => x.status === "open"));
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
