import { useEffect } from "react";
import { ArrowRight, ChevronLeft, LineChart } from "lucide-react";
import { PortalPortfolioReview } from "./PortalPortfolioReview";
import { Button } from "@/shared/components/ui/button";
import type { ClientView } from "../../../../supabase/functions/_shared/portfolio-review-client";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const seenKey = (id: string) => `pw-review-seen:${id}`;
export const reviewSeen = (id: string) => { try { return localStorage.getItem(seenKey(id)) === "1"; } catch { return false; } };
export const markReviewSeen = (id: string) => { try { localStorage.setItem(seenKey(id), "1"); } catch { /* it just shows as new again */ } };

/**
 * The dashboard's pointer to the Portfolio Review: one highlighted container in the main column, so the dashboard stays clean. The review
 * itself lives on its own page.
 */
export function PortalReviewTeaser({ id, view, publishedAt, onOpen }: { id: string; view: ClientView; publishedAt: string; onOpen: () => void }) {
  const isNew = !reviewSeen(id);
  const up = (view.summary.ytdPct ?? 0) >= 0;
  return (
    <div className="overflow-hidden rounded-lg border border-accent/40 shadow-sm" style={{ background: "hsl(var(--pw-sand) / 0.35)" }} data-testid="review-teaser">
      <div className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-accent px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <LineChart className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-base font-semibold text-foreground">Your Portfolio Review is ready</h3>
              {isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">New</span>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">Prepared by Rolf for {view.householdLabel} · shared {day(publishedAt)}</p>
            <p className="mt-1 text-sm text-foreground">{money(view.summary.value)} <span className="text-muted-foreground">· {up ? "up" : "down"} {Math.abs(view.summary.ytdPct ?? 0).toFixed(1)}% this year</span></p>
          </div>
        </div>
        <Button onClick={onOpen} className="gap-1.5">View your review <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

/** The Portfolio Review's own page: a way back, then the review. Opening it clears the "New" badge. */
export function PortalReviewPage({ review, onBack }: { review: { id: string; view: ClientView; publishedAt: string } | null; onBack: () => void }) {
  useEffect(() => { if (review) markReviewSeen(review.id); }, [review]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent"><ChevronLeft className="h-3.5 w-3.5" /> Back to your portal</button>
      {review ? <PortalPortfolioReview view={review.view} publishedAt={review.publishedAt} /> : <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">There is no Portfolio Review to show right now.</div>}
    </div>
  );
}
