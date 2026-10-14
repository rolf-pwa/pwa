import { useEffect, useState } from "react";
import { ArrowRight, CalendarCheck, ChevronLeft, LineChart } from "lucide-react";
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
            <p className="mt-0.5 text-sm text-muted-foreground">Prepared for {view.householdLabel} · shared {day(publishedAt)}</p>
            <p className="mt-1 text-sm text-foreground">{money(view.summary.value)} <span className="text-muted-foreground">· {up ? "up" : "down"} {Math.abs(view.summary.ytdPct ?? 0).toFixed(1)}% this year</span></p>
          </div>
        </div>
        <Button onClick={onOpen} className="gap-1.5">View your review <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export interface ReviewMeetingType { label: string; url: string; embedUrl?: string }
export interface ReviewBooked { label: string; start: string }
const whenLong = (iso: string) => new Date(iso).toLocaleString("en-CA", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The Portfolio Review's own page: a way back, the review, and at the bottom a button to book the meeting to talk it through. Booking
 * opens the scheduler right here when it can be embedded. If the meeting is already booked it says when instead. Opening the page
 * clears the "New" badge.
 */
export function PortalReviewPage({ review, onBack, meetingTypes = [], booked = [] }: { review: { id: string; view: ClientView; publishedAt: string } | null; onBack: () => void; meetingTypes?: ReviewMeetingType[]; booked?: ReviewBooked[] }) {
  useEffect(() => { if (review) markReviewSeen(review.id); }, [review]);
  const [embedded, setEmbedded] = useState<ReviewMeetingType | null>(null);
  const already = booked.find((b) => /portfolio review/i.test(b.label));
  // The Portfolio Review meeting when it can be booked now; otherwise an Interim Strategy Session, so there is always a way to book.
  const type = meetingTypes.find((t) => /portfolio review/i.test(t.label)) ?? meetingTypes.find((t) => /interim strategy/i.test(t.label)) ?? null;
  const open = () => {
    if (!type) return;
    if (type.embedUrl && type.embedUrl !== type.url) setEmbedded(type); else window.open(type.url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent"><ChevronLeft className="h-3.5 w-3.5" /> Back to your portal</button>
      {review ? <PortalPortfolioReview view={review.view} publishedAt={review.publishedAt} /> : <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">There is no Portfolio Review to show right now.</div>}
      {review && (
        <div className="rounded-lg border border-accent/40 p-5 text-center" style={{ background: "hsl(var(--pw-sand) / 0.35)" }} data-testid="review-booking">
          {already ? (
            <>
              <p className="font-serif text-base font-semibold text-foreground">Your meeting is booked</p>
              <p className="mt-1 text-sm text-muted-foreground">{already.label}: {whenLong(already.start)}. I look forward to talking it through with you.</p>
            </>
          ) : type ? (
            <>
              <p className="font-serif text-base font-semibold text-foreground">Let's talk it through</p>
              <p className="mt-1 text-sm text-muted-foreground">Book a time and I will walk you through your review and answer your questions.</p>
              <Button className="mt-3 gap-1.5" onClick={open}><CalendarCheck className="h-4 w-4" /> Book your meeting</Button>
            </>
          ) : (
            <>
              <p className="font-serif text-base font-semibold text-foreground">Let's talk it through</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask Georgia to find a time, or reply to her email, and I will walk you through your review.</p>
            </>
          )}
        </div>
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
