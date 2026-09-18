import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Calendar, Plus, Loader2, Link2Off, Inbox, ChevronRight,
  Grape, Landmark, Anchor, Building2, Pin, Pencil, Check, X, Sparkles, Mail,
} from "lucide-react";
import { format, parseISO, isToday, differenceInCalendarDays } from "date-fns";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask, PmProject } from "@/shared/lib/agents";
import { TaskDetailPanel } from "@/modules/pm/components/TaskDetailPanel";
import {
  useGoogleStatus,
  useConnectGoogle,
  useDisconnectGoogle,
  useCalendarEvents,
  useGmailMessages,
} from "@/shared/hooks/useGoogle";
import { useAuth } from "@/shared/hooks/useAuth";

const DEFAULT_PINNED_PROJECT_GID = "1214066166978534";
const PINNED_PROJECT_LABEL = "Pinned Project";
const PINNED_PROJECT_STORAGE_KEY = "dashboard.pinnedProjectGid";

function extractProjectGid(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/(?:project\/|\/0\/)(\d+)/);
  return m ? m[1] : null;
}

export function CommandCenter() {
  const { data: status, isLoading: statusLoading } = useGoogleStatus();
  const connectGoogle = useConnectGoogle();
  const disconnectGoogle = useDisconnectGoogle();
  const isConnected = !!status?.connected;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {statusLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isConnected ? (
          <div className="flex items-center gap-2">
            <Badge className="bg-sanctuary-green/20 text-sanctuary-green border-sanctuary-green/30">
              Google Connected
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                disconnectGoogle.mutate(undefined, {
                  onSuccess: () => toast.success("Google disconnected"),
                });
              }}
              className="text-muted-foreground text-xs"
            >
              <Link2Off className="mr-1 h-3 w-3" />
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => connectGoogle.mutate()}
            disabled={connectGoogle.isPending}
            className="gap-1.5"
          >
            {connectGoogle.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Calendar className="h-3.5 w-3.5" />
            )}
            Connect Google
          </Button>
        )}
      </div>

      <DailyBriefingCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <MyTasksWidget />
        <CalendarWidget isConnected={isConnected} statusLoading={statusLoading} />
        <EmailWidget isConnected={isConnected} statusLoading={statusLoading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FirmAumWidget />
        <PinnedProjectTasks />
      </div>
    </div>
  );
}

interface DailyBriefing {
  generation_status: "generating" | "complete" | "error";
  generation_error: string | null;
  greeting: string | null;
  summary_line: string | null;
  priority_items: { label: string; reason: string; link: string | null }[];
}

// Internal routes get a react-router Link (no full reload); external links
// (Gmail, a Google Calendar event) get a plain new-tab anchor. No link at
// all (e.g. a fact resolved with nothing to point to) just renders as text.
function PriorityItemLabel({ item }: { item: DailyBriefing["priority_items"][number] }) {
  if (!item.link) return <span className="font-medium text-foreground">{item.label}</span>;
  if (item.link.startsWith("http")) {
    return (
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
        {item.label}
      </a>
    );
  }
  return (
    <Link to={item.link} className="font-medium text-accent hover:underline">
      {item.label}
    </Link>
  );
}

