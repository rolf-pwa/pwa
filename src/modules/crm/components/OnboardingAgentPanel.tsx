import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bot, Loader2, Pause, Play } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { CASE_STATUS_LABEL, describeEvent, getHouseholdCase, setCasePaused, type AgentCase, type AgentEvent, type AgentMode } from "@/modules/crm/lib/onboardingAgent";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Georgia's onboarding work for one household: where the case stands, what she has done, and a pause switch. */
export function OnboardingAgentPanel({ householdId }: { householdId: string }) {
  const [state, setState] = useState<{ mode: AgentMode; cases: AgentCase[]; events: AgentEvent[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setState(await getHouseholdCase(householdId)); } catch { setState(null); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  if (!state || (state.cases.length === 0 && state.events.length === 0)) return null;
  // The case for the mode that is running now, or the most recent one.
  const current = state.cases.find((c) => c.mode === (state.mode === "off" ? "live" : state.mode)) ?? state.cases[0];

  const toggle = async () => {
    if (!current) return;
    setBusy(true);
    try { await setCasePaused(current.id, current.status !== "paused"); await load(); toast.success(current.status === "paused" ? "Georgia resumed" : "Georgia paused"); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't update"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Bot className="h-5 w-5 text-accent" /> Georgia's onboarding</CardTitle>
        <div className="flex items-center gap-2">
          {current && <Badge variant="secondary">{CASE_STATUS_LABEL[current.status]}{current.mode === "shadow" ? " (shadow)" : ""}</Badge>}
          {current && (current.status === "active" || current.status === "paused") && (
            <Button size="sm" variant="outline" onClick={toggle} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : current.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {current.status === "paused" ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {current && <p className="text-xs text-muted-foreground">Reminders sent: {current.nudge_count}. <Link to="/onboarding-agent" className="underline">All onboarding</Link></p>}
        {state.events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : state.events.slice(0, 8).map((e) => (
          <div key={e.id} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
            <span className="min-w-0">{describeEvent(e)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{when(e.created_at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
