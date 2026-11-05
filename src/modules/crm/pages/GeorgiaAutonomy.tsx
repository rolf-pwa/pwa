import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/AppLayout";
import { PageBreadcrumbs } from "@/shared/components/PageBreadcrumbs";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { CATEGORIES, CATEGORY_LABEL, MODES_AVAILABLE, MODE_LABEL, READY_MIN_RATE, READY_MIN_REVIEWED, readyToGraduate, tally, type Category, type Mode } from "@/modules/crm/lib/georgiaAutonomy";

interface Action {
  id: string; created_at: string; category: string; summary: string; request_id: string | null;
  detail: { wouldBe?: string; blocked?: string[]; ambiguous?: boolean; verdict?: "right" | "wrong" | null; decision?: { reason?: string } } | null;
  portal_requests: { request_description: string | null; request_type: string | null } | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function GeorgiaAutonomy() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [modes, setModes] = useState<Partial<Record<Category, Mode>>>({});
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, c, a] = await Promise.all([
      supabase.from("georgia_autonomy_master" as never).select("enabled").eq("id", true).maybeSingle(),
      supabase.from("georgia_autonomy_config" as never).select("category, mode"),
      supabase.from("georgia_actions" as never).select("id, created_at, category, summary, request_id, detail, portal_requests(request_description, request_type)").eq("kind", "handed_over").order("created_at", { ascending: false }).limit(100),
    ]);
    const err = (m as { error?: { message: string } }).error || (c as { error?: { message: string } }).error || (a as { error?: { message: string } }).error;
    if (err) setError(err.message); else setError(null);
    setEnabled(!!(m.data as { enabled?: boolean } | null)?.enabled);
    const next: Partial<Record<Category, Mode>> = {};
    for (const r of ((c.data ?? []) as unknown as { category: Category; mode: Mode }[])) next[r.category] = r.mode;
    setModes(next);
    setActions((a.data ?? []) as unknown as Action[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stamp = { updated_at: new Date().toISOString(), updated_by: user?.email ?? null };
  const setMaster = async (on: boolean) => {
    const { error: err } = await supabase.from("georgia_autonomy_master" as never).update({ enabled: on, ...stamp } as never).eq("id", true);
    if (err) { toast.error(err.message); return; }
    setEnabled(on);
    toast.success(on ? "Georgia will now record what she would do with each request" : "Georgia's portal autonomy is off");
  };
  const setMode = async (category: Category, mode: Mode) => {
    const { error: err } = await supabase.from("georgia_autonomy_config" as never).update({ mode, ...stamp } as never).eq("category", category);
    if (err) { toast.error(err.message); return; }
    setModes((p) => ({ ...p, [category]: mode }));
  };
  const verdict = async (a: Action, v: "right" | "wrong") => {
    const next = { ...(a.detail ?? {}), verdict: a.detail?.verdict === v ? null : v, verdict_by: user?.email ?? null, verdict_at: new Date().toISOString() };
    const { error: err } = await supabase.from("georgia_actions" as never).update({ detail: next } as never).eq("id", a.id);
    if (err) { toast.error(err.message); return; }
    setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, detail: next as Action["detail"] } : x)));
  };

  const rows = useMemo(() => tally(actions.map((a) => ({ category: a.category, verdict: a.detail?.verdict ?? null, wouldBe: a.detail?.wouldBe ?? null }))), [actions]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageBreadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Georgia autonomy" }]} />
        <div>
          <h1 className="font-display text-2xl">Georgia autonomy</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Georgia sorting the portal requests she could handle without a task. In shadow mode she only records what she would have done: every request still becomes a task for you, exactly as now, and the client sees nothing different. Review her calls here with Right or Wrong; a category moves on only once it has been right almost every time.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading</div>}
        {!loading && (
          <>
            <Card>
              <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">Record what Georgia would do</p>
                    <p className="text-sm text-muted-foreground">The master switch. While it is off nothing is recorded and nothing changes.</p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => void setMaster(v)} aria-label="Master switch" data-testid="master-switch" />
                </div>
                <div className="divide-y divide-border border-t border-border">
                  {CATEGORIES.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="text-sm">{CATEGORY_LABEL[c]}</span>
                      <Select value={modes[c] ?? "off"} onValueChange={(v) => void setMode(c, v as Mode)}>
                        <SelectTrigger className="w-52" data-testid={`mode-${c}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["off", "shadow", "draft", "auto"] as Mode[]).map((m) => <SelectItem key={m} value={m} disabled={!MODES_AVAILABLE.includes(m)}>{MODE_LABEL[m]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Money movement, banking details on investment accounts, beneficiaries, ownership, advice, urgent matters, data requests, another person's account and name changes always go to you, whatever is set here.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>How she is doing</CardTitle></CardHeader>
              <CardContent>
                {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet. Requests appear here once the switch is on and a client submits one.</p> : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground"><tr><th className="py-1 font-normal">Category</th><th className="text-right font-normal">Seen</th><th className="text-right font-normal">Right</th><th className="text-right font-normal">Wrong</th><th className="text-right font-normal">To review</th><th className="text-right font-normal">Right rate</th></tr></thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.category} className="border-t border-border" data-testid={`tally-${t.category}`}>
                          <td className="py-1.5">{t.category === "none" ? "Not a kind she handles, or Rolf's by rule" : CATEGORY_LABEL[t.category as Category] ?? t.category}</td>
                          <td className="text-right tabular-nums">{t.total}</td><td className="text-right tabular-nums">{t.right}</td><td className="text-right tabular-nums">{t.wrong}</td><td className="text-right tabular-nums">{t.unreviewed}</td>
                          <td className="text-right tabular-nums">{t.rightRate === null ? "" : pct(t.rightRate)}{readyToGraduate(t) && <Badge className="ml-2" variant="secondary">Ready</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-muted-foreground">A category is ready to move on at {READY_MIN_REVIEWED} reviewed and {pct(READY_MIN_RATE)} right.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recent requests</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {actions.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
                {actions.map((a) => (
                  <div key={a.id} className="rounded-md border border-border p-3 text-sm" data-testid="shadow-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{a.category === "none" ? "Rolf's" : a.category}</Badge>
                      <span className="text-muted-foreground">{a.summary}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                    {a.portal_requests?.request_description && <p className="mt-1.5">"{a.portal_requests.request_description.slice(0, 220)}"</p>}
                    {a.detail?.decision?.reason && <p className="mt-1 text-xs text-muted-foreground">{a.detail.decision.reason}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant={a.detail?.verdict === "right" ? "default" : "outline"} onClick={() => void verdict(a, "right")} data-testid="verdict-right">Right</Button>
                      <Button size="sm" variant={a.detail?.verdict === "wrong" ? "destructive" : "outline"} onClick={() => void verdict(a, "wrong")} data-testid="verdict-wrong">Wrong</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
