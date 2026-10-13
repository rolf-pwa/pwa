import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, ChevronRight, Loader2, Pause, Play } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";
import { KIND_LABEL, describeReviewEvent, statusLabel, getReminderOverview, groupByQuarter, getReviewOverview, setReminderMode, setReviewMode, setReviewPaused, type ReminderOverview, type ReviewMode, type ReviewObligation, type ReviewOverview } from "@/modules/crm/lib/reviewAgent";
import { familyTitle } from "@/shared/lib/utils";

const MODES: { value: ReviewMode; label: string; blurb: string }[] = [
  { value: "off", label: "Off", blurb: "Georgia does nothing." },
  { value: "shadow", label: "Shadow", blurb: "Georgia works out who is owed which meeting and records what she would do. Nothing is sent." },
  { value: "live", label: "Live", blurb: "Georgia invites both adults on the first day of each window, reminds them, and hands a family to you when time is running out." },
];
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** Georgia's one-week and one-day meeting reminders, which replace Google's own: mode switch and what she has sent. */
function MeetingReminderCard() {
  const [data, setData] = useState<ReminderOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const load = useCallback(async () => { try { setData(await getReminderOverview()); } catch { setData(null); } }, []);
  useEffect(() => { void load(); }, [load]);
  const mode = data?.config?.mode ?? "off";
  const change = async (m: ReviewMode) => {
    setBusy(true);
    try { await setReminderMode(m, m === "live"); await load(); toast.success(`Meeting reminders are now ${m}`); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't change the mode"); }
    finally { setBusy(false); setConfirmLive(false); }
  };
  const BLURB: Record<ReviewMode, string> = {
    off: "No reminders from Georgia.",
    shadow: "Georgia records the reminders she would send. Nothing is sent. Keep Google's reminders on.",
    live: "Georgia emails each client a reminder one week and one day before a booked meeting. Turn off Google's reminders so clients don't get two.",
  };
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">Meeting reminders</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reminder mode">
          {(["off", "shadow", "live"] as ReviewMode[]).map((m) => (
            <Button key={m} role="radio" aria-checked={mode === m} variant={mode === m ? "default" : "outline"} disabled={busy || !data}
              onClick={() => (m === "live" && mode !== "live" ? setConfirmLive(true) : m !== mode && change(m))}>{m === "off" ? "Off" : m === "shadow" ? "Shadow" : "Live"}</Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{BLURB[mode]}</p>
        <p className="text-xs text-muted-foreground">Covers the meeting types marked "Georgia sends the one-week and one-day reminders" in Meeting types. A reminder is skipped if the meeting was booked too late for it to make sense.</p>
        {(data?.config?.last_unmatched ?? []).length > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Client meetings on your calendar that match no meeting type, so they get no reminder: {(data?.config?.last_unmatched ?? []).join(", ")}. Add each as a meeting type, or put its calendar title in that type's "Calendar title" box.
          </p>
        )}
        <div className="space-y-1">
          {(data?.recent ?? []).length === 0 && <p className="text-sm text-muted-foreground">No reminders yet.</p>}
          {(data?.recent ?? []).map((r) => (
            <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
              <span className="min-w-0">{r.note ? "Skipped" : r.mode === "shadow" ? "Would send" : r.email_ok === false ? "Failed to send" : "Sent"} the {r.kind === "7d" ? "one-week" : "one-day"} reminder for {r.meeting_name} to <span className="font-medium">{r.name ?? "a client"}</span> (meeting {when(r.start_time)}){r.note ? `: ${r.note}` : ""}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{when(r.created_at)}</span>
            </div>
          ))}
        </div>
      </CardContent>
      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn Georgia's meeting reminders live?</AlertDialogTitle>
            <AlertDialogDescription>Georgia will email clients a reminder one week and one day before each booked meeting of the marked types. Switch off Google's own appointment reminders at the same time, or clients will get two. You can switch back at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => change("live")}>Go live</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function ReviewAgent() {
  const [data, setData] = useState<ReviewOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention" | "notBooked" | "booked">("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
  const sections = useMemo(() => groupByQuarter(rows, new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })), [rows]);
  const matches = (o: ReviewObligation) =>
    filter === "all" ? true : filter === "attention" ? o.status === "escalated" : filter === "booked" ? o.status === "booked" || o.status === "held" : o.status === "open" || o.status === "paused";
  const isCollapsed = (key: string, past: boolean) => collapsed[key] ?? past;
  const FILTERS: { value: typeof filter; label: string }[] = [{ value: "all", label: "All" }, { value: "attention", label: "Needs a person" }, { value: "notBooked", label: "Not booked yet" }, { value: "booked", label: "Booked or done" }];

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
                {c && <p className="text-xs text-muted-foreground">Tier 1: an Annual Review in Q1 and a portfolio rebalancing, acknowledged in the portal, in Q3. Tier 2A: an Annual Review in Q2 and a rebalancing in Q4. Tier 2B: a Sovereignty Review in Q2 and another in Q4. Tier 3: Sovereignty Reviews in Q1–Q3 and a Governance Review in Q4. Invitations go out on the first day of each window, then a reminder every {c.remind_every_days} days (up to {c.max_nudges}); with {c.handoff_days_before_end} days left and nothing booked, the family comes to you. Only windows that start after {when(c.since)} are managed.</p>}
              </CardContent>
            </Card>

            <MeetingReminderCard />

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg">Meetings and rebalancing, by quarter</CardTitle>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter meetings">
                    {FILTERS.map((f) => (
                      <Button key={f.value} size="sm" role="radio" aria-checked={filter === f.value} variant={filter === f.value ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFilter(f.value)}>{f.label}</Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {sections.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Meetings appear here once their windows start after the date above.</p>}
                {sections.map((sec) => {
                  const items = sec.items.filter(matches);
                  if (filter !== "all" && items.length === 0) return null;
                  const closed = isCollapsed(sec.key, sec.isPast);
                  return (
                    <section key={sec.key} aria-label={sec.label} className={`rounded-lg border ${sec.isCurrent ? "border-accent/50" : "border-border"}`}>
                      <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [sec.key]: !closed }))} className="flex w-full items-center gap-3 px-3 py-2.5 text-left" aria-expanded={!closed}>
                        {closed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="font-serif text-base font-semibold">{sec.label}</span>
                        {sec.isCurrent && <Badge className="bg-accent text-accent-foreground">Now</Badge>}
                        <span className="hidden text-xs text-muted-foreground sm:inline">{sec.range}</span>
                        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
                          <span className="text-muted-foreground">{sec.items.length} meeting{sec.items.length === 1 ? "" : "s"}</span>
                          {sec.counts.notBooked > 0 && <span className="text-foreground">{sec.counts.notBooked} not booked</span>}
                          {sec.counts.booked > 0 && <span className="text-emerald-700">{sec.counts.booked} booked</span>}
                          {sec.counts.held > 0 && <span className="text-muted-foreground">{sec.counts.held} done</span>}
                          {sec.counts.withPerson > 0 && <span className="font-medium text-destructive">{sec.counts.withPerson} with a person</span>}
                        </span>
                      </button>
                      {!closed && (
                        <div className="border-t border-border px-3">
                          {items.length === 0 && <p className="py-3 text-sm text-muted-foreground">No meetings match this filter.</p>}
                          {items.map((o) => (
                            <div key={o.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
                              <div className="min-w-0">
                                <Link to={`/families/${o.family_id}`} className="truncate font-medium hover:underline">{familyTitle(o.family_name)}</Link>
                                <div className="text-xs text-muted-foreground">{KIND_LABEL[o.kind]} · window {day(o.window_start)} to {day(o.window_end)}{o.booked_start ? ` · booked ${when(o.booked_start)}` : ""}{o.acknowledged_at ? ` · acknowledged ${when(o.acknowledged_at)}` : ""}</div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-xs text-muted-foreground">{o.nudge_count} invitation{o.nudge_count === 1 ? "" : "s"}</span>
                                <Badge variant={o.status === "escalated" ? "destructive" : "secondary"}>{statusLabel(o)}{o.invite === false ? " (tracking only)" : ""}{o.mode === "shadow" ? " (shadow)" : ""}</Badge>
                                {(o.status === "open" || o.status === "booked" || o.status === "paused") && (
                                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={o.status === "paused" ? "Resume" : "Pause"} onClick={() => togglePause(o)}>
                                    {o.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
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
