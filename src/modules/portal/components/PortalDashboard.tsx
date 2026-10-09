import { format, parseISO } from "date-fns";
import { Calendar, CheckSquare, MessageSquare } from "lucide-react";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

interface Props {
  totals: { assets: number; liabilities: number } | null;
  meetings: any[];
  requests: { id: string; status: string; subject?: string | null; title?: string | null }[];
  taskCounts: { newCount: number; ongoingCount: number };
  onGo: (tab: string) => void;
  /** Ask Georgia and the household overview, shown beside the summary. */
  sidebar?: React.ReactNode;
}

const startOf = (e: any): Date | null => (e?.start?.dateTime ? parseISO(e.start.dateTime) : e?.start?.date ? parseISO(e.start.date) : null);

/** A client's landing page: where they stand, what is coming up, and what needs them. Summary only; detail lives in the other tabs. */
export function PortalDashboard({ totals, meetings, requests, taskCounts, onGo, sidebar }: Props) {
  const now = new Date();
  const next = (meetings ?? [])
    .filter((e) => e.status !== "cancelled" && (startOf(e)?.getTime() ?? 0) >= now.getTime())
    .sort((a, b) => (startOf(a)!.getTime() - startOf(b)!.getTime()))[0];
  const nextStart = next ? startOf(next) : null;
  const open = requests.filter((r) => r.status !== "resolved");
  const actions = taskCounts.newCount + taskCounts.ongoingCount;

  const Tile = ({ icon, title, value, note, to }: { icon: React.ReactNode; title: string; value: string; note?: string; to: string }) => (
    <button onClick={() => onGo(to)} className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-accent/40">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{title}</div>
      <p className="font-serif text-lg font-semibold text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </button>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <div className="min-w-0 space-y-4">
      {totals && (
        <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-card px-5 py-4">
          {([["Total Assets", totals.assets, ""], ["Liabilities", totals.liabilities, "text-destructive"], ["Net Worth", totals.assets - totals.liabilities, ""]] as const).map(([label, value, tone]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`font-serif text-xl font-semibold tabular-nums ${tone}`}>{money(value)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon={<Calendar className="h-3.5 w-3.5" />} title="Next meeting" to="meetings"
          value={next ? next.summary || "Meeting" : "None scheduled"}
          note={nextStart ? format(nextStart, next.start?.dateTime ? "EEEE, MMM d · h:mm a" : "EEEE, MMM d") : "Book one from the Meetings tab"} />
        <Tile icon={<CheckSquare className="h-3.5 w-3.5" />} title="Action items" to="tasks"
          value={actions === 0 ? "All caught up" : `${actions} open`}
          note={taskCounts.newCount > 0 ? `${taskCounts.newCount} new` : undefined} />
        <Tile icon={<MessageSquare className="h-3.5 w-3.5" />} title="Requests" to="tasks"
          value={open.length === 0 ? "None open" : `${open.length} open`}
          note={open[0] ? open[0].subject || open[0].title || undefined : undefined} />
      </div>
    </div>
    {sidebar && <div className="min-w-0 space-y-4">{sidebar}</div>}
    </div>
  );
}
