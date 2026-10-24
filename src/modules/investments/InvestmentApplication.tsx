import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { draftDeliveryLetterApi, getInvestmentContracts, saveInvestmentContract, sendDeliveryLetterApi, type InvContractFields, type InvContractRow } from "@/modules/crm/lib/reviewAgent";

const LETTER: Record<string, string> = { sent: "Waiting on the client to confirm", partly_signed: "Partly confirmed", signed: "Confirmed by the client", void: "Voided" };
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "long" });
const EMPTY: InvContractFields = { contractNumber: "", accounts: "", amount: 0, applicationUrl: "", contractUrl: "", issuedOn: "", confirmationReceivedOn: "", cancelBusinessDays: null, fundFactsOn: "", fundFactsNote: "" };
const fromRow = (r: InvContractRow): InvContractFields => ({ contractNumber: r.contract_number ?? "", accounts: r.accounts ?? "", amount: Number(r.amount) || 0, applicationUrl: r.application_url ?? "", contractUrl: r.contract_url ?? "", issuedOn: r.issued_on ?? "", confirmationReceivedOn: r.confirmation_received_on ?? "", cancelBusinessDays: r.cancel_business_days, fundFactsOn: r.fund_facts_on ?? "", fundFactsNote: r.fund_facts_note ?? "" });

export function WindowChip({ w }: { w: InvContractRow["window"] }) {
  if (w.state === "unset") return <Badge variant="outline" className="text-[10px]" data-testid="cancel-window">Right to cancel: enter the date the client received the confirmation and the number of business days from the contract</Badge>;
  if (w.state === "open") return <Badge className="bg-amber-100 text-[10px] text-amber-900 hover:bg-amber-100" data-testid="cancel-window">Right to cancel open until {longDay(w.endsOn!)} ({w.daysLeft === 0 ? "ends today" : `${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"} left`})</Badge>;
  return <Badge variant="secondary" className="text-[10px]" data-testid="cancel-window">Right to cancel ended {longDay(w.endsOn!)}</Badge>;
}

