import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";
import { forgetSweepSender, getSweep, rateSweepItem, runSweep, setSweepAuto, type Rate, type SweepBucket, type SweepItem, type SweepOverview } from "@/modules/crm/lib/inboxSweep";

const BUCKETS: { key: SweepBucket; label: string; hint: string }[] = [
  { key: "needs_you", label: "Needs you", hint: "A person or a deadline" },
  { key: "client", label: "Clients", hint: "Always shown, never touched" },
  { key: "fyi", label: "FYI", hint: "Worth knowing, nothing to do" },
  { key: "archivable", label: "Would archive", hint: "Noise. Georgia would archive these once allowed" },
];
const LABEL: Record<SweepBucket, string> = { needs_you: "Needs you", client: "Clients", fyi: "FYI", archivable: "Would archive" };
const MOVABLE: Exclude<SweepBucket, "client">[] = ["needs_you", "fyi", "archivable"];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const pct = (r: Rate | null) => (r ? `${Math.round((r.right / r.rated) * 100)}% right (${r.right} of ${r.rated})` : "not rated yet");

export function InboxSweep() {
  const [data, setData] = useState<SweepOverview | null>(null);
  const [tab, setTab] = useState<SweepBucket>("needs_you");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await getSweep()); } catch (e: any) { toast.error(e?.message ?? "Couldn't load the inbox sweep"); } }, []);
  useEffect(() => { void load(); }, [load]);

  const sweep = async () => {
    setBusy(true);
    try {
      const r = await runSweep();
      toast.success(r.sorted ? `Sorted ${r.sorted} message${r.sorted !== 1 ? "s" : ""}${r.remaining ? `, ${r.remaining} more waiting. Sweep again.` : ""}` : "Nothing new to sort");
      if (r.modelFailed) toast.error("Some messages could not be sorted and will be retried");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't sweep"); } finally { setBusy(false); }
  };
  const [choosing, setChoosing] = useState<string | null>(null);
  const rate = async (it: SweepItem, value: "right" | "wrong", correct?: Exclude<SweepBucket, "client">) => {
    const next = it.feedback === value && !correct ? null : value;
    setChoosing(null);
    try {
      const r = await rateSweepItem(it.id, next, correct);
      if (correct) toast.success(`Moved to ${LABEL[correct]}.${r.remembered ? ` Georgia will sort mail from ${r.remembered} that way from now on${r.moved ? `, and moved ${r.moved} more from them` : ""}.` : ""}`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't save"); await load(); }
  };
  const toggleAuto = async (on: boolean) => {
    setData((d) => d && { ...d, auto: on });
    try { await setSweepAuto(on); toast.success(on ? "The sweep will run every morning before your briefing." : "The morning sweep is off. Use Sweep now when you want it."); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't save"); await load(); }
  };
  const forget = async (sender: string) => { try { await forgetSweepSender(sender); await load(); } catch (e: any) { toast.error(e?.message ?? "Couldn't forget"); } };

  const items = (data?.items ?? []).filter((i) => i.bucket === tab);
  const count = (b: SweepBucket) => (data?.items ?? []).filter((i) => i.bucket === b).length;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">Inbox sweep</CardTitle>
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => void sweep()}>{busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Sweep now</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Georgia sorts your last 7 days of inbox mail. For now she only reads: nothing is archived, deleted or changed in Gmail. Mark each sort right, or wrong and say where it belonged: it moves there, and Georgia remembers the sender. So you can judge her before she is given any power.</p>
        {data && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={data.auto !== false} onCheckedChange={(v) => void toggleAuto(v)} aria-label="Run every morning" />
            Run every morning at 4:30, before your briefing, which then says what it found
          </label>
        )}
        {data && <p className="text-xs text-muted-foreground">Overall: {pct(data.accuracy.overall)}. Would-archive: {pct(data.accuracy.archivable)}.</p>}
        <div className="flex flex-wrap gap-2" role="tablist">
          {BUCKETS.map((b) => (
            <Button key={b.key} size="sm" role="tab" aria-selected={tab === b.key} variant={tab === b.key ? "default" : "outline"} onClick={() => setTab(b.key)}>{b.label} ({count(b.key)})</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{BUCKETS.find((b) => b.key === tab)?.hint}</p>
        {!data ? <Loader2 className="h-4 w-4 animate-spin" /> : items.length === 0 ? <p className="text-muted-foreground">Nothing here. {data.items.length === 0 ? "Press Sweep now." : ""}</p> : (
          <div className="rounded-md border border-border">
            {items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate"><span className="font-medium">{i.subject}</span> <span className="text-muted-foreground">from {i.from_addr}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{i.reason}{i.decided_by === "rule" ? "" : " (Georgia's judgement)"} · {when(i.received_at)}</p>
                </div>
                <a href={i.link} target="_blank" rel="noopener noreferrer" aria-label="Open in Gmail" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>
                <Button size="icon" variant={i.feedback === "right" ? "default" : "outline"} className="h-7 w-7" aria-label="Sorted right" aria-pressed={i.feedback === "right"} onClick={() => void rate(i, "right")}><Check className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant={i.feedback === "wrong" ? "destructive" : "outline"} className="h-7 w-7" aria-label="Sorted wrong" aria-pressed={i.feedback === "wrong"} onClick={() => (i.feedback === "wrong" ? void rate(i, "wrong") : setChoosing(choosing === i.id ? null : i.id))}><X className="h-3.5 w-3.5" /></Button>
                {i.feedback === "wrong" && <Badge variant="outline">{i.correct_bucket ? `You moved it to ${LABEL[i.correct_bucket]}` : "Marked wrong"}</Badge>}
                {choosing === i.id && (
                  <div className="flex w-full flex-wrap items-center gap-2 pt-1" role="group" aria-label="Where should this have gone?">
                    <span className="text-xs text-muted-foreground">Where should this have gone?</span>
                    {MOVABLE.filter((b) => b !== i.bucket).map((b) => <Button key={b} size="sm" variant="outline" onClick={() => void rate(i, "wrong", b)}>{LABEL[b]}</Button>)}
                    <Button size="sm" variant="ghost" onClick={() => setChoosing(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {data && data.senders.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">What Georgia has learned from you ({data.senders.length})</summary>
            <ul className="mt-1 space-y-1">
              {data.senders.map((x) => (
                <li key={x.sender} className="flex items-center justify-between gap-2">
                  <span className="truncate">{x.sender}: {LABEL[x.bucket]}</span>
                  <button type="button" className="underline" onClick={() => void forget(x.sender)}>Forget</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
