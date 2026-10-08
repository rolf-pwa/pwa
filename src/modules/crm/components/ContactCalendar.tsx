import { useMemo, useState } from "react";
import { useCalendarEvents, useGoogleStatus } from "@/shared/hooks/useGoogle";
import { format } from "date-fns";
import { eventsWithContact, splitMeetings, type CalEvent } from "../lib/meetings";

interface ContactCalendarProps {
  contactEmail: string | null;
  contactName?: string;
}

const PREVIOUS_SHOWN = 5;

function EventRow({ event }: { event: CalEvent }) {
  const start = event.start?.dateTime || event.start?.date;
  const parsed = start ? new Date(event.start?.dateTime ? start : `${start}T00:00:00`) : null;
  const ok = parsed && !isNaN(parsed.getTime());
  return (
    <li>
      <a
        href={event.htmlLink || (ok ? `https://calendar.google.com/calendar/r/day/${format(parsed!, "yyyy/MM/dd")}` : "https://calendar.google.com")}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 rounded-md py-1.5 transition-colors hover:bg-muted/50"
      >
        {ok && (
          <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-primary">
            <span className="text-[10px] font-medium uppercase leading-none">{format(parsed!, "MMM")}</span>
            <span className="text-sm font-bold leading-tight">{format(parsed!, "d")}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{event.summary || "(No title)"}</p>
          {ok && <p className="text-xs text-muted-foreground">{format(parsed!, event.start?.dateTime ? "EEEE, MMM d, yyyy · h:mm a" : "EEEE, MMM d, yyyy")}</p>}
        </div>
      </a>
    </li>
  );
}

/** Meetings with this contact, from the connected Google Calendar: what is coming up, and the past year. */
export function ContactCalendar({ contactEmail }: ContactCalendarProps) {
  const { data: status } = useGoogleStatus();
  const [showAllPrevious, setShowAllPrevious] = useState(false);
  const { yearAgo, sixMonthsOut } = useMemo(() => ({
    yearAgo: new Date(Date.now() - 365 * 86400000).toISOString(),
    sixMonthsOut: new Date(Date.now() + 180 * 86400000).toISOString(),
  }), []);
  // Google filters by the contact's email, so a busy calendar doesn't push their meetings out of the result.
  const { data, isLoading, error } = useCalendarEvents(yearAgo, sixMonthsOut, Boolean(status?.connected && contactEmail), { q: contactEmail ?? undefined, maxResults: 250 });

  if (!contactEmail) return <p className="px-2 pb-2 text-sm text-muted-foreground">No email address on file.</p>;
  if (!status?.connected) return <p className="px-2 pb-2 text-sm text-muted-foreground">Connect Google on the Dashboard to see meetings.</p>;
  if (isLoading) return <p className="animate-pulse px-2 pb-2 text-sm text-muted-foreground">Loading meetings…</p>;
  if (error) return <p className="px-2 pb-2 text-sm text-destructive">Failed to load meetings.</p>;

  const { upcoming, previous } = splitMeetings(eventsWithContact(((data as { items?: CalEvent[] })?.items) ?? [], contactEmail));
  const shownPrevious = showAllPrevious ? previous : previous.slice(0, PREVIOUS_SHOWN);

  return (
    <div className="space-y-4 px-2 pb-2">
      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h4>
        {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming meetings.</p> : <ul>{upcoming.slice(0, 10).map((e) => <EventRow key={e.id} event={e} />)}</ul>}
      </section>
      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous · last 12 months</h4>
        {previous.length === 0 ? <p className="text-sm text-muted-foreground">No meetings in the past year.</p> : (
          <>
            <ul>{shownPrevious.map((e) => <EventRow key={e.id} event={e} />)}</ul>
            {previous.length > PREVIOUS_SHOWN && (
              <button className="mt-1 text-xs text-muted-foreground underline" onClick={() => setShowAllPrevious((v) => !v)}>
                {showAllPrevious ? "Show fewer" : `Show all ${previous.length}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
