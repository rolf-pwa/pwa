import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { compileReplacement, getInsuranceFiles, getReplacements, saveReplacement, sendReplacement, type InsFile, type ReplacementRow } from "@/modules/crm/lib/reviewAgent";
import { policyTypeLabel } from "@/shared/lib/insurance";
import { supabase } from "@/shared/integrations/supabase/client";
import type { Quote } from "@/shared/lib/quotes";
import { AGENT_STATEMENT, REPL_SECTIONS } from "@/shared/lib/replacement";

const STATUS: Record<ReplacementRow["status"], string> = { draft: "Draft", sent: "Sent, waiting on the client", confirmed: "Signed by everyone" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });

/**
 * Replacing a life insurance policy (BC). The written explanation is gathered from the file and the meeting notes and calls (each extracted answer quotes its
 * source); Rolf fills in anything missing; then the explanation and the Life Insurance Replacement Declaration go to the client together, with Rolf signing the
 * Declaration as the agent. Both must be given before the application for the new policy is started.
 */
export function ComplianceReplacement({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getReplacements>> | null>(null);
  const [files, setFiles] = useState<InsFile[]>([]);
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [np, setNp] = useState({ product: "", carrier: "", coverage: "", premium: "", frequency: "monthly" });
  const [fileId, setFileId] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const [agree, setAgree] = useState(false);
  const [noApp, setNoApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [quotes, setQuotes] = useState<(Quote & { contact_id: string })[]>([]);

  const load = useCallback(async () => {
    try {
      const [d, f, qs] = await Promise.all([getReplacements(householdId), getInsuranceFiles(householdId), (supabase.from("insurance_quotes" as any) as any).select("*").eq("household_id", householdId).order("created_at")]);
      setQuotes((qs.data ?? []) as any[]);
      setData(d); setFiles(f.files.filter((x) => x.status === "open" && x.kind === "replacement").concat(f.files.filter((x) => x.status === "open" && x.kind !== "replacement")));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load replacements"); setData({ adults: [], policies: [], replacements: [], declaration: "" }); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const draft = useMemo(() => data?.replacements.find((r) => r.id === draftId) ?? null, [data, draftId]);
  useEffect(() => { setValues(Object.fromEntries((draft?.facts ?? []).map((f) => [f.key, f.value]))); }, [draft]);
  useEffect(() => { setFileId((c) => c || files[0]?.id || ""); }, [files]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };
  const edits = () => (draft?.facts ?? []).filter((f) => (values[f.key] ?? "") !== f.value).map((f) => ({ key: f.key, value: values[f.key] ?? "" }));
  const blanks = (draft?.facts ?? []).filter((f) => !(values[f.key] ?? "").trim());

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const pol = data.policies.find((p) => p.id === policyId);
  return (
    <Card data-testid="compliance-replacement">
      <CardHeader className="pb-3"><CardTitle className="text-lg">Replacing a policy (LIRD)</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">When a life insurance policy is being replaced, BC requires the Life Insurance Replacement Declaration (exact wording of the form) and a separate written explanation of the advantages and disadvantages, both given before the application for the new policy is started. The client and the life insured sign in their portal; you sign as the agent when you send.</p>
        {!open && !draft && <Button size="sm" variant="outline" onClick={() => { setOpen(true); setClients(data.adults.slice(0, 1).map((a) => a.id)); }}>Start a replacement</Button>}

        {open && !draft && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid="repl-form">
            <fieldset className="flex flex-wrap items-center gap-3"><legend className="mb-1 text-xs">Who signs (the client, and the life insured if another person)</legend>{data.adults.map((a) => <label key={a.id} className="flex items-center gap-1.5"><input type="checkbox" checked={clients.includes(a.id)} onChange={() => setClients(clients.includes(a.id) ? clients.filter((x) => x !== a.id) : [...clients, a.id])} />{a.name}</label>)}</fieldset>
            <label className="block text-xs">Policy being replaced<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={policyId} onChange={(e) => setPolicyId(e.target.value)}><option value="">Choose a policy on file</option>{data.policies.map((p) => <option key={p.id} value={p.id}>{p.carrier}, {policyTypeLabel(p.policy_type)}{p.policy_number ? `, ${p.policy_number}` : ""}{p.insured_name ? `, ${p.insured_name}` : ""}</option>)}</select></label>
            {data.policies.length === 0 && <p className="text-xs text-amber-700">No policies are on file for this household yet. Add the policy being replaced under Policies first.</p>}
            {quotes.some((q) => q.status !== "rejected") && <label className="block text-xs">Prefill the new policy from a quote<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" defaultValue="" onChange={(e) => { const q = quotes.find((x) => x.id === e.target.value); if (q) setNp({ product: q.product, carrier: q.carrier, coverage: q.coverage_amount ? String(q.coverage_amount) : "", premium: q.premium_amount ? String(q.premium_amount) : "", frequency: q.premium_frequency && q.premium_frequency !== "single" ? q.premium_frequency : "monthly" }); }}><option value="">None</option>{quotes.filter((q) => q.status !== "rejected").sort((a, b) => (a.status === "recommended" ? -1 : 0) - (b.status === "recommended" ? -1 : 0)).map((q) => <option key={q.id} value={q.id}>{q.status === "recommended" ? "Recommended: " : ""}{q.carrier}, {q.product} ({data.adults.find((p) => p.id === q.contact_id)?.name ?? ""})</option>)}</select></label>}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">New policy<Input className="mt-1" placeholder="for example: 20-year term" value={np.product} onChange={(e) => setNp({ ...np, product: e.target.value })} /></label>
              <label className="text-xs">New carrier<Input className="mt-1" value={np.carrier} onChange={(e) => setNp({ ...np, carrier: e.target.value })} /></label>
              <label className="text-xs">Coverage amount<Input className="mt-1" inputMode="numeric" value={np.coverage} onChange={(e) => setNp({ ...np, coverage: e.target.value })} /></label>
              <div className="flex gap-2"><label className="flex-1 text-xs">Premium<Input className="mt-1" inputMode="decimal" value={np.premium} onChange={(e) => setNp({ ...np, premium: e.target.value })} /></label><label className="text-xs">Per<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={np.frequency} onChange={(e) => setNp({ ...np, frequency: e.target.value })}><option value="monthly">month</option><option value="quarterly">quarter</option><option value="semi_annual">6 months</option><option value="annual">year</option></select></label></div>
            </div>
            {files.length > 0 && <label className="flex items-center gap-1.5 text-xs">Tick it off in<select className="h-8 rounded-md border bg-background px-2" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !clients.length || !policyId || !np.product || !np.carrier} onClick={() => void run(async () => { const r = await compileReplacement(householdId, clients, policyId, { product: np.product, carrier: np.carrier, coverage: Number(np.coverage) || null, premium: Number(np.premium) || null, frequency: np.frequency }, fileId || undefined); setDraftId(r.id); setNote([r.note, r.fromNotes ? `${r.fromNotes} answer${r.fromNotes === 1 ? "" : "s"} found in meetings and calls.` : "", r.dropped ? `${r.dropped} suggestion${r.dropped === 1 ? " was" : "s were"} left out because the quote could not be found in the source.` : ""].filter(Boolean).join(" ")); })}>Gather what we have</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            {pol && <p className="text-xs text-muted-foreground">Replacing {pol.carrier} {policyTypeLabel(pol.policy_type)}. The answers are gathered from the policy on file and your meeting notes and calls.</p>}
          </div>
        )}

        {draft && draft.status === "draft" && (
          <div className="space-y-4 rounded-md border bg-muted/30 p-4" data-testid="repl-draft">
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
            <p className="text-xs text-muted-foreground">One answer for each question on the Declaration. Anything we could not find is blank: add it from the carrier's illustration or the contract, or write "Not applicable". This is exactly what the client will read.</p>
            {REPL_SECTIONS.map((s) => {
              const rows = draft.facts.filter((f) => f.section === s.key);
              return (
                <section key={s.key}><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</h3>
                  <ul className="space-y-2">{rows.map((f) => { const v = values[f.key] ?? ""; return (
                    <li key={f.key} className={`rounded-md border p-2.5 ${!v.trim() ? "border-amber-300 bg-amber-50/50" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{f.label}</span><Badge variant="outline" className="text-[10px]">{!v.trim() ? "To add" : v !== f.value ? "Edited" : f.source.type === "meeting" || f.source.type === "call" ? `${f.source.type === "meeting" ? "Meeting" : "Call"}: ${f.source.label}${f.source.date ? `, ${f.source.date}` : ""}` : f.source.label}</Badge></div>
                      <textarea className="mt-1.5 block min-h-[56px] w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={v} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder="Add this before sending" />
                      {f.source.quote && v === f.value && <p className="mt-1 text-xs italic text-muted-foreground">“{f.source.quote}”</p>}
                    </li>); })}</ul></section>
              );
            })}
            {blanks.length > 0 && <p className="text-xs text-amber-700">{blanks.length} still to add before this can be sent.</p>}
            <details className="text-xs"><summary className="cursor-pointer font-medium">The Declaration the client will also sign (exact wording of the form)</summary><div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded border bg-background p-3 leading-relaxed"><ReactMarkdown components={{ h2: ({ children }) => <h4 className="mt-3 font-semibold">{children}</h4>, ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol> }}>{data.declaration}</ReactMarkdown></div></details>
            <div className="space-y-2 rounded-md border bg-background p-3" data-testid="agent-sign">
              <p className="text-xs font-medium">Your signature as the agent</p>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={noApp} onChange={(e) => setNoApp(e.target.checked)} />The application for the new policy has not been started.</label>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />{AGENT_STATEMENT}</label>
              <label className="block text-xs">Type your full name to sign<Input className="mt-1 max-w-xs" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy || edits().length === 0} onClick={() => void run(() => saveReplacement(draft.id, edits()), "Saved")}>Save edits</Button>
                <Button size="sm" disabled={busy || blanks.length > 0 || !agree || !noApp || typed.trim().length < 3} onClick={() => void run(async () => { if (edits().length) await saveReplacement(draft.id, edits()); await sendReplacement(draft.id, typed, agree, noApp, fileId || undefined); setDraftId(null); setOpen(false); setAgree(false); setNoApp(false); setTyped(""); }, "Sent to the client portal")}>Sign and send both to the client</Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraftId(null); setOpen(false); }}>Close</Button>
              </div>
            </div>
          </div>
        )}

        {data.replacements.filter((r) => r.status !== "draft").length > 0 && (
          <ul className="space-y-1.5" data-testid="repl-list">
            {data.replacements.filter((r) => r.status !== "draft").map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2"><span className="font-medium">{r.new_policy.product ?? "Replacement"}{r.new_policy.carrier ? `, ${r.new_policy.carrier}` : ""}</span><Badge variant={r.status === "confirmed" ? "default" : "secondary"} className="text-[10px]">{STATUS[r.status]}</Badge><span className="text-xs text-muted-foreground">sent {r.sent_at ? day(r.sent_at) : ""}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
