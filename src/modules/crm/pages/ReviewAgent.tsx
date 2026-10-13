import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, Loader2, Pause, Play } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";
import { KIND_LABEL, STATUS_LABEL, describeReviewEvent, getReviewOverview, setReviewMode, setReviewPaused, type ReviewMode, type ReviewObligation, type ReviewOverview } from "@/modules/crm/lib/reviewAgent";
import { familyTitle } from "@/shared/lib/utils";

const MODES: { value: ReviewMode; label: string; blurb: string }[] = [
  { value: "off", label: "Off", blurb: "Georgia does nothing." },
  { value: "shadow", label: "Shadow", blurb: "Georgia works out who is owed which meeting and records what she would do. Nothing is sent." },
  { value: "live", label: "Live", blurb: "Georgia invites both adults on the first day of each window, reminds them, and hands a family to you when time is running out." },
];
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export default function ReviewAgent() {
  const [data, setData] = useState<ReviewOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getReviewOverview()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = async (mode: ReviewMode) => {
    setBusy(true);
    try { await setReviewMode(mode, mode === "live"); await load(); toast.success(`Georgia's review windows are now ${mode}`); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't change the mode"); }
    finally { setBusy(false); setConfirmLive(false); }
  };
  const togglePause = async (o: ReviewObligation) => {
    try { await setReviewPaused(o.id, o.status !== "paused"); await load(); } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); }
  };

  const mode = data?.config?.mode ?? "off";
  const c = data?.config;
  // Show the obligations for the mode that is running, soonest window first.
  const rows = useMemo(() => (data?.obligations ?? []).filter((o) => o.mode === (mode === "off" ? "live" : mode) && o.status !== "cancelled"), [data, mode]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <div className="flex items-center gap-2"><CalendarClock className="h-6 w-6 text-accent" /><h1 className="font-serif text-2xl font-semibold">Georgia's review windows</h1></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {data && (
          <>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Mode</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mode">
                  {MODES.map((m) => (
                    <Button key={m.value} role="radio" aria-checked={mode === m.value} variant={mode === m.value ? "default" : "outline"} disabled={busy}
                      onClick={() => (m.value === "live" && mode !== "live" ? setConfirmLive(true) : m.value !== mode && change(m.value))}>{m.label}</Button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{MODES.find((m) => m.value === mode)?.blurb}</p>
                {c && <p className="text-xs text-muted-foreground">Tier 1 and 2A: one Annual Review in Q1. Tier 2B: a Sovereignty Review in Jan–Jun and another in Jul–Dec. Tier 3: Sovereignty Reviews in Q1–Q3 and a Governance Review in Q4. Invitations go out on the first day of each window, then a reminder every {c.remind_every_days} days (up to {c.max_nudges}); with {c.handoff_days_before_end} days left and nothing booked, the family comes to you. Only windows that start after {when(c.since)} are managed.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Meetings owed</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Windows appear here once they start after the date above.</p>}
                {rows.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <Link to={`/families/${o.family_id}`} className="truncate font-medium hover:underline">{familyTitle(o.family_name)}</Link>
                      <div className="text-xs text-muted-foreground">{KIND_LABEL[o.kind]} · {day(o.window_start)} to {day(o.window_end)}{o.booked_start ? ` · booked ${when(o.booked_start)}` : ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{o.nudge_count} invitation{o.nudge_count === 1 ? "" : "s"}</span>
                      <Badge variant={o.status === "escalated" ? "destructive" : "secondary"}>{STATUS_LABEL[o.status]}{o.mode === "shadow" ? " (shadow)" : ""}</Badge>
                      {(o.status === "open" || o.status === "booked" || o.status === "paused") && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={o.status === "paused" ? "Resume" : "Pause"} onClick={() => togglePause(o)}>
                          {o.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Recent activity</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {data.events.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
                {data.events.map((e) => (
                  <div key={e.id} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
                    <span className="min-w-0">{e.family_name ? <span className="font-medium">{familyTitle(e.family_name)}: </span> : null}{describeReviewEvent(e)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{when(e.created_at)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn Georgia's review windows live?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on, Georgia will email both adults in each family on the first day of every meeting window that starts after this moment, with no staff review of each email. She only invites them to book in the portal, and hands the family to you if time runs out. Windows already under way are not touched. You can switch back to Shadow or Off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => change("live")}>Go live</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
