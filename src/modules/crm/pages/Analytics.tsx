import { AppLayout } from "@/shared/components/AppLayout";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { BarChart3, LogIn, ChevronLeft, ExternalLink, Route } from "lucide-react";
import { Link } from "react-router-dom";
import { format, subDays, startOfDay, startOfWeek, eachDayOfInterval, eachWeekOfInterval } from "date-fns";

type TimeRange = "7d" | "30d" | "90d";
type Granularity = "daily" | "weekly";

interface LoginRecord {
  id: string;
  contact_id: string;
  login_method: string;
  created_at: string;
}

interface Contact {
  id: string;
  full_name: string;
  email: string | null;
  household_id: string | null;
}

interface Georgia2Session {
  id: string;
  session_key: string;
  created_at: string;
  step_domain_reached_at: string | null;
  step_catalyst_reached_at: string | null;
  step_diagnostic_reached_at: string | null;
  step_pathway_reached_at: string | null;
  step_confidential_reached_at: string | null;
  lead_captured: boolean;
}

const Analytics = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [georgia2Sessions, setGeorgia2Sessions] = useState<Georgia2Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillContact, setDrillContact] = useState<Contact | null>(null);

  const rangeStart = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    return subDays(new Date(), days).toISOString();
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from("portal_logins" as any).select("*").gte("created_at", rangeStart).order("created_at", { ascending: false }),
      supabase.from("contacts").select("id, full_name, email, household_id"),
      supabase
        .from("georgia2_sessions" as any)
        .select(
          "id, session_key, created_at, step_domain_reached_at, step_catalyst_reached_at, step_diagnostic_reached_at, step_pathway_reached_at, step_confidential_reached_at, lead_captured",
        )
        .gte("created_at", rangeStart)
        .order("created_at", { ascending: false }),
    ]).then(([loginsRes, contactsRes, georgia2Res]) => {
      setLogins((loginsRes.data as any) || []);
      setContacts(contactsRes.data || []);
      setGeorgia2Sessions((georgia2Res.data as any) || []);
      setLoading(false);
    });
  }, [rangeStart]);

  const contactMap = useMemo(() => {
    const map: Record<string, Contact> = {};
    contacts.forEach((c) => (map[c.id] = c));
    return map;
  }, [contacts]);

  // Build time-series buckets
  const buckets = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const start = startOfDay(subDays(new Date(), days));
    const end = startOfDay(new Date());

    if (granularity === "daily") {
      const dayList = eachDayOfInterval({ start, end });
      return dayList.map((d) => {
        const dayStr = format(d, "yyyy-MM-dd");
        const nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        return {
          label: format(d, "MMM d"),
          logins: logins.filter((l) => l.created_at >= d.toISOString() && l.created_at < nextDay.toISOString()).length,
        };
      });
    } else {
      const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
      return weeks.map((w, i) => {
        const weekEnd = i < weeks.length - 1 ? weeks[i + 1] : new Date();
        return {
          label: `W/O ${format(w, "MMM d")}`,
          logins: logins.filter((l) => l.created_at >= w.toISOString() && l.created_at < weekEnd.toISOString()).length,
        };
      });
    }
  }, [logins, granularity, timeRange]);

  // Per-client aggregation
  const clientStats = useMemo(() => {
    const map: Record<string, { logins: number }> = {};
    logins.forEach((l) => {
      if (!map[l.contact_id]) map[l.contact_id] = { logins: 0 };
      map[l.contact_id].logins++;
    });
    return Object.entries(map)
      .map(([id, stats]) => ({ contact: contactMap[id], ...stats }))
      .filter((s) => s.contact)
      .sort((a, b) => b.logins - a.logins);
  }, [logins, contactMap]);

  // Drill-down data
  const drillLogins = useMemo(
    () => (drillContact ? logins.filter((l) => l.contact_id === drillContact.id) : []),
    [drillContact, logins]
  );

  // Max for bar chart scaling
  const maxBucket = Math.max(1, ...buckets.map((b) => b.logins));

  // Step-level tracking shipped 2026-09-16 -- a session created before that
  // can never have step_*_reached_at data (the tracking code didn't exist
  // yet), so including pre-launch sessions in the funnel's "Started" count
  // would show a false 100% -> 0% cliff at the very first step, not a real
  // drop-off. Excluded from the funnel only; the "Georgia Sessions Started"
  // summary card above still counts every real session in range, since it
  // doesn't depend on step data.
  const FUNNEL_TRACKING_LAUNCH = "2026-09-16T00:00:00Z";
  const funnelSessions = useMemo(
    () => georgia2Sessions.filter((s) => s.created_at >= FUNNEL_TRACKING_LAUNCH),
    [georgia2Sessions]
  );
  const preTrackingSessionCount = georgia2Sessions.length - funnelSessions.length;

  // Georgia 2.0 funnel -- real first-reach counts per Stepper-labeled step,
  // from the per-step tracking added alongside this card. "Started" is
  // every trackable session row in range; each subsequent step is however
  // many of those sessions ever reached that step (a Back-button revisit
  // doesn't double count, since the tracking itself only records first reach).
  const funnelSteps = useMemo(() => {
    const total = funnelSessions.length;
    const steps = [
      { label: "Started", count: total },
      { label: "Domain", count: funnelSessions.filter((s) => s.step_domain_reached_at).length },
      { label: "Catalyst", count: funnelSessions.filter((s) => s.step_catalyst_reached_at).length },
      { label: "Diagnostic", count: funnelSessions.filter((s) => s.step_diagnostic_reached_at).length },
      { label: "Pathway (reveal)", count: funnelSessions.filter((s) => s.step_pathway_reached_at).length },
      { label: "Confidential (contact form)", count: funnelSessions.filter((s) => s.step_confidential_reached_at).length },
      { label: "Submitted", count: funnelSessions.filter((s) => s.lead_captured).length },
    ];
    return steps.map((step, i) => ({
      ...step,
      pctOfTotal: total > 0 ? Math.round((step.count / total) * 100) : 0,
      pctOfPrevious: i > 0 && steps[i - 1].count > 0 ? Math.round((step.count / steps[i - 1].count) * 100) : null,
    }));
  }, [funnelSessions]);

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        {drillContact ? (
          <>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setDrillContact(null)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Link to={`/contacts/${drillContact.id}`} className="text-2xl font-bold text-foreground hover:underline flex items-center gap-2">
                {drillContact.full_name} <ExternalLink className="h-4 w-4" />
              </Link>
              {drillContact.email && <span className="text-muted-foreground text-sm">{drillContact.email}</span>}
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Portal Logins</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-bold">{drillLogins.length}</p></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Login History</CardTitle></CardHeader>
              <CardContent>
                {drillLogins.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No logins in this period.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {drillLogins.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{format(new Date(l.created_at), "MMM d, yyyy h:mm a")}</TableCell>
                          <TableCell><Badge variant="secondary">{l.login_method}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="h-7 w-7" /> Analytics
              </h1>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(["7d", "30d", "90d"] as TimeRange[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setTimeRange(r)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        timeRange === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(["daily", "weekly"] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                        granularity === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center gap-2">
                  <LogIn className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">Portal Logins</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{loading ? "—" : logins.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {logins.filter((l) => l.login_method === "otp").length} OTP · {logins.filter((l) => l.login_method === "google").length} Google
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center gap-2">
                  <Route className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">Georgia Sessions Started</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{loading ? "—" : georgia2Sessions.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center gap-2">
                  <Route className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">Georgia Leads Captured</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{loading ? "—" : georgia2Sessions.filter((s) => s.lead_captured).length}</p>
                  {georgia2Sessions.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.round((georgia2Sessions.filter((s) => s.lead_captured).length / georgia2Sessions.length) * 100)}% of sessions
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Logins chart */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Portal Logins</CardTitle></CardHeader>
              <CardContent className="pt-2">
                <div className="flex items-end gap-1 h-40">
                  {buckets.map((b, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-primary/80 transition-all min-h-[2px]"
                        style={{ height: `${(b.logins / maxBucket) * 100}%` }}
                        title={`${b.label}: ${b.logins} logins`}
                      />
                      {buckets.length <= 31 && (
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                          {b.label.replace("W/O ", "")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Georgia 2.0 Funnel */}
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Route className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Georgia 2.0 — Diagnostic Funnel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {preTrackingSessionCount > 0 && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                    {preTrackingSessionCount} session{preTrackingSessionCount === 1 ? "" : "s"} from before step
                    tracking launched (Sep 16, 2026) {preTrackingSessionCount === 1 ? "is" : "are"} excluded below —
                    {preTrackingSessionCount === 1 ? " it has" : " they have"} no step data to report.
                  </p>
                )}
                {funnelSteps.map((step) => (
                  <div key={step.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{step.label}</span>
                      <span className="text-muted-foreground">
                        {step.count} · {step.pctOfTotal}%
                        {step.pctOfPrevious !== null && (
                          <span className="ml-2">
                            (<span className={step.pctOfPrevious < 70 ? "text-destructive font-medium" : ""}>{step.pctOfPrevious}%</span> of previous step)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/80 transition-all min-w-[2px]"
                        style={{ width: `${step.pctOfTotal}%` }}
                      />
                    </div>
                  </div>
                ))}
                {funnelSessions.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-2">
                    {preTrackingSessionCount > 0
                      ? "No sessions with step tracking in this period yet."
                      : "No Georgia 2.0 sessions in this period."}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Per-client table */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Client Activity</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Logins</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientStats.slice(0, 25).map((s) => (
                      <TableRow key={s.contact!.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDrillContact(s.contact!)}>
                        <TableCell className="font-medium">{s.contact!.full_name}</TableCell>
                        <TableCell>{s.logins}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-xs">View →</TableCell>
                      </TableRow>
                    ))}
                    {clientStats.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center">No activity in this period</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Analytics;