// AI-generated summary of the day: the staff member's own tasks/calendar/
// unread email, plus firm-wide open client requests and Quo inbox activity.
// Pre-generated every morning by a cron job; "Generate now"/"Regenerate"
// call the same generator on demand (e.g. before the first cron run of a
// given day, or a brand-new staff member's first day).
function DailyBriefingCard() {
  const { user } = useAuth();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const todayStr = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date()),
    [],
  );

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("daily_briefings")
      .select("generation_status, generation_error, greeting, summary_line, priority_items")
      .eq("staff_user_id", user.id)
      .eq("briefing_date", todayStr)
      .maybeSingle();
    setBriefing(data as DailyBriefing | null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const generate = async () => {
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-briefing-generate", { body: {} });
      if (error) throw error;
      setBriefing(data.briefing as DailyBriefing);
    } catch {
      toast.error("Failed to generate today's briefing");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Card className="border-dashed border-border">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sanctuary-bronze/10 text-sanctuary-bronze">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">The Daily Briefing</p>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : !briefing ? (
            <p className="text-xs text-muted-foreground">No briefing yet for today.</p>
          ) : briefing.generation_status === "generating" ? (
            <p className="text-xs text-muted-foreground">Generating today's briefing…</p>
          ) : briefing.generation_status === "error" ? (
            <p className="text-xs text-destructive">Couldn't generate today's briefing: {briefing.generation_error}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {briefing.greeting} — {briefing.summary_line}
              </p>
              {briefing.priority_items.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {briefing.priority_items.map((it, i) => (
                    <li key={i} className="text-xs text-foreground">
                      • <PriorityItemLabel item={it} />
                      {it.reason ? ` — ${it.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={generate} disabled={regenerating} className="shrink-0 text-xs">
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : briefing ? "Regenerate" : "Generate now"}
        </Button>
      </CardContent>
    </Card>
  );
}

// Firm-wide AUM — same card style/breakdown as the Contact/Household AUM
// cards, but unfiltered across every household so it aggregates the whole
// firm rather than one family.
function FirmAumWidget() {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    vineyard: 0,
    storehouses: 0,
    corp: 0,
    holdingTank: 0,
    insuranceCash: 0,
  });
  const [byStorehouse, setByStorehouse] = useState<Record<number, number>>({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [
        { data: vineyard },
        { data: storehouses },
        { data: corpVineyard },
        { data: holdingTank },
        { data: insurance },
      ] = await Promise.all([
        supabase.from("vineyard_accounts").select("current_value"),
        supabase.from("storehouses").select("current_value, storehouse_number, asset_type"),
        supabase.from("corporate_vineyard_accounts").select("current_value"),
        supabase.from("holding_tank").select("current_value").neq("status", "moved"),
        supabase.from("insurance_policies" as any).select("cash_value, coverage_amount, coverage_storehouse_id"),
      ]);
      if (!mounted) return;

      const sum = (rows: any[] | null, key: string) =>
        (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);

      const nonResidence = (storehouses || []).filter(
        (s: any) => s.asset_type !== "Primary Residence & Protected Legacy Accounts",
      );
      const insuranceCash = sum(insurance, "cash_value");
      const legacyStorehouseIds = new Set(
        (storehouses || []).filter((s: any) => s.storehouse_number === 4).map((s: any) => s.id),
      );
      const coverageTotal = (insurance || [])
        .filter((p: any) => p.coverage_storehouse_id && legacyStorehouseIds.has(p.coverage_storehouse_id))
        .reduce((s: number, p: any) => s + (Number(p.coverage_amount) || 0), 0);

      const byNum: Record<number, number> = {};
      [1, 2, 3, 4].forEach((num) => {
        const rowTotal = nonResidence
          .filter((s: any) => s.storehouse_number === num)
          .reduce((s: number, r: any) => s + (Number(r.current_value) || 0), 0);
        byNum[num] = rowTotal + (num === 2 ? insuranceCash : 0) + (num === 4 ? coverageTotal : 0);
      });

      setTotals({
        vineyard: sum(vineyard, "current_value"),
        storehouses: sum(nonResidence, "current_value") + insuranceCash,
        corp: sum(corpVineyard, "current_value"),
        holdingTank: sum(holdingTank, "current_value"),
        insuranceCash,
      });
      setByStorehouse(byNum);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const total = totals.vineyard + totals.storehouses + totals.corp + totals.holdingTank;

  return (
    <Card className="border-sanctuary-bronze/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-widest text-sanctuary-bronze">
          Assets Under Management
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">Total Firm AUM</p>
              <p className="text-3xl font-bold text-foreground">{formatCurrency(total)}</p>
            </div>
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Grape className="h-3.5 w-3.5" /> Portfolio
                </span>
                <span className="font-semibold text-primary">{formatCurrency(totals.vineyard)}</span>
              </div>
              {[
                { num: 1, label: "Liquidity Reserve" },
                { num: 2, label: "Strategic Reserve" },
                { num: 3, label: "Philanthropic Trust" },
                { num: 4, label: "Legacy Trust" },
              ].map(({ num, label }) => (
                <div key={num} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Landmark className="h-3.5 w-3.5" /> {label}
                  </span>
                  <span className="font-semibold text-accent">{formatCurrency(byStorehouse[num] || 0)}</span>
                </div>
              ))}
              {totals.corp > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Corporate
                  </span>
                  <span className="font-semibold text-foreground">{formatCurrency(totals.corp)}</span>
                </div>
              )}
              {totals.holdingTank > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Anchor className="h-3.5 w-3.5" /> Holding Tank
                  </span>
                  <span className="font-semibold text-amber-600">{formatCurrency(totals.holdingTank)}</span>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_DOT: Record<string, string> = {
  open: "bg-muted-foreground/40",
  in_progress: "bg-primary",
  done: "bg-emerald-500",
};

// Absorbs what was previously a separate "Today's Tasks" widget: tasks due
// today are flagged inline with a "Today" badge instead of living in their
// own card with their own duplicate fetch.
interface TaskEntityLink {
  label: string;
  to: string;
}

/** One link per task, preferring contact over household over family — same
 *  precedence TaskDetailPanel's pickers already use for task scope. */
async function resolveTaskEntityLinks(tasks: PmTask[]): Promise<Record<string, TaskEntityLink>> {
  const contactIds = Array.from(new Set(tasks.map((t) => t.contact_id).filter((id): id is string => !!id)));
  const householdIds = Array.from(
    new Set(tasks.filter((t) => !t.contact_id).map((t) => t.household_id).filter((id): id is string => !!id)),
  );
  const familyIds = Array.from(
    new Set(
      tasks
        .filter((t) => !t.contact_id && !t.household_id)
        .map((t) => t.family_id)
        .filter((id): id is string => !!id),
    ),
  );

  const [contactsRes, householdsRes, familiesRes] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id, first_name, last_name").in("id", contactIds) : Promise.resolve({ data: [] }),
    householdIds.length ? supabase.from("households").select("id, label").in("id", householdIds) : Promise.resolve({ data: [] }),
    familyIds.length ? supabase.from("families").select("id, name").in("id", familyIds) : Promise.resolve({ data: [] }),
  ]);

  const contactLabel = new Map(
    (contactsRes.data || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name || ""}`.trim()]),
  );
  const householdLabel = new Map((householdsRes.data || []).map((h: any) => [h.id, h.label]));
  const familyLabel = new Map((familiesRes.data || []).map((f: any) => [f.id, f.name]));

  const links: Record<string, TaskEntityLink> = {};
  for (const t of tasks) {
    if (t.contact_id && contactLabel.has(t.contact_id)) {
      links[t.id] = { label: contactLabel.get(t.contact_id)!, to: `/contacts/${t.contact_id}` };
    } else if (t.household_id && householdLabel.has(t.household_id)) {
      links[t.id] = { label: householdLabel.get(t.household_id)!, to: `/households/${t.household_id}` };
    } else if (t.family_id && familyLabel.has(t.family_id)) {
      links[t.id] = { label: `${familyLabel.get(t.family_id)!} Family`, to: `/families/${t.family_id}` };
    }
  }
  return links;
}

function MyTasksWidget() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [entityLinks, setEntityLinks] = useState<Record<string, TaskEntityLink>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [myTasks, projects] = await Promise.all([
        getTaskAgent().listTasks({ assignee_id: "me" }),
        getTaskAgent().listProjects(),
      ]);
      const names: Record<string, string> = {};
      for (const p of projects as PmProject[]) names[p.id] = p.name;
      setProjectNames(names);

      const incomplete = myTasks.filter((t) => t.status !== "done");
      setEntityLinks(await resolveTaskEntityLinks(incomplete));
      const sorted = [...incomplete].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return parseLocalDate(a.due_date).getTime() - parseLocalDate(b.due_date).getTime();
      });
      setTasks(sorted);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleTaskChanged = (updated: PmTask) => {
    setTasks((prev) =>
      updated.status === "done"
        ? prev.filter((t) => t.id !== updated.id)
        : prev.map((t) => (t.id === updated.id ? updated : t)),
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-sanctuary-bronze" />
          My Tasks
        </CardTitle>
        {tasks.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load tasks</p>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1 -mr-1">
            {tasks.slice(0, 20).map((task) => {
              const projectName = task.project_id ? projectNames[task.project_id] : null;
              const entityLink = entityLinks[task.id];
              const isExpanded = expandedId === task.id;
              const dueToday = !!task.due_date && isToday(parseLocalDate(task.due_date));
              return (
                <div key={task.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : task.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted/50 text-left",
                      isExpanded && "bg-muted/50 border-accent/30",
                      dueToday && !isExpanded && "border-l-2 border-l-amber-500",
                    )}
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[task.status] || STATUS_DOT.open)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {projectName && (
                            <span className="text-xs text-accent font-medium truncate">{projectName}</span>
                          )}
                          {entityLink && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(entityLink.to);
                              }}
                              className="text-xs text-sanctuary-bronze font-medium truncate hover:underline cursor-pointer"
                            >
                              {entityLink.label}
                            </span>
                          )}
                          {task.due_date && (
                            dueToday ? (
                              <span className="text-xs font-semibold text-amber-600">Today</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Due: {format(parseLocalDate(task.due_date), "MMM d")}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                      isExpanded && "rotate-90"
                    )} />
                  </button>
                  {isExpanded && (
                    <div className="mt-1 mb-2 rounded-lg border border-border bg-background p-3">
                      <TaskDetailPanel task={task} onChanged={handleTaskChanged} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Absorbs what was previously a separate "Today's Events" widget: today's
// events render in their own labeled section above the rest of the week,
// from one fetch instead of two overlapping ones. Self-gated on Google
// connection so the rest of the dashboard never has to wait on it.
function CalendarWidget({ isConnected, statusLoading }: { isConnected: boolean; statusLoading: boolean }) {
  const { timeMin, timeMax } = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      timeMin: start.toISOString(),
      timeMax: new Date(start.getTime() + 7 * 86400000).toISOString(),
    };
  }, []);
  const { data, isLoading, error } = useCalendarEvents(timeMin, timeMax, isConnected);

  const events = (data?.items || []).filter((e: any) => e.start?.dateTime || e.start?.date);
  const todayEvents = events.filter((e: any) => {
    const start = e.start?.dateTime || e.start?.date;
    return start && isToday(parseISO(start));
  });
  const laterEvents = events.filter((e: any) => !todayEvents.includes(e));

  // Today's events show a time (or "All day"); this week's events show just
  // the day name — the date itself isn't useful at a glance, and the time
  // is more detail than a week-ahead skim needs.
  const renderEvent = (event: any, showTime: boolean) => {
    const start = event.start?.dateTime || event.start?.date;
    const startDate = start ? parseISO(start) : null;
    const label = !startDate
      ? ""
      : showTime
        ? (event.start?.dateTime ? format(startDate, "h:mm a") : "All day")
        : format(startDate, "EEE");
    return (
      <a
        key={event.id}
        href={event.htmlLink || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2 text-sm rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/50 transition-colors"
      >
        <span className="text-xs text-muted-foreground w-14 shrink-0 mt-0.5">{label}</span>
        <span className="truncate text-foreground">{event.summary}</span>
      </a>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-sanctuary-bronze" />
          Calendar
        </CardTitle>
        {isConnected && (
          <a href="https://calendar.google.com/calendar/u/0/appointments/AcZssZ3Edv0-dF_AX1v9OIgnxfXSVIqy1GCcpWscL6U=" target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <Plus className="mr-1 h-3 w-3" />
              New
            </Button>
          </a>
        )}
      </CardHeader>
      <CardContent>
        {statusLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !isConnected ? (
          <p className="text-sm text-muted-foreground">Connect Google to view your calendar.</p>
        ) : isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load events</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events in the next 7 days.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Today</p>
              {todayEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing today.</p>
              ) : (
                <ul className="space-y-1.5">{todayEvents.slice(0, 6).map((e: any) => <li key={e.id}>{renderEvent(e, true)}</li>)}</ul>
              )}
            </div>
            {laterEvents.length > 0 && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">This Week</p>
                <ul className="space-y-1.5">{laterEvents.slice(0, 6).map((e: any) => <li key={e.id}>{renderEvent(e, false)}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Strips a Gmail "From" header ("Name" <email@domain.com>) down to just the
// display name for a tighter list — falls back to the raw header when there
// isn't one (e.g. a bare email address).
function formatSender(from: string): string {
  const match = from.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  return match ? match[1].trim() : from;
}

function EmailWidget({ isConnected, statusLoading }: { isConnected: boolean; statusLoading: boolean }) {
  const { data, isLoading, error } = useGmailMessages("in:inbox is:unread", isConnected);
  const messages = data?.messages || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-sanctuary-bronze" />
          Email
        </CardTitle>
        {isConnected && (
          <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              Open Gmail
            </Button>
          </a>
        )}
      </CardHeader>
      <CardContent>
        {statusLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !isConnected ? (
          <p className="text-sm text-muted-foreground">Connect Google to view your email.</p>
        ) : isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load email</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inbox zero — nothing unread.</p>
        ) : (
          <ul className="space-y-1.5">
            {messages.slice(0, 6).map((m: any) => (
              <li key={m.id}>
                <a
                  href={`https://mail.google.com/mail/u/0/#all/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-sm rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs text-muted-foreground w-20 shrink-0 mt-0.5 truncate">
                    {formatSender(m.from || "")}
                  </span>
                  <span className="truncate text-foreground">{m.subject || "(no subject)"}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Staff pin an arbitrary Asana project (URL or GID) and see its next-7-days
// tasks. Deliberately still Asana-backed — out of scope for the PM
// migration, since a staff member may want to pin any project firm-wide.
function PinnedProjectTasks() {
  const [projectGid, setProjectGid] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_PINNED_PROJECT_GID;
    return localStorage.getItem(PINNED_PROJECT_STORAGE_KEY) || DEFAULT_PINNED_PROJECT_GID;
  });
  const [tasks, setTasks] = useState<any[]>([]);
  const [projectName, setProjectName] = useState<string>(PINNED_PROJECT_LABEL);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!projectGid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [tasksRes, projRes] = await Promise.all([
          supabase.functions.invoke("asana-service", {
            body: { action: "getTasksForProject", project_gid: projectGid },
          }),
          supabase.functions.invoke("asana-service", {
            body: { action: "getProject", project_gid: projectGid },
          }),
        ]);
        const all = tasksRes.data?.data || tasksRes.data || [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const upcoming = (Array.isArray(all) ? all : [])
          .filter((t: any) => !t.completed && t.due_on)
          .map((t: any) => ({ ...t, _due: parseLocalDate(t.due_on) }))
          .filter((t: any) => {
            const diff = differenceInCalendarDays(t._due, today);
            return diff >= 0 && diff <= 7;
          })
          .sort((a: any, b: any) => a._due.getTime() - b._due.getTime());
        setTasks(upcoming);
        const name = projRes.data?.data?.name || projRes.data?.name;
        setProjectName(name || PINNED_PROJECT_LABEL);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [projectGid]);

  const saveDraft = () => {
    const gid = extractProjectGid(draft);
    if (!gid) return;
    localStorage.setItem(PINNED_PROJECT_STORAGE_KEY, gid);
    setProjectGid(gid);
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Pin className="h-4 w-4 shrink-0" />
          {editing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveDraft();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="Asana project URL or GID"
                className="h-7 text-xs"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveDraft}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <span className="truncate flex-1">{projectName} — Next 7 Days</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => {
                  setDraft(projectGid);
                  setEditing(true);
                }}
                title="Change pinned project"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!projectGid ? (
          <p className="text-sm text-muted-foreground">No project pinned.</p>
        ) : loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing due in the next 7 days.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.slice(0, 6).map((t) => (
              <li key={t.gid}>
                <a
                  href={t.permalink_url || `https://app.asana.com/0/${projectGid}/${t.gid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-start gap-2 text-sm rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/50 transition-colors text-left"
                >
                  <span className="text-xs text-muted-foreground w-14 shrink-0 mt-0.5">
                    {format(t._due, "MMM d")}
                  </span>
                  <span className="truncate text-foreground">{t.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
