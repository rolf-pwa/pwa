import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { supabase } from "@/shared/integrations/supabase/client";
import { fileQuoteComparison, getInsuranceFiles, type InsFile } from "@/modules/crm/lib/reviewAgent";
import { POLICY_TYPES, policyTypeLabel } from "@/shared/lib/insurance";
import { FREQ_LABEL, compare, money, money2, type Quote } from "@/shared/lib/quotes";

const db = () => supabase.from("insurance_quotes" as any) as any;
interface Draft { policy_type: string; carrier: string; product: string; coverage_amount: string; term_years: string; premium_amount: string; premium_frequency: string; underwriting: string; riders: string; guarantees: string; quote_date: string; valid_until: string; illustration_url: string; notes: string }
const emptyDraft = (type = "term"): Draft => ({ policy_type: type, carrier: "", product: "", coverage_amount: "", term_years: "", premium_amount: "", premium_frequency: "monthly", underwriting: "", riders: "", guarantees: "", quote_date: new Date().toISOString().slice(0, 10), valid_until: "", illustration_url: "", notes: "" });
const fromQuote = (q: Quote): Draft => ({ policy_type: q.policy_type, carrier: q.carrier, product: q.product, coverage_amount: q.coverage_amount ? String(q.coverage_amount) : "", term_years: q.term_years ? String(q.term_years) : "", premium_amount: q.premium_amount ? String(q.premium_amount) : "", premium_frequency: q.premium_frequency ?? "monthly", underwriting: q.underwriting ?? "", riders: q.riders ?? "", guarantees: q.guarantees ?? "", quote_date: q.quote_date ?? "", valid_until: q.valid_until ?? "", illustration_url: q.illustration_url ?? "", notes: q.notes ?? "" });
const orNull = (s: string) => (s.trim() ? s.trim() : null);
const numOrNull = (s: string) => (Number(s) > 0 ? Number(s) : null);

/**
 * Carrier quotes compared for one person: enter each quote, see them side by side with the yearly cost and the cost per $1,000 of coverage, recommend one
 * (with the reason) and file the comparison as the "alternatives considered" evidence. The recommended quote then prefills the reason-why letter.
 */
