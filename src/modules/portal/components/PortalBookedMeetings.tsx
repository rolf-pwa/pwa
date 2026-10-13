import { CalendarCheck } from "lucide-react";

export interface BookedMeeting { label: string; start: string }

/** A line for each review meeting that is already booked, shown in place of its booking link. */
export function PortalBookedMeetings({ items, className = "" }: { items: BookedMeeting[]; className?: string }) {
  if (!items.length) return null;
  const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className={`space-y-1.5 ${className}`}>
      {items.map((b) => (
        <div key={`${b.label}-${b.start}`} className="flex items-start gap-2 rounded-md bg-accent/10 px-2.5 py-2 text-xs text-foreground">
          <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span><span className="font-medium">{b.label}</span> is booked for {when(b.start).replace(/\.?$/, ".")}</span>
        </div>
      ))}
    </div>
  );
}
