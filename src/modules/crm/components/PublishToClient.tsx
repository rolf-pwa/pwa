import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { publishPortfolioReview, unpublishPortfolioReview, type PortfolioPackResponse, type PortfolioPack } from "@/modules/crm/lib/reviewAgent";
import { buildClientView, buildClientProposal, suggestedRebalanceNote, REBALANCE_SECTIONS, type ClientIncludes, type ViewKind } from "../../../../supabase/functions/_shared/portfolio-review-client";
import { PortalPortfolioReview } from "@/modules/portal/components/PortalPortfolioReview";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const SECTIONS: { key: keyof ClientIncludes; label: string }[] = [
  { key: "returns", label: "Values and returns by account" }, { key: "mix", label: "Mix against their Investor Profile" },
  { key: "funds", label: "Funds against our model portfolio" }, { key: "rebalancing", label: "What I propose to switch" }, { key: "reset", label: "Death benefit reset" },
];
const ALL: ClientIncludes = { returns: true, mix: true, funds: true, reset: true, rebalancing: true };
/** Only these three can be chosen for a rebalance; the rest are shown greyed out. */
const REBALANCE_CHOICES: (keyof ClientIncludes)[] = ["funds", "reset", "rebalancing"];

/**
 * Publish to the client's portal from the one advisor pack. Two kinds, the same page: the Portfolio Review (Tier 2, discussed at the meeting) and
 * the Tier 1 rebalancing (the client sees only the funds against the model, the death benefit reset and the proposal, and authorizes it).
 */
