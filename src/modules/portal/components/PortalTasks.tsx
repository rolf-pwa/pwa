import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { supabase } from "@/shared/integrations/supabase/client";
import { CheckSquare, Clock, AlertCircle, ChevronRight, Loader2, Sparkles, RotateCw, X } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { PortalTaskConversation } from "./PortalTaskConversation";
import { cn } from "@/shared/lib/utils";

interface PmTask {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  due_date: string | null;
}

interface Props {
  portalToken: string;
  clientName?: string;
  contactId?: string;
  /** When given, the Completed list renders there (the page sidebar) instead of under the active tasks. */
  completedTarget?: HTMLElement | null;
  /** Start the sidebar Completed list closed; the header opens it. */
  completedCollapsed?: boolean;
}

type TaskCategory = "new" | "ongoing";

function getTaskStatus(task: PmTask): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (task.status === "done") return { label: "Completed", variant: "secondary" };
  if (task.status === "in_progress") return { label: "In Progress", variant: "default" };
  if (task.due_date && parseLocalDate(task.due_date) < new Date()) return { label: "Overdue", variant: "destructive" };
  return { label: "Open", variant: "outline" };
}

function categoriseTask(task: PmTask): TaskCategory {
  return task.status === "in_progress" ? "ongoing" : "new";
}

function isNewTask(task: PmTask) {
  return categoriseTask(task) === "new";
}

/** Returns { newCount, ongoingCount } of active (non-completed) tasks, for
 * badge/dashboard use without rendering the full task list. Mirrors the
 * same fetch + categorisation + interaction-override logic as the main
 * component (a task the client has already opened moves to "ongoing"
 * regardless of its status). */
export function useTaskCounts(portalToken: string, contactId?: string) {
  const [counts, setCounts] = useState({ newCount: 0, ongoingCount: 0 });

  useEffect(() => {
    if (!contactId) return;
    (async () => {
      const [tasksRes, interactionsRes] = await Promise.all([
        supabase.functions.invoke("portal-pm-tasks", {
          body: { action: "list", portal_token: portalToken },
        }).then(r => ({ data: r.data?.tasks || [] })),
        supabase.functions.invoke("portal-track", {
          body: { action: "get_interactions", contact_id: contactId, portal_token: portalToken },
        }).then(r => ({ data: r.data?.data || [] })),
      ]);

      const activeTasks = ((tasksRes.data as PmTask[]) || []).filter((t) => t.status !== "done");
      const interactedIds = new Set(((interactionsRes.data as any[]) || []).map((r: any) => r.task_gid));
      setCounts({
        newCount: activeTasks.filter((t) => categoriseTask(t) === "new" && !interactedIds.has(t.id)).length,
        ongoingCount: activeTasks.filter((t) => categoriseTask(t) === "ongoing" || interactedIds.has(t.id)).length,
      });
    })();
  }, [portalToken, contactId]);

  return counts;
}

function TaskCard({ task, onClick, isExpanded }: { task: PmTask; onClick: () => void; isExpanded?: boolean }) {
  const status = getTaskStatus(task);
  const isNew = isNewTask(task);
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 border-b border-border/60 py-2.5 text-left transition-colors hover:bg-muted/40 group",
        isExpanded && "bg-muted/40"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Clock className={cn("h-4 w-4 shrink-0", isNew ? "text-accent" : "text-muted-foreground/60")} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
          {task.due_date && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Due: {parseLocalDate(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={status.variant} className="text-[10px] whitespace-nowrap">
          {status.label}
        </Badge>
        <ChevronRight className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          isExpanded ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"
        )} />
      </div>
    </button>
  );
}

