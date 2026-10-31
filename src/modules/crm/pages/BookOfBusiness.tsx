import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/AppLayout";
import { ListRowStatic } from "@/shared/components/ListRow";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { earliestDue, orderHouseholds, orderOpps } from "@/modules/crm/lib/bookOfBusiness";

type Confidence = "high" | "medium" | "low";
type Status = "open" | "snoozed" | "accepted" | "dismissed" | "converted" | "resolved";
interface Opportunity {
  id: string; household_id: string; type: string; key: string; title: string; evidence: { label: string; value: string }[];
  confidence: Confidence; next_step: string | null; status: Status; snoozed_until: string | null; dismissed_reason: string | null; first_seen: string; due_on: string | null;
}
interface Gap { field: string; why: string; blocks: string[] }
interface HouseholdRun { householdId: string; label: string; tier: string | null; groupedAum: number; householdAum: number; pooled: boolean; familyName: string | null; familyAum: number | null; completeness: number | null; gaps: Gap[]; error: string | null }
interface Run {
  id: string; started_at: string; finished_at: string | null;
  summary: {
    households: number; averageCompleteness: number; topGaps: { field: string; households: number }[]; unreadable?: number;
    migration?: { ok: boolean; error?: string; windowMonths?: number; rows?: number; due?: number; households?: number; unmatched?: string[]; undated?: number };
  };
  households: HouseholdRun[];
}

const TYPE_LABELS: Record<string, string> = {
  insurance_coverage_gap: "Insurance cover gap", debt_protection: "Debt protection", charter_candidate: "Sovereignty Charter",
  tier_upgrade: "Near a tier line", consolidation: "Outside assets", corporate_structuring: "Corporate structuring",
  estate_gap: "Estate gaps", idle_cash: "Idle cash", policy_event: "Policy renewal", fclass_migration: "F-class migration",
};
const TIER_LABELS: Record<string, string> = { tier_0: "Tier 0", tier_1: "Tier 1", tier_2a: "Tier 2A", tier_2b: "Tier 2B", tier_3: "Tier 3", tier_4: "Tier 4" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "Sure", medium: "Likely", low: "To confirm" };
const FILTERS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" }, { value: "accepted", label: "Accepted" }, { value: "snoozed", label: "Snoozed" }, { value: "dismissed", label: "Dismissed" }, { value: "converted", label: "Converted" }, { value: "resolved", label: "No longer found" },
];
const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const SNOOZE_DAYS = 90;
const POLL_MS = 5000;
const POLL_LIMIT_MS = 5 * 60_000;

