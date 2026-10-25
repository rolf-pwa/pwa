import { useCallback, useEffect, useState } from "react";
import { useResetOnChange } from "@/shared/hooks/useResetOnChange";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { draftInvestmentLetter, getInvestmentRecs, saveInvestmentRec, sendInvestmentLetter, type InvModelFull, type InvRecFields, type InvRecPerson } from "@/modules/crm/lib/reviewAgent";

const LETTER: Record<string, string> = { sent: "Waiting on the client to confirm", partly_signed: "Partly confirmed", signed: "Confirmed by the client", void: "Voided" };
const blank = (p: InvRecPerson): InvRecFields => p.rec
  ? { profileKey: p.rec.profile_key, amount: Number(p.rec.amount) || 0, accounts: p.rec.accounts ?? "", guarantee: p.rec.guarantee ?? "", fees: p.rec.fees ?? "", reason: p.rec.reason ?? "", deviationReason: p.rec.deviation_reason ?? "" }
  : { profileKey: p.riskProfile ?? "", amount: 0, accounts: "", guarantee: "", fees: "", reason: p.suggestedReason, deviationReason: "" };

/** One person's recommendation: the iA model portfolio for their risk profile (or another with the reason), the amount and terms, and the reason why letter. */
function PersonRec({ person, models, householdId, onChanged }: { person: InvRecPerson; models: InvModelFull[]; householdId: string; onChanged: () => void }) {
  const [f, setF] = useState<InvRecFields>(() => blank(person));
  const [letter, setLetter] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useResetOnChange(() => { setF(blank(person)); setDirty(false); }, [person.rec?.id, person.riskProfile]);
  const set = <K extends keyof InvRecFields>(k: K, v: InvRecFields[K]) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  const model = models.find((m) => m.profile_key === f.profileKey);
  const fitted = models.find((m) => m.profile_key === person.riskProfile);
  const different = !!person.riskProfile && !!f.profileKey && f.profileKey !== person.riskProfile;
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(null); } };
  const save = () => run("save", async () => { await saveInvestmentRec(householdId, person.id, f); toast.success("Recommendation saved"); setDirty(false); setLetter(null); onChanged(); });
  const draft = () => run("draft", async () => { const r = await draftInvestmentLetter(person.rec!.id); setLetter(r.md); });
  const send = () => run("send", async () => { await sendInvestmentLetter(person.rec!.id, letter ?? ""); toast.success("Sent to the client portal"); setLetter(null); onChanged(); });
  const blanks = letter ? (letter.match(/_{3,}/g) ?? []).length : 0;
  const status = person.rec?.letter;

  return (
    <Card data-testid={`rec-${person.id}`}>
      <CardHeader className="pb-3"><CardTitle className="text-lg">{person.name}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {person.riskProfile ? <p className="text-xs text-muted-foreground">Risk profile from the iA investor profile: <span className="font-medium text-foreground">{fitted?.label ?? person.riskProfile}</span></p>
          : <p className="text-xs text-amber-700" data-testid="no-risk-profile">The risk profile is not recorded yet. Record it on the Investor profile page: the portfolio follows it.</p>}
        <label className="block text-xs">Model portfolio
          <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.profileKey} onChange={(e) => set("profileKey", e.target.value)} aria-label="Model portfolio">
            <option value="">Choose…</option>
            {models.map((m) => <option key={m.profile_key} value={m.profile_key}>{m.label}{m.profile_key === person.riskProfile ? " (matches the risk profile)" : ""}</option>)}
          </select>
        </label>
        {model && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs" data-testid="model-funds">
            <p className="mb-1.5 text-muted-foreground">{model.income_min}% to {model.income_max}% fixed income, {model.equity_min}% to {model.equity_max}% equity{model.as_of ? ` (iA, as at ${model.as_of})` : ""}</p>
            <table className="w-full"><tbody>{[...model.funds].sort((a, b) => b.weight - a.weight).map((x) => <tr key={x.name} className="border-b last:border-0"><td className="py-1">{x.name}</td><td className="py-1 text-right tabular-nums">{x.weight}%</td></tr>)}</tbody></table>
          </div>
        )}
        {different && (
          <label className="block text-xs">Why not the {fitted?.label} portfolio for this risk profile? (required)
            <textarea className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={f.deviationReason} onChange={(e) => set("deviationReason", e.target.value)} aria-label="Why a different portfolio" />
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">Amount to invest<Input className="mt-1" type="number" min={0} value={f.amount || ""} placeholder="0" onChange={(e) => set("amount", Number(e.target.value) || 0)} /></label>
          <label className="block text-xs">Accounts<Input className="mt-1" value={f.accounts} placeholder="for example: RRSP and TFSA" onChange={(e) => set("accounts", e.target.value)} /></label>
          <label className="block text-xs">Guarantee<Input className="mt-1" value={f.guarantee} placeholder="as in the contract, for example 75% maturity and death" onChange={(e) => set("guarantee", e.target.value)} /></label>
          <label className="block text-xs">Fees<Input className="mt-1" value={f.fees} placeholder="the fee option and the management expense ratio" onChange={(e) => set("fees", e.target.value)} /></label>
        </div>
        <label className="block text-xs">Why this suits the client (a first draft from the profile; rewrite it in your words)
          <textarea className="mt-1 block min-h-[110px] w-full rounded-md border bg-background px-3 py-2 text-sm" value={f.reason} onChange={(e) => set("reason", e.target.value)} aria-label="Why this suits the client" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== null || !f.profileKey} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save recommendation"}</Button>
          {person.rec && <Button size="sm" variant="outline" disabled={busy !== null || dirty} onClick={() => void draft()}>{busy === "draft" ? "Drafting…" : "Draft the reason why letter"}</Button>}
          {person.rec && dirty && <span className="text-xs text-muted-foreground">Save your changes before drafting the letter.</span>}
        </div>
        {status && <p className="text-xs" data-testid="letter-status"><Badge variant={status.status === "signed" ? "default" : "secondary"} className="mr-2 text-[10px]">{LETTER[status.status]}</Badge>{status.pdf_url && <a href={status.pdf_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Signed copy</a>}</p>}
        {letter !== null && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="letter-editor">
            <p className="text-xs font-medium">The letter, as the client will read it. Edit anything; fill in each blank (____) before it can go.</p>
            <textarea className="block min-h-[360px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={letter} onChange={(e) => setLetter(e.target.value)} aria-label="The reason why letter" />
            {blanks > 0 && <p className="text-xs text-amber-700" data-testid="letter-blanks">{blanks} blank{blanks === 1 ? "" : "s"} still to fill in.</p>}
            <div className="flex gap-2"><Button size="sm" disabled={busy !== null || blanks > 0} onClick={() => void send()}>{busy === "send" ? "Sending…" : "Send to the client portal"}</Button><Button size="sm" variant="ghost" onClick={() => setLetter(null)}>Cancel</Button></div>
            <p className="text-xs text-muted-foreground">The client confirms it in their portal, and the confirmed copy is filed in Advisor Files and ticks the Reason why letter on the file. Check the cancellation and withdrawal wording against your contract before sending.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The recommendation for each adult: the iA model portfolio, the terms, and the reason why letter; people side by side. */
export function InvestmentRecommendation({ householdId }: { householdId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvestmentRecs>> | null>(null);
  const load = useCallback(async () => { try { setData(await getInvestmentRecs(householdId)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the recommendations"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (data.people.length === 0) return <Card><CardContent className="p-5 text-sm text-muted-foreground">There are no adults in this household yet.</CardContent></Card>;
  return (
    <div className="space-y-3" data-testid="investment-recommendation">
      <p className="text-sm text-muted-foreground">The portfolio is the iA model for the risk profile recorded from the client's iA investor profile. Choosing another needs a reason, and the letter says so. The letter goes to the client's portal to confirm.</p>
      <div className={data.people.length > 1 ? "grid items-start gap-4 lg:grid-cols-2" : "grid gap-4"}>
        {data.people.map((p) => <PersonRec key={p.id} person={p} models={data.models} householdId={householdId} onChanged={() => void load()} />)}
      </div>
    </div>
  );
}
