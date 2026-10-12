import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bot, Loader2 } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";
import { CASE_STATUS_LABEL, describeEvent, getOverview, setMode, type AgentMode, type AgentOverview } from "@/modules/crm/lib/onboardingAgent";

const MODES: { value: AgentMode; label: string; blurb: string }[] = [
  { value: "off", label: "Off", blurb: "Georgia does nothing." },
  { value: "shadow", label: "Shadow", blurb: "Georgia decides and records what she would do. Nothing is sent." },
  { value: "live", label: "Live", blurb: "Georgia emails new clients, retries a failed Vault and hands cases to a person." },
];
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function OnboardingAgent() {
  const [data, setData] = useState<AgentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getOverview()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = async (mode: AgentMode) => {
    setBusy(true);
    try { await setMode(mode, mode === "live"); await load(); toast.success(`Georgia is now ${mode}`); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't change the mode"); }
    finally { setBusy(false); setConfirmLive(false); }
  };

  const mode = data?.config?.mode ?? "off";
  const c = data?.config;
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 py-6">
        <div className="flex items-center gap-2"><Bot className="h-6 w-6 text-accent" /><h1 className="font-serif text-2xl font-semibold">Georgia's onboarding</h1></div>
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
                {c && <p className="text-xs text-muted-foreground">Complete = Survey Session booked and documents received. Up to {c.max_nudges} reminders (first after {c.first_nudge_hours} h, then every {c.min_gap_hours} h), {c.weekdays_only ? "weekdays" : "any day"} {c.send_start_hour}:00 to {c.send_end_hour}:00 Pacific. Only households enrolled after {when(c.since)} are managed.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Households</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {data.cases.length === 0 && <p className="text-sm text-muted-foreground">No households yet. New paid clients appear here.</p>}
                {data.cases.map((k) => (
                  <div key={k.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
                    <Link to={`/households/${k.household_id}`} className="min-w-0 truncate font-medium hover:underline">{k.household_label ?? "Household"}</Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{k.nudge_count} reminder{k.nudge_count === 1 ? "" : "s"}</span>
                      <Badge variant={k.status === "escalated" ? "destructive" : "secondary"}>{CASE_STATUS_LABEL[k.status]}{k.mode === "shadow" ? " (shadow)" : ""}</Badge>
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
                    <span className="min-w-0">{e.household_label ? <span className="font-medium">{e.household_label}: </span> : null}{describeEvent(e)}</span>
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
            <AlertDialogTitle>Turn Georgia live?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on, Georgia will email clients who enrol after this moment, without a staff review. She only nudges the next step, and hands a case to a person when something needs one. Existing clients are not affected. You can switch back to Shadow or Off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => change("live")}>Go live</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
