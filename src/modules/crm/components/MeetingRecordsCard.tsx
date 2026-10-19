import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { BACKFILL_SINCE, createRecords, getRecordCandidates, type RecordCandidate } from "@/modules/crm/lib/meetingRecords";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "");

/** One-time backfill: choose completed follow-ups since September and file their meeting records in Advisor Files. */
export function MeetingRecordsCard() {
  const [items, setItems] = useState<RecordCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const c = await getRecordCandidates();
      setItems(c);
      setPicked(new Set(c.filter((x) => x.suggested && !x.has_record).map((x) => x.id)));
      setLog([]);
      setOpen(true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't load the tasks"); } finally { setBusy(false); }
  };

  const run = async () => {
    const ids = [...picked];
    setBusy(true);
    const lines: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += 3) {
        const results = await createRecords(ids.slice(i, i + 3));
        for (const r of results) {
          const t = items?.find((x) => x.id === r.id);
          lines.push(`${t?.client ?? ""} ${t?.title ?? r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
        }
        setLog([...lines]);
      }
      toast.success("Done. The records are in each household's Advisor Files > Meeting Notes.");
      setPicked(new Set());
      setItems(await getRecordCandidates());
    } catch (e) { toast.error(e instanceof Error ? e.message : "The filing stopped"); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-left">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<CardTitle className="text-lg">Meeting records, since {BACKFILL_SINCE}</CardTitle>
          </button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={load}>{items ? "Reload" : "Find completed follow-ups"}</Button>
            {items && picked.size > 0 && <Button size="sm" disabled={busy} onClick={run}>{busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}File {picked.size} record{picked.size === 1 ? "" : "s"}</Button>}
          </div>
        </div>
      </CardHeader>
      {open && items && (
        <CardContent className="p-0">
          <p className="px-4 pb-2 text-xs text-muted-foreground">Tick the completed tasks that were meeting follow-ups. Each gets a record (event, date, time, attendees, recap, tasks, comment thread) filed in the household's Advisor Files &gt; Meeting Notes. Nothing in Drive is changed or deleted.</p>
          {items.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">No completed tasks since {BACKFILL_SINCE}.</p>}
          {items.map((t) => (
            <label key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-0">
              <Checkbox checked={picked.has(t.id)} disabled={busy} onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(t.id); else n.delete(t.id); return n; })} aria-label={`Select ${t.title}`} />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{t.client ?? "No client"}</span> · {t.title}</span>
              <span className="text-xs text-muted-foreground">{t.subtasks} action{t.subtasks === 1 ? "" : "s"}, {t.comments} comment{t.comments === 1 ? "" : "s"} · {when(t.completed_at)}</span>
              {t.has_record && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Filed</span>}
            </label>
          ))}
          {log.length > 0 && <div className="space-y-0.5 px-4 py-3 text-xs text-muted-foreground">{log.map((l, i) => <p key={i}>{l}</p>)}</div>}
        </CardContent>
      )}
    </Card>
  );
}