export function QuotingWorkspace({ householdId }: { householdId: string }) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [personId, setPersonId] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [files, setFiles] = useState<InsFile[]>([]);
  const [fileId, setFileId] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: cs }, f] = await Promise.all([supabase.from("contacts").select("id, first_name, last_name, full_name, is_minor").eq("household_id", householdId).order("created_at"), getInsuranceFiles(householdId).catch(() => null)]);
    const adults = (cs ?? []).filter((c) => !c.is_minor).map((c) => ({ id: c.id, name: c.full_name || `${c.first_name} ${c.last_name}`.trim() }));
    setPeople(adults); setPersonId((cur) => cur || adults[0]?.id || "");
    if (f) { const open = f.files.filter((x) => x.status === "open"); setFiles(open); setFileId((cur) => cur || open[0]?.id || ""); }
    setLoading(false);
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  const loadQuotes = useCallback(async () => { if (!personId) return; const { data } = await db().select("*").eq("household_id", householdId).eq("contact_id", personId).order("created_at"); setQuotes((data ?? []) as Quote[]); }, [householdId, personId]);
  useEffect(() => { void loadQuotes(); }, [loadQuotes]);

  const types = useMemo(() => [...new Set(quotes.map((q) => q.policy_type))], [quotes]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await loadQuotes(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const row = { household_id: householdId, contact_id: personId, policy_type: draft.policy_type, carrier: draft.carrier.trim(), product: draft.product.trim(), coverage_amount: numOrNull(draft.coverage_amount), term_years: draft.term_years ? Math.round(Number(draft.term_years)) || null : null, premium_amount: numOrNull(draft.premium_amount), premium_frequency: draft.premium_amount ? draft.premium_frequency : null, underwriting: orNull(draft.underwriting), riders: orNull(draft.riders), guarantees: orNull(draft.guarantees), quote_date: orNull(draft.quote_date), valid_until: orNull(draft.valid_until), illustration_url: orNull(draft.illustration_url), notes: orNull(draft.notes), updated_at: new Date().toISOString() };
    const r = editing === "new" ? await db().insert({ ...row, created_by: "advisor" }) : await db().update(row).eq("id", editing);
    if (r.error) throw new Error("Could not save the quote.");
    setEditing(null);
  }, "Saved");
  const recommend = (q: Quote) => {
    const reason = window.prompt(`Why is the ${q.carrier} ${q.product} the best fit for this client? This goes in the file.`, q.reason ?? "") ?? "";
    if (!reason.trim()) return;
    void run(async () => {
      const a = await db().update({ status: "considered" }).eq("contact_id", personId).eq("policy_type", q.policy_type).eq("status", "recommended");
      if (a.error) throw new Error("Could not change the earlier recommendation.");
      const b = await db().update({ status: "recommended", reason: reason.trim(), updated_at: new Date().toISOString() }).eq("id", q.id);
      if (b.error) throw new Error("Could not recommend it.");
    }, "Recommended");
  };
  const reject = (q: Quote) => { const reason = window.prompt("Why not this one? (optional, kept in the file)", q.reason ?? "") ?? null; if (reason === null) return; void run(async () => { await db().update({ status: "rejected", reason: reason.trim() || null, updated_at: new Date().toISOString() }).eq("id", q.id); }); };
  const restore = (q: Quote) => void run(async () => { await db().update({ status: "considered", updated_at: new Date().toISOString() }).eq("id", q.id); });
  const remove = (q: Quote) => { if (window.confirm(`Delete the ${q.carrier} ${q.product} quote?`)) void run(async () => { await db().delete().eq("id", q.id); }); };
  const file = (type: string) => void run(async () => { const r = await fileQuoteComparison(householdId, personId, type, fileId || undefined); toast.success(`${r.attached ? "Filed and added to the insurance file" : "Filed in Advisor Files"}${r.illustration === "attached" ? "; illustration attached" : r.illustration.startsWith("not") ? `; illustration ${r.illustration}` : ""}`); });

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  const field = (label: string, key: keyof Draft, props: Record<string, unknown> = {}) => <label className="text-xs">{label}<Input className="mt-1" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props} /></label>;
  return (
    <div className="space-y-5" data-testid="quoting">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">Insured<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={personId} onChange={(e) => { setPersonId(e.target.value); setEditing(null); }}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <Button size="sm" onClick={() => { setDraft(emptyDraft()); setEditing("new"); }} disabled={!personId}>Add a quote</Button>
        {files.length > 0 && <label className="text-xs">Filing into<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">no insurance file</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
      </div>

      {editing && (
        <Card data-testid="quote-form"><CardHeader className="pb-2"><CardTitle className="text-base">{editing === "new" ? "Add a quote" : "Edit the quote"}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs">Kind of cover<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.policy_type} onChange={(e) => setDraft({ ...draft, policy_type: e.target.value })}>{POLICY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
              {field("Carrier", "carrier")}
              {field("Product", "product", { placeholder: "for example: 20-year term" })}
              {field("Coverage amount", "coverage_amount", { inputMode: "numeric" })}
              {field("Term (years)", "term_years", { inputMode: "numeric" })}
              <div className="flex gap-2"><div className="flex-1">{field("Premium", "premium_amount", { inputMode: "decimal" })}</div><label className="text-xs">Per<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={draft.premium_frequency} onChange={(e) => setDraft({ ...draft, premium_frequency: e.target.value })}><option value="monthly">month</option><option value="quarterly">quarter</option><option value="semi_annual">6 months</option><option value="annual">year</option><option value="single">one payment</option></select></label></div>
              {field("Underwriting class", "underwriting", { placeholder: "for example: Preferred non-smoker" })}
              {field("Quote date", "quote_date", { type: "date" })}
              {field("Valid until", "valid_until", { type: "date" })}
              <div className="md:col-span-3">{field("Riders and options", "riders")}</div>
              <div className="md:col-span-3">{field("Guarantees", "guarantees")}</div>
              <div className="md:col-span-3">{field("Illustration or quote (Drive link)", "illustration_url", { placeholder: "paste the Google Drive link to the carrier's illustration" })}</div>
              <div className="md:col-span-3">{field("Notes", "notes")}</div>
            </div>
            <div className="flex gap-2"><Button size="sm" disabled={busy || !draft.carrier.trim() || !draft.product.trim()} onClick={() => void save()}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
          </CardContent></Card>
      )}

      {types.length === 0 && !editing && <Card><CardContent className="p-5 text-sm text-muted-foreground">No quotes for this person yet. Add the quotes you get from the carriers, and they will be compared side by side here.</CardContent></Card>}
      {types.map((type) => {
        const rows = compare(quotes.filter((q) => q.policy_type === type));
        return (
          <Card key={type} data-testid={`quotes-${type}`}>
            <CardHeader className="pb-2"><div className="flex flex-wrap items-center gap-3"><CardTitle className="text-lg">{policyTypeLabel(type)}</CardTitle><Button size="sm" variant="outline" disabled={busy} onClick={() => file(type)}>File the comparison as PDF</Button></div></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2">Option</th><th className="px-2 py-2 text-right">Coverage</th><th className="px-2 py-2 text-right">Premium</th><th className="px-2 py-2 text-right">A year</th><th className="px-2 py-2 text-right">Per $1,000 a year</th><th className="px-2 py-2">Underwriting</th><th className="px-4 py-2" /></tr></thead>
                <tbody>
                  {rows.map(({ quote: q, annual, per1000, cheapest }) => (
                    <tr key={q.id} className={`border-b align-top last:border-0 ${q.status === "rejected" ? "text-muted-foreground" : ""}`}>
                      <td className="px-4 py-2"><p className="font-medium">{q.carrier}, {q.product}{q.term_years ? `, ${q.term_years} yr` : ""}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">{q.status === "recommended" && <Badge className="text-[10px]">Recommended</Badge>}{q.status === "rejected" && <Badge variant="outline" className="text-[10px]">Not chosen</Badge>}{cheapest && <Badge variant="secondary" className="text-[10px]">Lowest per $1,000</Badge>}{q.illustration_url && <a href={q.illustration_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline">Illustration<ExternalLink className="h-3 w-3" /></a>}</div>
                        {q.reason && q.status !== "considered" && <p className="mt-1 max-w-md text-xs text-muted-foreground">{q.status === "recommended" ? "Why: " : "Why not: "}{q.reason}</p>}
                        {(q.riders || q.guarantees) && <p className="mt-1 max-w-md text-xs text-muted-foreground">{[q.riders && `Riders: ${q.riders}`, q.guarantees && `Guarantees: ${q.guarantees}`].filter(Boolean).join(" · ")}</p>}
                        {q.valid_until && new Date(q.valid_until) < new Date() && <p className="mt-1 text-xs text-amber-700">This quote has expired ({q.valid_until}).</p>}
                      </td>
                      <td className="px-2 py-2 text-right">{Number(q.coverage_amount) ? money(Number(q.coverage_amount)) : "—"}</td>
                      <td className="px-2 py-2 text-right">{Number(q.premium_amount) ? `${money(Number(q.premium_amount))} ${FREQ_LABEL[q.premium_frequency ?? ""] ?? ""}` : "—"}</td>
                      <td className="px-2 py-2 text-right">{annual ? money(annual) : "—"}</td>
                      <td className={`px-2 py-2 text-right ${cheapest ? "font-semibold" : ""}`}>{per1000 !== null ? money2(per1000) : "—"}</td>
                      <td className="px-2 py-2 text-xs">{q.underwriting ?? "—"}</td>
                      <td className="px-4 py-2"><div className="flex flex-wrap justify-end gap-1">
                        {q.status !== "recommended" && q.status !== "rejected" && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => recommend(q)}>Recommend</Button>}
                        {q.status === "considered" && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => reject(q)}>Not this one</Button>}
                        {q.status !== "considered" && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => restore(q)}>Undo</Button>}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDraft(fromQuote(q)); setEditing(q.id); }}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => remove(q)}>Delete</Button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">Cost per $1,000 of coverage compares quotes of different sizes, but it is not the only thing that matters: guarantees, riders, underwriting and the carrier all count. The recommended quote prefills the reason-why letter and the replacement explanation.</p>
    </div>
  );
}