export default function BookOfBusiness() {
  const { user } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  // The briefing links here with ?household=<id>: that household opens on arrival.
  const [open, setOpen] = useState<string | null>(params.get("household"));
  const [filter, setFilter] = useState<Status>("open");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sort, setSort] = useState<"most" | "date">("most");
  const [dismissing, setDismissing] = useState<string | null>(null);
  // Click a kind of missing data to list only the households missing it.
  const [gapFilter, setGapFilter] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [{ data: runs, error: runErr }, { data: rows, error: rowErr }] = await Promise.all([
      supabase.from("opportunity_runs" as never).select("id, started_at, finished_at, summary, households").eq("ok", true).order("started_at", { ascending: false }).limit(1),
      supabase.from("opportunities" as never).select("id, household_id, type, key, title, evidence, confidence, next_step, status, snoozed_until, dismissed_reason, first_seen, due_on"),
    ]);
    if (runErr || rowErr) setError((runErr || rowErr)!.message);
    else setError(null);
    setRun(((runs ?? []) as unknown as Run[])[0] ?? null);
    setOpps((rows ?? []) as unknown as Opportunity[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); return () => { if (poll.current) clearInterval(poll.current); }; }, [load]);

  const runAgain = async () => {
    setRunning(true);
    const before = run?.started_at ?? "";
    const { data, error: err } = await supabase.functions.invoke("book-of-business-run", { body: {} });
    if (err || data?.error) { setRunning(false); toast.error(err?.message || data?.error || "The run could not start."); return; }
    const began = Date.now();
    poll.current = setInterval(async () => {
      const { data: latest } = await supabase.from("opportunity_runs" as never).select("started_at, finished_at, ok").order("started_at", { ascending: false }).limit(1);
      const r = ((latest ?? []) as unknown as { started_at: string; finished_at: string | null; ok: boolean | null }[])[0];
      const done = r && r.started_at > before && r.finished_at;
      if (done || Date.now() - began > POLL_LIMIT_MS) {
        if (poll.current) clearInterval(poll.current);
        setRunning(false);
        if (done && r.ok === false) toast.error("The run failed. See Georgia's job health.");
        else if (!done) toast.error("The run is taking longer than expected. Reload in a few minutes.");
        await load();
      }
    }, POLL_MS);
  };

  const decide = async (o: Opportunity, patch: Record<string, unknown>, done: string) => {
    const { error: err } = await supabase.from("opportunities" as never).update({ ...patch, decided_by: user?.email ?? null, decided_at: new Date().toISOString() } as never).eq("id", o.id);
    if (err) { toast.error(err.message); return; }
    toast.success(done);
    setDismissing(null);
    setReason("");
    await load();
  };
  const accept = async (o: Opportunity) => {
    const { data, error: err } = await supabase.functions.invoke("book-of-business-accept", { body: { opportunity_id: o.id } });
    if (err || data?.error) { toast.error(data?.error || err?.message || "Could not create the task."); return; }
    toast.success(data?.already ? "A task already exists for this one" : "Task created in Projects, due in a week");
    await load();
  };
  const snooze = (o: Opportunity) => decide(o, { status: "snoozed", snoozed_until: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString().slice(0, 10) }, `Snoozed for ${SNOOZE_DAYS} days`);
  const dismiss = (o: Opportunity) => decide(o, { status: "dismissed", dismissed_reason: reason.trim() || null }, "Dismissed");
  const convert = (o: Opportunity) => decide(o, { status: "converted", converted_at: new Date().toISOString() }, "Marked converted");
  const reopen = (o: Opportunity) => decide(o, { status: "open", snoozed_until: null, dismissed_reason: null, converted_at: null, resolved_at: null }, "Reopened");

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, snoozed: 0, accepted: 0, dismissed: 0, converted: 0, resolved: 0 };
    for (const o of opps) c[o.status] += 1;
    return c;
  }, [opps]);
  const byType = useMemo(() => {
    const t: Record<string, number> = {};
    for (const o of opps) if (o.status === "open") t[o.type] = (t[o.type] ?? 0) + 1;
    return t;
  }, [opps]);
  const shown = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const o of opps) if (o.status === filter && (typeFilter === "all" || o.type === typeFilter)) m.set(o.household_id, [...(m.get(o.household_id) ?? []), o]);
    return m;
  }, [opps, filter, typeFilter]);
  const gapKind = (field: string) => field.split(":")[0];
  const rows = orderHouseholds([...(run?.households ?? [])].filter((h) => !gapFilter || h.gaps.some((g) => gapKind(g.field) === gapFilter)), shown, sort);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">Book of Business</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Where the book could use more products or services, found by fixed rules over the data in the CRM. Georgia runs it every Monday. These are prompts for a conversation, never recommendations to a client. Missing data is listed separately, so a quiet household may just be an empty one.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={runAgain} disabled={running || loading}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{running ? "Running" : "Run now"}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading</div>}
        {!loading && !run && !error && <p className="text-sm text-muted-foreground">No run yet. Press Run now; it reads every household and takes a minute or two.</p>}

        {run && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader><CardTitle>Households</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{run.summary.households}</div>
                  <p className="text-sm text-muted-foreground">Data on file: {pct(run.summary.averageCompleteness)} on average{run.summary.unreadable ? ` · ${run.summary.unreadable} could not be read` : ""}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Opportunities</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{counts.open}</div>
                  <p className="text-sm text-muted-foreground">{counts.accepted} accepted · {counts.snoozed} snoozed · {counts.dismissed} dismissed · {counts.converted} converted</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Open, by type</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                    <div key={t} className="flex justify-between"><span>{TYPE_LABELS[t] ?? t}</span><span className="tabular-nums">{n}</span></div>
                  ))}
                  {Object.keys(byType).length === 0 && <span className="text-muted-foreground">None open</span>}
                </CardContent>
              </Card>
            </div>

            {run.summary.migration && (
              run.summary.migration.ok ? (
                <p className="text-sm text-muted-foreground">
                  Migration plan sheet: {run.summary.migration.rows} accounts read, {run.summary.migration.due} within {run.summary.migration.windowMonths ?? 6} months of the end of their chargeback, across {run.summary.migration.households} households.
                  {run.summary.migration.unmatched && run.summary.migration.unmatched.length > 0 && ` ${run.summary.migration.unmatched.length} matched no household (account numbers ending ${run.summary.migration.unmatched.slice(0, 8).join(", ")}).`}
                  {!!run.summary.migration.undated && ` ${run.summary.migration.undated} chargeback accounts have no investment or maturity date.`}
                </p>
              ) : (
                <p className="text-sm text-destructive">The migration plan sheet could not be read, so F-class migration findings were left as they were: {run.summary.migration.error}</p>
              )
            )}

            {run.summary.topGaps.length > 0 && (
              <Card>
                <CardHeader><CardTitle>What is missing most</CardTitle></CardHeader>
                <CardContent>
                  <p className="mb-2 text-sm text-muted-foreground">Fixing these unlocks the most rules. Each count is households; click one to list who is missing it.</p>
                  <div className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2">
                    {run.summary.topGaps.map((g) => (
                      <button key={g.field} type="button" onClick={() => setGapFilter(gapFilter === g.field ? null : g.field)} className={cn("flex justify-between rounded px-1 text-left hover:bg-muted", gapFilter === g.field && "bg-muted font-medium")}>
                        <span>{g.field}</span><span className="tabular-nums">{g.households}</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {gapFilter && <p className="text-sm">Households missing "{gapFilter}" <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setGapFilter(null)}>Show all</button></p>}
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Show</span>
              <Select value={filter} onValueChange={(v) => setFilter(v as Status)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label} ({counts[f.value]})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {Object.entries(TYPE_LABELS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="ml-2 text-sm text-muted-foreground">Sort</span>
              <Select value={sort} onValueChange={(v) => setSort(v as "most" | "date")}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="most">Most opportunities first</SelectItem>
                  <SelectItem value="date">Earliest maturity or renewal first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              {rows.map((h) => {
                const isOpen = open === h.householdId;
                const list = orderOpps(shown.get(h.householdId) ?? [], sort === "date" ? "date" : "confidence");
                const next = earliestDue(list);
                return (
                  <div key={h.householdId} className="border-b border-border last:border-0">
                    <ListRowStatic className="cursor-pointer border-0" onClick={() => setOpen(isOpen ? null : h.householdId)}>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                      <span className="w-16 text-muted-foreground">{h.tier ? TIER_LABELS[h.tier] ?? h.tier : "No tier"}</span>
                      <span className="w-24 text-right tabular-nums text-muted-foreground" title="This household's own assets under management">{money(h.householdAum ?? 0)}</span>
                      <span className="w-24 text-right tabular-nums text-muted-foreground" title="The earliest chargeback maturity or renewal among these">{next ?? ""}</span>
                      <span className="w-28 text-right tabular-nums">{list.length} {FILTERS.find((f) => f.value === filter)!.label.toLowerCase()}</span>
                      <span className={cn("w-28 text-right tabular-nums", h.completeness !== null && h.completeness < 0.6 && "text-destructive")}>{h.completeness === null ? "unreadable" : `${pct(h.completeness)} on file`}</span>
                    </ListRowStatic>
                    {isOpen && (
                      <div className="space-y-4 bg-muted/30 px-10 py-4 text-sm">
                        {h.error && <p className="text-destructive">This household could not be read: {h.error}</p>}
                        <Link to={`/households/${h.householdId}`} className="text-primary hover:underline">Open household</Link>
                        <p className="text-muted-foreground">
                          {h.pooled
                            ? `Tiered with the ${h.familyName ?? "family"} as a whole: ${money(h.familyAum ?? h.groupedAum)} pooled across its households. Family-level findings appear once, on the household with the most assets.`
                            : "Tiered on its own assets."}
                        </p>
                        {list.map((o) => (
                          <div key={o.id}>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{CONFIDENCE_LABEL[o.confidence]}</Badge>
                              <span className="text-muted-foreground">{TYPE_LABELS[o.type] ?? o.type}</span>
                              <span className="text-xs text-muted-foreground">first seen {o.first_seen}</span>
                              {o.due_on && <span className="text-xs text-muted-foreground">{o.type === "fclass_migration" ? "first maturity" : "date"} {o.due_on}</span>}
                              {o.status === "snoozed" && o.snoozed_until && <span className="text-xs text-muted-foreground">back on {o.snoozed_until}</span>}
                            </div>
                            <p className="mt-1 font-medium">{o.title}</p>
                            <ul className="mt-1 text-muted-foreground">{o.evidence.map((e, i) => <li key={i}>{e.label}: {e.value}</li>)}</ul>
                            {o.next_step && <p className="mt-1">Next: {o.next_step}</p>}
                            {o.status === "accepted" && <p className="mt-1 text-muted-foreground">A task for this is open in Projects.</p>}
                            {o.dismissed_reason && <p className="mt-1 text-muted-foreground">Dismissed because: {o.dismissed_reason}</p>}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {o.status === "open" && dismissing !== o.id && (
                                <>
                                  <Button size="sm" onClick={() => accept(o)}>Accept: create task</Button>
                                  <Button size="sm" variant="outline" onClick={() => snooze(o)}>Snooze {SNOOZE_DAYS} days</Button>
                                  <Button size="sm" variant="outline" onClick={() => { setDismissing(o.id); setReason(""); }}>Dismiss</Button>
                                </>
                              )}
                              {dismissing === o.id && (
                                <>
                                  <Input className="h-8 w-72" placeholder="Why (e.g. already in place)" value={reason} onChange={(e) => setReason(e.target.value)} />
                                  <Button size="sm" onClick={() => dismiss(o)}>Dismiss</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setDismissing(null)}>Cancel</Button>
                                </>
                              )}
                              {o.status === "accepted" && <Button size="sm" variant="outline" onClick={() => convert(o)}>Mark converted</Button>}
                              {o.status !== "open" && o.status !== "resolved" && <Button size="sm" variant="outline" onClick={() => reopen(o)}>Reopen</Button>}
                            </div>
                          </div>
                        ))}
                        {h.gaps.length > 0 && (
                          <div>
                            <p className="font-medium">Missing data</p>
                            <ul className="mt-1 text-muted-foreground">{h.gaps.map((g, i) => <li key={i}>{g.field}: {g.why}</li>)}</ul>
                          </div>
                        )}
                        {list.length === 0 && h.gaps.length === 0 && <p className="text-muted-foreground">Nothing here and nothing missing.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Last run {run.finished_at ? new Date(run.finished_at).toLocaleString("en-CA") : ""}. Revenue estimates come later.</p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
