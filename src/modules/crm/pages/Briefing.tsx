import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/shared/components/AppLayout";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { toast } from "sonner";
import { type DailyBriefing } from "../lib/briefing";
import { EaChat } from "../components/EaChat";
import { TodayTabs, useTodayLive } from "../components/TodayTabs";

const todayPacific = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date());

/** Internal routes get a router link, external addresses a new-tab anchor, and nothing to point at is plain text. */
export function SourceLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <span className="font-medium text-foreground">{children}</span>;
  if (href.startsWith("http")) return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">{children}</a>;
  return <Link to={href} className="font-medium text-accent hover:underline">{children}</Link>;
}

/** Georgia's morning briefing: the day's priorities, and everything behind them. */
export default function Briefing() {
  const { user } = useAuth();
  const [b, setB] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { live, reload: reloadLive } = useTodayLive(!!user);

  const load = useCallback(async () => {
    if (!user) return;
    // First take off whatever has been dealt with since the briefing was made (a task done, an email answered, a request replied to).
    try { await supabase.functions.invoke("daily-briefing-generate", { body: { action: "ea_refresh" } }); } catch { /* show the briefing as it was */ }
    const { data } = await supabase.from("daily_briefings").select("generation_status, generation_error, greeting, summary_line, priority_items, sections, generated_at").eq("staff_user_id", user.id).eq("briefing_date", todayPacific()).maybeSingle();
    setB(data as unknown as DailyBriefing | null);
    setLoading(false);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  /** Rolf marks one item done by hand: it comes off today's briefing, whatever it was waiting on. */
  const done = async (key: string | undefined) => {
    if (!key) return;
    try { await supabase.functions.invoke("daily-briefing-generate", { body: { action: "ea_dismiss", key } }); await Promise.all([load(), reloadLive()]); }
    catch { toast.error("Couldn't mark it done"); }
  };
  const Done = ({ k }: { k: string | undefined }) => k ? <button type="button" aria-label="Mark done" title="Mark done" className="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void done(k)}><Check className="h-3 w-3" /></button> : null;

  const regenerate = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-briefing-generate", { body: {} });
      if (error) throw error;
      setB(data.briefing as DailyBriefing);
    } catch { toast.error("Couldn't generate the briefing"); } finally { setBusy(false); }
  };

  const s = b?.sections ?? null;
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2"><Sparkles className="h-6 w-6 text-accent" /><h1 className="font-serif text-2xl font-semibold">Today</h1></div>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>{busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}{b ? "Regenerate" : "Generate now"}</Button>
        </div>

        <TodayTabs sections={s} live={live} onDone={(k) => void done(k)} aside={<EaChat onChanged={load} />} briefing={
          <div className="min-w-0 space-y-5">
        {loading && <Loader2 className="h-5 w-5 animate-spin" />}
        {!loading && !b && <Card><CardContent className="p-5 text-sm text-muted-foreground">No briefing yet today. Georgia prepares it at 5:30 a.m. Pacific; you can also generate it now.</CardContent></Card>}
        {b?.generation_status === "generating" && <p className="text-sm text-muted-foreground">Georgia is preparing the briefing…</p>}
        {b?.generation_status === "error" && <p className="text-sm text-destructive">Couldn't generate today's briefing: {b.generation_error}</p>}

        {b?.generation_status === "complete" && (
          <>
            <Card className="border-accent/40" style={{ background: "hsl(var(--pw-sand) / 0.3)" }}>
              <CardContent className="space-y-3 p-5">
                <div>
                  <h2 className="font-serif text-lg font-semibold">{b.greeting}</h2>
                  <p className="text-sm text-muted-foreground">{b.summary_line}</p>
                </div>
                {(s?.handled?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground" data-testid="progress">{b.priority_items.length} still open · {s!.handled!.length} handled since this morning</p>}
                {b.priority_items.length === 0 && (s?.handled?.length ?? 0) > 0 && <p className="text-sm font-medium text-green-700">Everything in this morning's priorities has been handled.</p>}
                {b.priority_items.length > 0 && (
                  <ol className="space-y-2.5" data-testid="priorities">
                    {b.priority_items.map((it, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{i + 1}</span>
                        <div className="min-w-0">
                          <SourceLink href={it.link}>{it.label}</SourceLink><Done k={it.key} />
                          {it.reason && <span className="text-muted-foreground"> — {it.reason}</span>}
                          {it.next_step && <p className="text-xs text-foreground/80">Suggested: {it.next_step}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            {s && (s.handled?.length ?? 0) > 0 && (
              <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Handled since this morning ({s.handled!.length})</summary>
                <ul className="mt-1.5 space-y-0.5 pl-4 text-xs text-muted-foreground">{s.handled!.map((h, i) => <li key={i} className="list-disc">{h.label}</li>)}</ul>
              </details>
            )}

            {s && (s.counts.spam > 0 || s.counts.promo > 0 || (s.counts.automated ?? 0) > 0) && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Left out: {s.counts.spam} likely spam, {s.counts.promo} newsletters and promotions, {s.counts.automated ?? 0} automated notices{s.counts.muted ? `, and ${s.counts.muted} from senders you asked me to stop showing` : ""}. Nothing was deleted.</p>
            )}
            {b.generated_at && <p className="text-[11px] text-muted-foreground">Prepared {new Date(b.generated_at).toLocaleString("en-CA", { timeZone: "America/Vancouver", weekday: "short", hour: "numeric", minute: "2-digit" })} Pacific. Georgia only reads; she has not sent or changed anything.</p>}
          </>
        )}
          </div>
        } />
      </div>
    </AppLayout>
  );
}
