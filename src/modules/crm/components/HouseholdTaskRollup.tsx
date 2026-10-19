import { useState, useEffect } from "react";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { CheckSquare, Clock, Loader2, AlertCircle, ChevronRight, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask } from "@/shared/lib/agents";
import { TaskDetailPanel } from "@/modules/pm/components/TaskDetailPanel";
import { cn } from "@/shared/lib/utils";

interface Member {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface Props {
  householdId: string;
  members: Member[];
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "outline",
  in_progress: "default",
  done: "secondary",
};

function isOverdue(task: PmTask) {
  return task.status !== "done" && !!task.due_date && parseLocalDate(task.due_date) < new Date();
}

function statusLabel(task: PmTask) {
  if (isOverdue(task)) return "Overdue";
  if (task.status === "in_progress") return "In Progress";
  if (task.status === "done") return "Done";
  return "Open";
}

export function HouseholdTaskRollup({ householdId, members }: Props) {
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTaskAgent().listTasks({ household_id: householdId });
      const roots = data.filter((t) => !t.parent_task_id);
      roots.sort((a, b) => {
        if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
        const da = a.due_date ? parseLocalDate(a.due_date).getTime() : Infinity;
        const db = b.due_date ? parseLocalDate(b.due_date).getTime() : Infinity;
        return da - db;
      });
      setTasks(roots);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const handleTaskDeleted = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId && t.parent_task_id !== taskId));
  };

  const handleTaskChanged = (updated: PmTask) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const ownerName = (task: PmTask) => {
    if (!task.contact_id) return null;
    const m = members.find((mm) => mm.id === task.contact_id);
    return m ? `${m.first_name} ${m.last_name || ""}`.trim() : null;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Household Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 text-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Household Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeTasks = tasks.filter((t) => t.status !== "done");
  const completedTasks = tasks.filter((t) => t.status === "done");

  const renderRow = (task: PmTask) => {
    const owner = ownerName(task);
    const isExpanded = expandedId === task.id;
    const completed = task.status === "done";
    return (
      <div key={task.id}>
        <div
          onClick={() => setExpandedId(isExpanded ? null : task.id)}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors",
            isExpanded ? "bg-muted/50" : completed ? "opacity-50 hover:bg-muted/30" : "bg-muted/30 hover:bg-muted/50",
          )}
        >
          {completed ? (
            <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Clock className="h-4 w-4 shrink-0 text-accent" />
          )}
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-medium text-foreground truncate", completed && "line-through text-muted-foreground")}>
              {task.title}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {owner && (
                <Link
                  to={`/contacts/${task.contact_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-accent hover:underline"
                >
                  {owner}
                </Link>
              )}
              {task.due_date && !completed && (
                <span className="text-[10px] text-muted-foreground">
                  Due {parseLocalDate(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
          <Badge variant={isOverdue(task) ? "destructive" : STATUS_BADGE[task.status]} className="text-[9px] shrink-0">
            {statusLabel(task)}
          </Badge>
        </div>
        {isExpanded && (
          <div className="mt-1 rounded-md border border-border bg-background p-3">
            <TaskDetailPanel task={task} onChanged={handleTaskChanged} onDeleted={handleTaskDeleted} />
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Household Actions
          </CardTitle>
          {activeTasks.length > 0 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
              {activeTasks.length} active
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No tasks across household members.
          </p>
        ) : (
          <>
            {activeTasks.map(renderRow)}

            {completedTasks.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowCompleted((prev) => !prev)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-foreground transition-colors mb-1.5"
                >
                  {showCompleted ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Completed ({completedTasks.length})
                </button>
                {showCompleted && (
                  <div className="space-y-1.5">{completedTasks.slice(0, 5).map(renderRow)}</div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