export function PortalTasks({ portalToken, clientName, contactId, completedTarget, completedCollapsed }: Props) {
  const [completedOpen, setCompletedOpen] = useState(!completedCollapsed);
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<PmTask | null>(null);
  const [interactedIds, setInteractedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [tasksRes, interactionsRes] = await Promise.all([
          supabase.functions.invoke("portal-pm-tasks", {
            body: { action: "list", portal_token: portalToken },
          }),
          contactId
            ? supabase.functions.invoke("portal-track", {
                body: { action: "get_interactions", contact_id: contactId, portal_token: portalToken },
              }).then(r => ({ data: r.data?.data || [] }))
            : Promise.resolve({ data: [] }),
        ]);
        if (tasksRes.error) throw tasksRes.error;
        if (tasksRes.data?.error) {
          setError(tasksRes.data.error);
        } else {
          setTasks(tasksRes.data?.tasks || []);
        }
        // Load previously interacted task ids
        if (interactionsRes && "data" in interactionsRes && interactionsRes.data) {
          setInteractedIds(new Set((interactionsRes.data as any[]).map((r: any) => r.task_gid)));
        }
      } catch (e: any) {
        setError(e.message || "Failed to load tasks");
      } finally {
        setLoading(false);
      }
    })();
  }, [portalToken, contactId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Loader2 className="h-8 w-8 text-accent animate-spin mb-4" />
        <p className="text-sm text-muted-foreground">Loading your action items…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold text-foreground font-serif">Unable to Load Tasks</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">{error}</p>
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => t.status !== "done");
  const completedTasks = tasks.filter((t) => t.status === "done");
  // Tasks the client has interacted with move to "ongoing" regardless of status
  const newTasks = activeTasks.filter((t) => categoriseTask(t) === "new" && !interactedIds.has(t.id));
  const ongoingTasks = activeTasks.filter((t) => categoriseTask(t) === "ongoing" || interactedIds.has(t.id));
  const hasNoTasks = activeTasks.length === 0 && completedTasks.length === 0;

  if (hasNoTasks) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckSquare className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold text-foreground font-serif">All Clear</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          No immediate actions require your attention at this time.
        </p>
      </div>
    );
  }

  const handleTaskClick = async (task: PmTask) => {
    const isExpanded = selectedTask?.id === task.id;
    if (isExpanded) {
      setSelectedTask(null);
      return;
    }
    setSelectedTask(task);
    // Record interaction if this is a "new" task the client hasn't seen yet
    if (contactId && !interactedIds.has(task.id)) {
      setInteractedIds((prev) => new Set(prev).add(task.id));
      // Record interaction and notify staff in parallel
      const displayName = clientName || "A client";
      await supabase.functions.invoke("portal-track", {
        body: {
          action: "record_task_interaction",
          contact_id: contactId,
          task_gid: task.id,
          client_name: displayName,
          portal_token: portalToken,
        },
      });
    }
  };

  const renderTaskWithExpansion = (task: PmTask) => {
    const isExpanded = selectedTask?.id === task.id;
    return (
      <div key={task.id}>
        <TaskCard task={task} onClick={() => handleTaskClick(task)} isExpanded={isExpanded} />
        {isExpanded && (
          <div className="mb-2 mt-1 rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground font-serif">{task.title}</h4>
              <button onClick={() => setSelectedTask(null)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <PortalTaskConversation taskId={task.id} portalToken={portalToken} clientName={clientName} readOnly={task.status === "done"} />
          </div>
        )}
      </div>
    );
  };

  const completedBlock = completedTasks.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
          <button type="button" onClick={() => completedCollapsed && setCompletedOpen((o) => !o)} className={cn("flex w-full items-center gap-2 text-left", !completedCollapsed && "cursor-default")}>
            <CheckSquare className="h-4 w-4 text-accent" />
            <h3 className="font-serif text-sm font-semibold text-foreground">Completed ({completedTasks.length})</h3>
            {completedCollapsed && <ChevronRight className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", completedOpen && "rotate-90")} />}
          </button>
          {completedOpen && <ul className="space-y-1 pl-1">
            {completedTasks.slice(0, 10).map((task) => (
              <li key={task.id}>
                <button
                  onClick={() => handleTaskClick(task)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors text-left w-full group"
                >
                  <CheckSquare className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="line-through truncate group-hover:no-underline">{task.title}</span>
                  <ChevronRight className={cn("h-3 w-3 ml-auto shrink-0 text-muted-foreground/40 transition-transform", selectedTask?.id === task.id && "rotate-90")} />
                </button>
                {selectedTask?.id === task.id && (
                  <div className="mt-1 mb-2 rounded-lg border border-border bg-background p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-foreground font-serif">{task.title}</h4>
                      <button onClick={() => setSelectedTask(null)} className="p-1 rounded hover:bg-muted">
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                    <PortalTaskConversation taskId={task.id} portalToken={portalToken} clientName={clientName} readOnly />
                  </div>
                )}
              </li>
            ))}
          </ul>}
          </CardContent>
        </Card>
  ) : null;

  return (
    <div className="space-y-4">
      {/* New Tasks */}
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h3 className="font-serif text-sm font-semibold text-foreground">New Actions</h3>
            {newTasks.length > 0 && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">{newTasks.length} new</span>
            )}
          </div>
          {newTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new action items at this time.</p>
          ) : (
            <div>{newTasks.map(renderTaskWithExpansion)}</div>
          )}
        </CardContent>
      </Card>

      {/* Ongoing Tasks */}
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <RotateCw className="h-4 w-4 text-accent" />
            <h3 className="font-serif text-sm font-semibold text-foreground">Ongoing</h3>
            {ongoingTasks.length > 0 && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">{ongoingTasks.length}</span>
            )}
          </div>
          {ongoingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ongoing items right now.</p>
          ) : (
            <div>{ongoingTasks.map(renderTaskWithExpansion)}</div>
          )}
        </CardContent>
      </Card>

      {/* Completed Tasks — inline, or in the page sidebar when a target is given */}
      {!completedTarget && completedBlock}
      {completedTarget && completedBlock && createPortal(completedBlock, completedTarget)}
    </div>
  );
}
