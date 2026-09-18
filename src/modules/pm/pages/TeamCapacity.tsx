import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/shared/components/AppLayout";
import { ListRowStatic } from "@/shared/components/ListRow";
import { TaskDetailPanel } from "@/modules/pm/components/TaskDetailPanel";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmTask } from "@/shared/lib/agents";
import { AI_TEAMMATE_LABEL, type AiTeammateKey } from "@/shared/lib/aiTeammates";
import { supabase } from "@/shared/integrations/supabase/client";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { addDays, isBefore, startOfDay } from "date-fns";
import { Loader2, ChevronRight, Bot, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";

// v1 scope, deliberately: a grouped count table, no gantt/timeline, no
// drag-to-reassign, no per-project breakdown. No gantt/timeline component
// exists anywhere in this codebase -- building one is a real, separate
// undertaking. Everything here derives from pm_tasks columns that already
// exist, so a richer view can be added later with zero schema change.

interface StaffProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface CapacityRow {
  key: string;
  label: string;
  kind: "staff" | "agent" | "unassigned";
  tasks: PmTask[];
  overdue: number;
  dueThisWeek: number;
  noDueDate: number;
}

export default function TeamCapacity() {
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getTaskAgent().listOpenTasksForCapacity(),
      supabase.from("profiles").select("user_id, full_name, email").ilike("email", "%@prosperwise.ca").order("full_name"),
    ])
      .then(([openTasks, staffRes]) => {
        if (cancelled) return;
        setTasks(openTasks);
        setStaff(staffRes.data || []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTaskChanged = (updated: PmTask) => {
    setTasks((prev) =>
      updated.status === "done" ? prev.filter((t) => t.id !== updated.id) : prev.map((t) => (t.id === updated.id ? updated : t)),
    );
  };

  const rows = useMemo<CapacityRow[]>(() => {
    const today = startOfDay(new Date());
    const weekOut = addDays(today, 6);
    const bucket = (list: PmTask[]) => {
      let overdue = 0;
      let dueThisWeek = 0;
      let noDueDate = 0;
      for (const t of list) {
        if (!t.due_date) {
          noDueDate++;
          continue;
        }
        const due = parseLocalDate(t.due_date);
        if (isBefore(due, today)) overdue++;
        else if (!isBefore(weekOut, due)) dueThisWeek++;
      }
      return { overdue, dueThisWeek, noDueDate };
    };

    const byStaff = new Map<string, PmTask[]>();
    const byAgent = new Map<string, PmTask[]>();
    const unassigned: PmTask[] = [];
    for (const t of tasks) {
      if (t.assigned_agent_key) {
        const list = byAgent.get(t.assigned_agent_key) || [];
        list.push(t);
        byAgent.set(t.assigned_agent_key, list);
      } else if (t.assignee_id) {
        const list = byStaff.get(t.assignee_id) || [];
        list.push(t);
        byStaff.set(t.assignee_id, list);
      } else {
        unassigned.push(t);
      }
    }

    const result: CapacityRow[] = [];
    for (const s of staff) {
      const list = byStaff.get(s.user_id) || [];
      if (list.length === 0) continue;
      result.push({ key: s.user_id, label: s.full_name || s.email || s.user_id.slice(0, 8), kind: "staff", tasks: list, ...bucket(list) });
    }
    // Any assignee_id present on a task but not matching a known staff profile
    // (e.g. a household-head assignee) still needs a row — fall back to a
    // generic label rather than silently dropping their tasks.
    for (const [id, list] of byStaff) {
      if (staff.some((s) => s.user_id === id)) continue;
      result.push({ key: id, label: `Staff (${id.slice(0, 8)})`, kind: "staff", tasks: list, ...bucket(list) });
    }
    for (const [key, list] of byAgent) {
      result.push({ key: `agent:${key}`, label: AI_TEAMMATE_LABEL[key as AiTeammateKey] || key, kind: "agent", tasks: list, ...bucket(list) });
    }
    if (unassigned.length > 0) {
      result.push({ key: "unassigned", label: "Unassigned", kind: "unassigned", tasks: unassigned, ...bucket(unassigned) });
    }

    return result.sort((a, b) => b.overdue - a.overdue || b.tasks.length - a.tasks.length);
  }, [tasks, staff]);

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="font-serif text-2xl">Team Capacity</h1>
          <p className="text-sm text-muted-foreground">Open work across every staff member and AI Teammate, at a glance.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-12 text-center">
            <Users className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No open tasks right now.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="flex-1">Assignee</span>
              <span className="w-16 text-right">Total</span>
              <span className="w-16 text-right">Overdue</span>
              <span className="w-20 text-right">This week</span>
              <span className="w-16 text-right">No date</span>
              <span className="w-4" />
            </div>
            {rows.map((row) => {
              const expanded = expandedKey === row.key;
              return (
                <div key={row.key}>
                  <ListRowStatic
                    className="cursor-pointer"
                    onClick={() => setExpandedKey(expanded ? null : row.key)}
                  >
                    <span className="flex flex-1 items-center gap-2 min-w-0">
                      {row.kind === "agent" ? (
                        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      )}
                      <span className="truncate font-medium">{row.label}</span>
                    </span>
                    <span className="w-16 text-right tabular-nums">{row.tasks.length}</span>
                    <span className={cn("w-16 text-right tabular-nums", row.overdue > 0 && "font-semibold text-destructive")}>
                      {row.overdue}
                    </span>
                    <span className="w-20 text-right tabular-nums">{row.dueThisWeek}</span>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">{row.noDueDate}</span>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                  </ListRowStatic>
                  {expanded && (
                    <div className="space-y-1.5 border-b border-border bg-muted/10 p-3">
                      {row.tasks.map((task) => (
                        <div key={task.id} className="rounded-md border border-border bg-background p-3">
                          <p className="mb-1 text-sm font-medium">{task.title}</p>
                          <TaskDetailPanel task={task} onChanged={handleTaskChanged} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
