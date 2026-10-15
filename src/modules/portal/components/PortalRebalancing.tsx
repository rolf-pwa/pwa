import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronLeft, Scale } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { PortalProposal } from "./PortalProposal";
import { PortalPortfolioReview } from "./PortalPortfolioReview";
import { itemsOwnedBy, type ClientProposal, type ClientView } from "../../../../supabase/functions/_shared/portfolio-review-client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";

export interface RebalancingState {
  label: string;
  summary: string;
  publishedAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  statement: string;
  statementVersion: string;
  /** The engine's proposal (switches and death benefit resets), frozen when Rolf published. When present it is reviewed item by item on its own page. */
  proposal?: ClientProposal | null;
  /** The page Rolf published from the pack (the same format as the Portfolio Review, fewer sections), frozen. When present it is what the client reads. */
  view?: ClientView | null;
  /** Items authorized so far, by whichever account holder, and the signed-in person. Each person authorizes the changes to their own accounts. */
  authorizedIds?: string[];
  viewerId?: string | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });

/**
 * The family's portfolio rebalancing. It appears only after Rolf has prepared and published it. The client reads what is proposed,
 * and only then acknowledges it (or asks to talk first). Acknowledging records the consent with the wording and proposal shown.
 */
export function PortalRebalancing({ rebalancing, portalToken, onChanged, onTalkFirst }: { rebalancing: RebalancingState; portalToken: string; onChanged: () => void; onTalkFirst: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (action: "acknowledge" | "talk_first") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("portal-rebalance", { body: { portal_token: portalToken, action } });
      if (error || data?.error) throw new Error(data?.error ?? "Something went wrong. Please try again.");
      if (action === "acknowledge") toast.success("Thank you. Your rebalancing is acknowledged.");
      onChanged();
      if (action === "talk_first") onTalkFirst();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (rebalancing.completedAt || rebalancing.acknowledgedAt) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2.5 p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <h3 className="font-serif text-sm font-semibold text-foreground">Portfolio rebalancing · {rebalancing.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {rebalancing.completedAt ? `Completed on ${day(rebalancing.completedAt)}.` : `Acknowledged on ${day(rebalancing.acknowledgedAt!)}. Rolf is carrying it out and you will be told when it is done.`}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-accent/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-accent" />
          <h3 className="font-serif text-sm font-semibold text-foreground">Portfolio rebalancing · {rebalancing.label}</h3>
        </div>
        <p className="text-xs text-muted-foreground">Rolf has prepared a rebalancing of your portfolio for your review. The full proposal is in your Documents.</p>
        {rebalancing.summary && <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm text-foreground">{rebalancing.summary}</p>}
        <div className="flex flex-col gap-2">
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={busy} onClick={() => setConfirm(true)}>I've reviewed it: acknowledge</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("talk_first")}>I'd like to talk first</Button>
        </div>
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Acknowledge your {rebalancing.label} rebalancing</AlertDialogTitle>
            <AlertDialogDescription>{rebalancing.statement}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void send("acknowledge"); }}>I acknowledge and approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Does the signed-in person still have changes of their own to authorize? (A spouse's changes are theirs to authorize, from their own portal.) */
export function rebalancingNeedsMe(r: RebalancingState | null | undefined): boolean {
  if (!r || !r.proposal || r.completedAt || r.acknowledgedAt) return false;
  const mine = r.viewerId ? itemsOwnedBy(r.proposal, r.viewerId) : [...r.proposal.switches, ...r.proposal.resets];
  return mine.some((i) => !(r.authorizedIds ?? []).includes(i.id));
}

/** Shown once the signed-in person has authorized their own changes but someone else's are still open. */
export function PortalRebalancingWaiting({ rebalancing, onOpen }: { rebalancing: RebalancingState; onOpen: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm" style={{ background: "hsl(var(--pw-sand) / 0.2)" }} data-testid="rebalancing-waiting">
      <div className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-accent/50 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0">
            <h3 className="font-serif text-base font-semibold text-foreground">You have authorized your {rebalancing.label} rebalancing changes</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">The changes to the other account holder's accounts are theirs to authorize, from their own portal. I will let you know when it is done.</p>
          </div>
        </div>
        <Button variant="outline" onClick={onOpen}>See where it stands</Button>
      </div>
    </div>
  );
}

/** The dashboard's pointer to a rebalancing that has a proposal to review: one highlighted container. Gone once the signed-in person has authorized theirs. */
export function PortalRebalancingTeaser({ rebalancing, onOpen }: { rebalancing: RebalancingState; onOpen: () => void }) {
  if (!rebalancingNeedsMe(rebalancing)) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-accent/40 shadow-sm" style={{ background: "hsl(var(--pw-sand) / 0.35)" }} data-testid="rebalancing-teaser">
      <div className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-accent px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <Scale className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-base font-semibold text-foreground">Your {rebalancing.label} rebalancing is ready to review</h3>
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">Needs you</span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">Shared {day(rebalancing.publishedAt)}. Review each change, then authorize it or ask to talk it through.</p>
          </div>
        </div>
        <Button onClick={onOpen} className="gap-1.5">Review and authorize <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export interface RebalancingMeetingType { label: string; url: string; embedUrl?: string }

/** The rebalancing's own page: Rolf's summary, then the proposal to tick, authorize, or talk through. */
export function PortalRebalancingPage({ rebalancing, portalToken, onChanged, onBack, meetingTypes = [] }: { rebalancing: RebalancingState | null; portalToken: string; onChanged: () => void; onBack: () => void; meetingTypes?: RebalancingMeetingType[] }) {
  const [embedded, setEmbedded] = useState<RebalancingMeetingType | null>(null);
  const send = async (action: "acknowledge" | "talk_first", itemIds?: string[]) => {
    const { data, error } = await supabase.functions.invoke("portal-rebalance", { body: { portal_token: portalToken, action, item_ids: itemIds } });
    if (error || data?.error) throw new Error(data?.error ?? "Something went wrong. Please try again.");
  };
  const authorize = async (ids: string[]) => {
    try { await send("acknowledge", ids); toast.success("Thank you. Your rebalancing is authorized."); onChanged(); }
    catch (e: any) { toast.error(e?.message ?? "Something went wrong. Please try again."); }
  };
  const talk = async () => {
    try {
      await send("talk_first"); toast.success("Thank you. I will be in touch."); onChanged();
      const t = meetingTypes.find((m) => /interim strategy/i.test(m.label));
      if (t) { if (t.embedUrl && t.embedUrl !== t.url) setEmbedded(t); else window.open(t.url, "_blank", "noopener,noreferrer"); }
    } catch (e: any) { toast.error(e?.message ?? "Something went wrong. Please try again."); }
  };
  const done = rebalancing && (rebalancing.completedAt || rebalancing.acknowledgedAt);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent"><ChevronLeft className="h-3.5 w-3.5" /> Back to your portal</button>
      {!rebalancing ? (
        <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">There is no rebalancing to review right now.</div>
      ) : (
        rebalancing.view ? (
          <PortalPortfolioReview view={rebalancing.view} publishedAt={rebalancing.publishedAt} statement={rebalancing.statement} viewerId={rebalancing.viewerId} authorizedIds={rebalancing.authorizedIds} onAuthorize={authorize} onTalk={talk} authorized={rebalancing.completedAt || rebalancing.acknowledgedAt ? { at: (rebalancing.acknowledgedAt ?? rebalancing.completedAt) as string } : null} />
        ) : (
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div>
              <h3 className="font-serif text-lg font-semibold text-foreground">Your {rebalancing.label} rebalancing</h3>
              <p className="text-xs text-muted-foreground">Shared {day(rebalancing.publishedAt)}</p>
            </div>
            {rebalancing.summary && <blockquote className="whitespace-pre-line border-l-2 border-accent pl-3 text-sm text-foreground">{rebalancing.summary}<footer className="mt-1 text-xs text-muted-foreground">Rolf</footer></blockquote>}
            {done ? (
              <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p>{rebalancing.completedAt ? `Completed on ${day(rebalancing.completedAt)}.` : `You authorized this on ${day(rebalancing.acknowledgedAt!)}. I will confirm the amounts with you, carry it out, and let you know when it is done.`}</p></div>
            ) : rebalancing.proposal ? (
              <PortalProposal proposal={rebalancing.proposal} statement={rebalancing.statement} onAuthorize={authorize} onTalk={talk} />
            ) : (
              <p className="text-sm text-muted-foreground">The full proposal is in your Documents.</p>
            )}
          </CardContent>
        </Card>
        )
      )}
      {embedded && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-serif text-sm text-foreground"><span>{embedded.label}</span><button onClick={() => setEmbedded(null)} className="text-xs text-muted-foreground hover:text-accent">Close</button></div>
          <iframe src={embedded.embedUrl} style={{ border: 0 }} width="100%" height={700} title={embedded.label} />
        </div>
      )}
    </div>
  );
}