export function PublishToClient({ householdId, householdLabel, pack, publication, rebalancePublication = null, rebalancingObligation = null, rebalanceProgress = [], onChanged }: {
  householdId: string; householdLabel: string; pack: PortfolioPack; publication: PortfolioPackResponse["publication"];
  rebalancePublication?: PortfolioPackResponse["rebalancePublication"]; rebalancingObligation?: PortfolioPackResponse["rebalancingObligation"]; rebalanceProgress?: PortfolioPackResponse["rebalanceProgress"]; onChanged: () => void;
}) {
  const [open, setOpen] = useState<ViewKind | null>(null);
  const [note, setNote] = useState("");
  const [includes, setIncludes] = useState<ClientIncludes>(ALL);
  const [busy, setBusy] = useState(false);
  // The advisor's own wording for the shaded commentary boxes. Null means the suggested wording.
  // A rebalancing proposed from fund detail older than the limit needs Rolf to confirm he checked current holdings on iA first.
  const [holdingsChecked, setHoldingsChecked] = useState(false);
  const [narr, setNarr] = useState<{ mix: string | null; funds: string | null }>({ mix: null, funds: null });
  const kind: ViewKind = open ?? "review";
  const rebalance = kind === "rebalance";

  const start = (k: ViewKind) => {
    const existing = k === "rebalance" ? rebalancePublication : publication;
    setNote(existing?.note ?? (k === "rebalance" ? suggestedRebalanceNote(buildClientProposal(pack as any)) : ""));
    setIncludes(k === "rebalance" ? { ...REBALANCE_SECTIONS, ...(existing?.includes ? { funds: existing.includes.funds, reset: existing.includes.reset, rebalancing: existing.includes.rebalancing ?? true } : {}) } : { ...ALL, ...(existing?.includes ?? {}) });
    setHoldingsChecked(false);
    setNarr({ mix: existing?.includes?.narratives?.mix ?? null, funds: existing?.includes?.narratives?.funds ?? null });
    setOpen(k);
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setOpen(null); onChanged(); } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); } finally { setBusy(false); }
  };
  const suggested = buildClientView(pack, includes, note, householdLabel, kind);
  const view = buildClientView(pack, includes, note, householdLabel, kind, narr);
  const ob = rebalancingObligation;
  const canRebalance = Boolean(ob && !ob.completed_at);
  const authorized = Boolean(ob?.acknowledged_at);

  return (
    <>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><Send className="h-4 w-4 text-accent" /> What the client sees</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="font-medium">Portfolio Review</p>
            {publication
              ? <p>Published {when(publication.published_at)} by {publication.published_by}. The household can read it on their portal dashboard.</p>
              : <p className="text-muted-foreground">Nothing is shown to the client yet. Prepare it, add a short note, check the preview, then publish.</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => start("review")}>{publication ? "Update what they see" : "Publish to the client…"}</Button>
              {publication && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unpublishPortfolioReview(householdId), "Taken back from the portal")}>Take back</Button>}
            </div>
          </div>
          {canRebalance && (
            <div className="space-y-2 border-t pt-3" data-testid="rebalance-publish">
              <p className="font-medium">Rebalancing</p>
              {authorized
                ? <p>The client authorized it on {when(ob!.acknowledged_at!)}. A task is on your list to carry it out; mark it done on Georgia Reviews.</p>
                : rebalancePublication
                  ? <div className="space-y-1">
                      <p>Published {when(rebalancePublication.published_at)} by {rebalancePublication.published_by}. Each account holder authorizes the changes to their own accounts from their own portal.</p>
                      {rebalanceProgress.length > 0 && (
                        <ul className="space-y-0.5 text-xs" data-testid="rebalance-progress">
                          {rebalanceProgress.map((p) => <li key={p.owner}><span className="font-medium">{p.owner}</span>: {p.authorized === p.total ? `authorized all ${p.total}${p.at ? ` on ${when(p.at)}` : ""}` : p.authorized > 0 ? `${p.authorized} of ${p.total} authorized` : `waiting (${p.total} ${p.total === 1 ? "change" : "changes"})`}</li>)}
                        </ul>
                      )}
                    </div>
                  : <p className="text-muted-foreground">The client sees only the funds against our model portfolio, the death benefit reset and what you propose, and authorizes it item by item.</p>}
              {!authorized && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => start("rebalance")}>{rebalancePublication ? "Update the rebalancing" : "Publish the rebalancing…"}</Button>
                  {rebalancePublication && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unpublishPortfolioReview(householdId, "rebalance"), "Taken back from the portal")}>Take back</Button>}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rebalance ? "Publish the rebalancing" : "Publish the Portfolio Review"}: {householdLabel}</DialogTitle>
            <DialogDescription>{rebalance
              ? "The client sees the same page as the Portfolio Review, with only these three sections. They tick each change and authorize it, or ask to talk it through. Georgia sends the reminders."
              : "The client sees a plain-language version of this page, frozen as it is now. Georgia emails the household's adults the first time. Choose what to include and add a note."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {SECTIONS.map((s) => {
                const locked = rebalance && !REBALANCE_CHOICES.includes(s.key);
                return (
                  <label key={s.key} className={`flex items-center gap-2 text-sm ${locked ? "cursor-not-allowed text-muted-foreground/60" : ""}`}>
                    <Checkbox checked={locked ? false : includes[s.key]} disabled={locked} onCheckedChange={(c) => setIncludes((i) => ({ ...i, [s.key]: c === true }))} />{s.label}
                  </label>
                );
              })}
            </div>
            {[
              { key: "mix" as const, title: "Commentary under Your mix", text: suggested.mix?.commentary.join("\n\n") },
              { key: "funds" as const, title: "Commentary under Funds against our model portfolio", text: suggested.funds?.commentary.join("\n\n") },
            ].filter((n) => n.text !== undefined).map((n) => (
              <div key={n.key} className="space-y-1" data-testid={`narrative-${n.key}`}>
                <div className="flex items-center justify-between"><p className="text-xs font-medium">{n.title}</p>{narr[n.key] !== null && <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setNarr((s) => ({ ...s, [n.key]: null }))}>Use the suggested wording</button>}</div>
                <Textarea value={narr[n.key] ?? n.text ?? ""} onChange={(e) => setNarr((s) => ({ ...s, [n.key]: e.target.value }))} rows={4} aria-label={n.title} />
              </div>
            ))}
            {pack.holdings?.asOf && (
              <div className={`rounded-md border p-3 text-xs ${rebalance && pack.holdings.stale ? "border-amber-400 bg-amber-50 text-amber-900" : "text-muted-foreground"}`} data-testid="holdings-age">
                <p>Values as of {pack.asOf}. Fund detail from the statement of {pack.holdings.asOf} ({pack.holdings.ageDays} days old). The mix and the size of each switch rest on those holdings.</p>
                {rebalance && pack.holdings.stale && (
                  <label className="mt-2 flex items-start gap-2 font-medium"><Checkbox checked={holdingsChecked} onCheckedChange={(v) => setHoldingsChecked(v === true)} aria-label="I have checked the current holdings" /><span>I have checked the current holdings on iA's advisor site and the proposal still holds.</span></label>
                )}
              </div>
            )}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder={rebalance ? "Tell the client what you are proposing and why, in your own words." : "A short note from you, in your own words (optional)."} />
            <PortalPortfolioReview view={view} preview />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
            <Button disabled={busy || (rebalance && note.trim().length < 10) || (rebalance && !!pack.holdings?.stale && !holdingsChecked)} onClick={() => run(async () => { const r = await publishPortfolioReview(householdId, note, includes, kind, narr, holdingsChecked); if (r.emailed) toast.message(`Georgia emailed ${r.emailed} ${r.emailed === 1 ? "person" : "people"}`); }, (rebalance ? rebalancePublication : publication) ? "Updated" : "Published to the portal")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (rebalance ? rebalancePublication : publication) ? "Save changes" : "Publish"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
