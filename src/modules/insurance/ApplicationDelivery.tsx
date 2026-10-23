import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { getDeliveryLetter, getInsuranceFiles, getIssuances, readContract, saveIssuance, sendDeliveryLetter, type InsFile, type IssuanceDraftFields, type IssuanceRow } from "@/modules/crm/lib/reviewAgent";
import { POLICY_TYPES, policyTypeLabel } from "@/shared/lib/insurance";

const STATUS: Record<IssuanceRow["status"], string> = { recorded: "Recorded: closing letter not sent", sent: "Closing letter sent, waiting on the client", confirmed: "Client has confirmed" };
const empty: IssuanceDraftFields = { carrier: "", product: "", policy_type: "term", policy_number: "", coverage_amount: "", premium_amount: "", premium_frequency: "monthly", issued_on: "", delivered_on: "", primary_beneficiary: "" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });

/**
 * Application and delivery. iA's application and the issued policy contract are saved in Drive by Rolf; here the links go to the insurance file (the contract, with
 * iA's electronic delivery, is the proof of delivery), the contract is read into the policy record to check, the policy is recorded as in force, and a closing
 * letter with the 10-day right of rescission goes to the client to confirm.
 */
export function ApplicationDelivery({ householdId, onChanged }: { householdId: string; onChanged?: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getIssuances>> | null>(null);
  const [files, setFiles] = useState<InsFile[]>([]);
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState("");
  const [fileId, setFileId] = useState("");
  const [contract, setContract] = useState("");
  const [apps, setApps] = useState("");
  const [draft, setDraft] = useState<IssuanceDraftFields | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [contingent, setContingent] = useState("");
  const [letterFor, setLetterFor] = useState<string | null>(null);
  const [letter, setLetter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([getIssuances(householdId), getInsuranceFiles(householdId)]);
      setData(d); setFiles(f.files.filter((x) => x.status === "open")); setPersonId((c) => c || d.adults[0]?.id || "");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load policies"); setData({ adults: [], issuances: [] }); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setFileId((c) => c || files[0]?.id || ""); }, [files]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };
  const reset = () => { setOpen(false); setDraft(null); setSources({}); setWarnings([]); setContract(""); setApps(""); setContingent(""); };
  const field = (label: string, key: keyof IssuanceDraftFields, props: Record<string, unknown> = {}) => draft && (
    <label className="text-xs">{label}<Input className="mt-1" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props} />{sources[key] && draft[key] && <span className="mt-0.5 block italic text-muted-foreground">From the contract: “{sources[key]}”</span>}</label>
  );

  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <Card data-testid="application-delivery">
      <CardHeader className="pb-3"><CardTitle className="text-lg">Application and delivery</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">Save iA's application documents and the issued policy contract in Drive, then link them here. The contract, with iA's electronic delivery, is the proof of delivery. The policy is recorded as in force, and the client gets a closing letter with the 10-day right of rescission to confirm.</p>
        {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record an issued policy</Button>}

        {open && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid="issuance-form">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs">Policy owner and insured<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={personId} onChange={(e) => setPersonId(e.target.value)}>{data.adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              {files.length > 0 && <label className="text-xs">Insurance file<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">none</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
            </div>
            <label className="block text-xs">Issued policy contract (Drive link to the PDF)<Input className="mt-1" placeholder="paste the Google Drive link" value={contract} onChange={(e) => setContract(e.target.value)} /></label>
            <label className="block text-xs">Application documents (one Drive link per line)<textarea className="mt-1 block min-h-[64px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={apps} onChange={(e) => setApps(e.target.value)} /></label>
            <div className="flex gap-2"><Button size="sm" disabled={busy || !contract.trim() || !personId} onClick={() => void run(async () => { const r = await readContract(householdId, personId, contract.trim()); setDraft({ ...empty, ...r.draft }); setSources(r.sources); setWarnings([...(r.note ? [r.note] : []), ...r.warnings]); setContingent(r.contingent); })}>{draft ? "Read it again" : "Read the contract"}</Button><Button size="sm" variant="ghost" onClick={reset}>Cancel</Button></div>

            {draft && (
              <div className="space-y-3 border-t pt-3">
                <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-xs" data-testid="issuance-review"><p className="font-medium">Read from the contract. Please check every field against it before recording.</p>{warnings.map((w) => <p key={w} className="mt-1 text-amber-800">{w}</p>)}</div>
                <div className="grid gap-3 md:grid-cols-3">
                  {field("Carrier", "carrier")}{field("Product", "product")}
                  <label className="text-xs">Kind of cover<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.policy_type} onChange={(e) => setDraft({ ...draft, policy_type: e.target.value })}>{POLICY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                  {field("Policy number", "policy_number")}{field("Coverage amount", "coverage_amount", { inputMode: "numeric" })}
                  <div className="flex gap-2"><div className="flex-1">{field("Premium", "premium_amount", { inputMode: "decimal" })}</div><label className="text-xs">Per<select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={draft.premium_frequency} onChange={(e) => setDraft({ ...draft, premium_frequency: e.target.value })}><option value="monthly">month</option><option value="quarterly">quarter</option><option value="semi_annual">6 months</option><option value="annual">year</option></select></label></div>
                  {field("Issued on", "issued_on", { type: "date" })}{field("Delivered electronically on", "delivered_on", { type: "date" })}{field("Primary beneficiary", "primary_beneficiary")}
                </div>
                <Button size="sm" disabled={busy || !draft.carrier.trim() || !draft.product.trim() || !draft.policy_number.trim()} onClick={() => void run(async () => {
                  const r = await saveIssuance({ householdId, contactId: personId, fileId: fileId || undefined, draft, contractLink: contract.trim(), applicationLinks: apps.split("\n").map((l) => l.trim()).filter(Boolean), contingent });
                  toast.success(`${r.updatedPolicy ? "Policy updated" : "Policy recorded as in force"}${r.attachedToFile ? "; evidence added to the insurance file" : ""}`);
                  r.problems.forEach((p) => toast.error(p));
                  reset();
                })}>Record the policy and attach the evidence</Button>
              </div>
            )}
          </div>
        )}

        {data.issuances.length > 0 && (
          <ul className="space-y-2" data-testid="issuance-list">
            {data.issuances.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.carrier}, {r.product}</span><Badge variant="outline" className="text-[10px]">{policyTypeLabel(r.policy_type)}</Badge><Badge variant={r.status === "confirmed" ? "default" : "secondary"} className="text-[10px]">{STATUS[r.status]}</Badge><span className="text-xs text-muted-foreground">policy {r.policy_number}{r.issued_on ? `, issued ${r.issued_on}` : ""}{r.delivered_on ? `, delivered ${r.delivered_on}` : ""}, recorded {day(r.created_at)}</span></div>
                {r.status !== "confirmed" && letterFor !== r.id && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void run(async () => { const l = await getDeliveryLetter(r.id); setLetter(l.md); setLetterFor(r.id); })}>{r.status === "sent" ? "Review and send the letter again" : "Draft the closing letter"}</Button>}
                {letterFor === r.id && (
                  <div className="mt-3 space-y-2" data-testid="delivery-letter">
                    <label className="text-xs font-medium">The letter (edit anything; this is exactly what the client will read, and they confirm receipt of the policy and the 10-day right of rescission)<textarea className="mt-1 block min-h-[280px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={letter} onChange={(e) => setLetter(e.target.value)} /></label>
                    <div className="flex gap-2"><Button size="sm" disabled={busy || !letter.trim() || /_{3,}/.test(letter)} onClick={() => void run(async () => { await sendDeliveryLetter(r.id, letter, r.file_id ?? undefined); setLetterFor(null); }, "Sent to the client portal")}>Send to the client portal</Button><Button size="sm" variant="ghost" onClick={() => setLetterFor(null)}>Close</Button></div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
