import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import {
  CheckSquare,
  Loader2,
  AlertCircle,
  Plus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  RotateCw,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask } from "@/shared/lib/agents";
import { TaskDetailPanel } from "@/modules/pm/components/TaskDetailPanel";
import { StaffAssigneePicker } from "@/modules/pm/components/StaffAssigneePicker";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { cn } from "@/shared/lib/utils";

interface Props {
  contactId: string;
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-secondary text-secondary-foreground",
  in_progress: "bg-primary/15 text-primary",
  done: "bg-emerald-500/15 text-emerald-600",
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

export function ContactTaskList({ contactId }: Props) {
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTaskAgent().listTasks({ contact_id: contactId });
      setTasks(data);
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
  }, [contactId]);

  const handleTaskDeleted = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId && t.parent_task_id !== taskId));
  };

  const handleTaskChanged = (updated: PmTask) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const rootTasks = tasks.filter((t) => !t.parent_task_id);
  const newTasks = rootTasks.filter((t) => t.status === "open");
  const ongoingTasks = rootTasks.filter((t) => t.status === "in_progress");
  const completedTasks = rootTasks.filter((t) => t.status === "done");

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Tasks
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
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Tasks
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

  const renderRow = (task: PmTask) => {
    const isExpanded = expandedId === task.id;
    const overdue = isOverdue(task);
    return (
      <div key={task.id}>
        <div
          onClick={() => setExpandedId(isExpanded ? null : task.id)}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
            isExpanded ? "bg-muted/50" : "bg-muted/30 hover:bg-muted/50",
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate font-medium", task.status === "done" && "text-muted-foreground line-through")}>
            {task.title}
          </span>
          {!task.client_visible && (
            <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Advisor visible only" />
          )}
          {task.due_date && (
            <span className={cn("shrink-0 text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
              {parseLocalDate(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <StaffAssigneePicker
              value={task.assignee_id}
              householdId={task.household_id}
              familyId={task.family_id}
              onChange={async (assignee_id) => {
                try {
                  const updated = await getTaskAgent().updateTask(task.id, { assignee_id });
                  handleTaskChanged(updated);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not update the assignee.");
                }
              }}
            />
          </div>
          <Badge
            className={cn("shrink-0 px-1.5 py-0 text-[9px]", overdue ? "bg-destructive text-destructive-foreground" : STATUS_BADGE[task.status])}
          >
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
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            Tasks
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {newTasks.length + ongoingTasks.length > 0 && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {newTasks.length + ongoingTasks.length}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowAddTask(!showAddTask)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAddTask && (
          <AddTaskForm
            contactId={contactId}
            onCreated={() => {
              setShowAddTask(false);
              load();
            }}
            onCancel={() => setShowAddTask(false)}
          />
        )}

        {rootTasks.length === 0 && !showAddTask && (
          <p className="text-sm text-muted-foreground text-center py-2">No tasks found.</p>
        )}

        {newTasks.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <Sparkles className="h-3 w-3" />
              New ({newTasks.length})
            </div>
            {newTasks.map(renderRow)}
          </div>
        )}

        {ongoingTasks.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <RotateCw className="h-3 w-3" />
              Ongoing ({ongoingTasks.length})
            </div>
            {ongoingTasks.map(renderRow)}
          </div>
        )}

        {completedTasks.length > 0 && (
          <Collapsible open={completedOpen} onOpenChange={setCompletedOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
              {completedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Completed ({completedTasks.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-1.5">
              {completedTasks.slice(0, 10).map(renderRow)}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function AddTaskForm({
  contactId,
  onCreated,
  onCancel,
}: {
  contactId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [clientVisible, setClientVisible] = useState(true);
  const [creating, setCreating] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await getTaskAgent().createTask({
        title: title.trim(),
        due_date: dueDate || undefined,
        contact_id: contactId,
        client_visible: clientVisible,
      });
      setTitle("");
      setDueDate("");
      setClientVisible(true);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create this task.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Input
        placeholder="New task name…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 w-36 text-xs" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Client Visible
          <Switch checked={clientVisible} onCheckedChange={setClientVisible} className="scale-90" />
        </label>
        <div className="flex-1" />
        <Button size="sm" className="h-7 text-xs" disabled={!title.trim() || creating} onClick={handleSubmit}>
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
