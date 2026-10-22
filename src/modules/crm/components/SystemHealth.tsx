import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { supabase } from "@/shared/integrations/supabase/client";

interface Job { key: string; label: string; status: "ok" | "late" | "failing" | "waiting"; lastFinished: string | null; minutesAgo: number | null; detail: string | null }
interface Check { label: string; status: "ok" | "warn" | "bad"; detail: string }
interface Health { jobs: Job[]; checks: Check[]; errors: { created_at: string; function_name: string; severity: string; error_message: string | null }[]; problems: number }

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/daily-briefing-generate`;
async function fetchHealth(): Promise<Health> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}`, "x-region": "ca-central-1" }, body: JSON.stringify({ action: "ea_health" }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as Health;
}

const JOB_BADGE: Record<Job["status"], { text: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { text: "Running", variant: "secondary" }, waiting: { text: "Not yet run", variant: "outline" }, late: { text: "Stopped", variant: "destructive" }, failing: { text: "Failing", variant: "destructive" },
};

/** Is everything Georgia depends on working: each scheduled job, her connections, and any recent errors. Failures also alert Rolf in the app. */
export function SystemHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setErr(null); setH(await fetchHealth()); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load"); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">System health</CardTitle>
          {h && (h.problems === 0 ? <Badge variant="secondary" className="text-[10px]"><CheckCircle2 className="mr-1 h-3 w-3" />All good</Badge> : <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="mr-1 h-3 w-3" />{h.problems} to look at</Badge>)}
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" disabled={busy} onClick={() => void load()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check now"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {err && <p className="text-destructive">{err}</p>}
        {!h && !err && <Loader2 className="h-4 w-4 animate-spin" />}
        {h && (
          <>
            <p className="text-xs text-muted-foreground">Each job below runs on a schedule. If one stops or keeps failing, Georgia tells you in the app within about an hour.</p>
            <ul className="space-y-1" data-testid="jobs">
              {h.jobs.map((j) => (
                <li key={j.key} className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-1 last:border-0">
                  <span className="font-medium">{j.label}</span>
                  <Badge variant={JOB_BADGE[j.status].variant} className="text-[10px]">{JOB_BADGE[j.status].text}</Badge>
                  <span className="text-xs text-muted-foreground">{j.lastFinished ? `last finished ${formatDistanceToNow(new Date(j.lastFinished), { addSuffix: true })}` : "no run recorded yet"}</span>
                  {(j.status === "late" || j.status === "failing") && j.detail && <span className="w-full text-xs text-destructive">{j.detail}</span>}
                </li>
              ))}
            </ul>
            <ul className="space-y-1" data-testid="checks">
              {h.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  {c.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" /> : c.status === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                  <p><span className="font-medium">{c.label}.</span> <span className="text-muted-foreground">{c.detail}</span></p>
                </li>
              ))}
            </ul>
            {h.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">Recent errors ({h.errors.length})</summary>
                <ul className="mt-1 space-y-1 text-xs">{h.errors.map((e, i) => <li key={i}><span className="font-medium">{e.function_name}</span> {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}: {(e.error_message ?? "").slice(0, 160)}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