/** One contract: the evidence (application and contract links), the dates, the right-to-cancel window, and the delivery letter the client confirms. */
function ContractCard({ person, householdId, row, onChanged }: { person: { id: string; name: string }; householdId: string; row: InvContractRow | null; onChanged: () => void }) {
  const [f, setF] = useState<InvContractFields>(row ? fromRow(row) : EMPTY);
  const [letter, setLetter] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setF(row ? fromRow(row) : EMPTY); setDirty(false); }, [row?.id, row?.window.state]);
  const set = <K extends keyof InvContractFields>(k: K, v: InvContractFields[K]) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(null); } };
  const save = () => run("save", async () => { await saveInvestmentContract(householdId, person.id, f, row?.id); toast.success("Contract saved"); setDirty(false); onChanged(); });
  const draft = () => run("draft", async () => { const r = await draftDeliveryLetterApi(row!.id); setLetter(r.md); });
  const send = () => run("send", async () => { await sendDeliveryLetterApi(row!.id, letter ?? ""); toast.success("Sent to the client portal"); setLetter(null); onChanged(); });
  const blanks = letter ? (letter.match(/_{3,}/g) ?? []).length : 0;
  const text = (label: string, key: "contractNumber" | "accounts" | "applicationUrl" | "contractUrl" | "fundFactsNote", placeholder = "") => <label className="block text-xs">{label}<Input className="mt-1" value={f[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} /></label>;
  const date = (label: string, key: "issuedOn" | "confirmationReceivedOn" | "fundFactsOn") => <label className="block text-xs">{label}<Input className="mt-1" type="date" value={f[key]} onChange={(e) => set(key, e.target.value)} /></label>;

  return (
    <Card data-testid={row ? `contract-${row.id}` : `new-contract-${person.id}`}>
      <CardHeader className="pb-2"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{row ? `${person.name}: ${row.contract_number ? `contract ${row.contract_number}` : "contract"}` : `${person.name}: add a contract`}</CardTitle>{row && <WindowChip w={row.window} />}</div></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          {text("Contract number", "contractNumber")}
          {text("Accounts", "accounts", "for example: RRSP and TFSA")}
          <label className="block text-xs">Amount invested<Input className="mt-1" type="number" min={0} value={f.amount || ""} placeholder="0" onChange={(e) => set("amount", Number(e.target.value) || 0)} /></label>
          {date("Contract issued on", "issuedOn")}
          {text("iA application (Drive link)", "applicationUrl", "https://drive.google.com/…")}
          {text("Issued contract (Drive link)", "contractUrl", "https://drive.google.com/…")}
          {date("Fund Facts and information folder given on", "fundFactsOn")}
          {text("How they were given", "fundFactsNote", "for example: with the contract by email")}
          {date("Client received the confirmation on", "confirmationReceivedOn")}
          <label className="block text-xs">Business days to cancel, from the contract<Input className="mt-1" type="number" min={0} max={60} value={f.cancelBusinessDays ?? ""} placeholder="from the contract" onChange={(e) => set("cancelBusinessDays", e.target.value === "" ? null : Number(e.target.value))} aria-label="Business days to cancel" /></label>
        </div>
        <p className="text-xs text-muted-foreground">The cancel date skips weekends but not public holidays, so check it against the contract. Links are checked against Drive when you save.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : row ? "Save changes" : "Save contract"}</Button>
          {row && <Button size="sm" variant="outline" disabled={busy !== null || dirty} onClick={() => void draft()}>{busy === "draft" ? "Drafting…" : "Draft the delivery letter"}</Button>}
          {row && dirty && <span className="text-xs text-muted-foreground">Save your changes before drafting the letter.</span>}
        </div>
        {row?.letter && <p className="text-xs" data-testid="delivery-status"><Badge variant={row.letter.status === "signed" ? "default" : "secondary"} className="mr-2 text-[10px]">{LETTER[row.letter.status]}</Badge>{row.letter.pdf_url && <a href={row.letter.pdf_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Confirmed copy</a>}</p>}
        {letter !== null && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="letter-editor">
            <p className="text-xs font-medium">The letter, as the client will read it. Edit anything; fill in each blank (____) before it can go.</p>
            <textarea className="block min-h-[300px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={letter} onChange={(e) => setLetter(e.target.value)} aria-label="The delivery letter" />
            {blanks > 0 && <p className="text-xs text-amber-700" data-testid="letter-blanks">{blanks} blank{blanks === 1 ? "" : "s"} still to fill in.</p>}
            <div className="flex gap-2"><Button size="sm" disabled={busy !== null || blanks > 0} onClick={() => void send()}>{busy === "send" ? "Sending…" : "Send to the client portal"}</Button><Button size="sm" variant="ghost" onClick={() => setLetter(null)}>Cancel</Button></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Application and delivery: each person's contracts after the iA application, side by side for a couple. */
export function InvestmentApplication({ householdId }: { householdId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvestmentContracts>> | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const load = useCallback(async () => { try { setData(await getInvestmentContracts(householdId)); setAdding(new Set()); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the contracts"); } }, [householdId]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-4" data-testid="investment-application">
      <p className="text-sm text-muted-foreground">After the iA application: keep the application and contract, record when the Fund Facts and information folder were given and when the client received their confirmation, and track the right-to-cancel window. The delivery letter goes to the client's portal to confirm.</p>
      <div className={data.people.length > 1 ? "grid items-start gap-4 lg:grid-cols-2" : "grid gap-4"}>
        {data.people.map((p) => {
          const mine = data.contracts.filter((c) => c.contact_id === p.id);
          return (
            <div key={p.id} className="space-y-3">
              {mine.map((c) => <ContractCard key={c.id} person={p} householdId={householdId} row={c} onChanged={() => void load()} />)}
              {(mine.length === 0 || adding.has(p.id)) ? <ContractCard person={p} householdId={householdId} row={null} onChanged={() => void load()} /> : <Button size="sm" variant="outline" onClick={() => setAdding(new Set([...adding, p.id]))}>Add another contract for {p.name}</Button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
