import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { supabase } from "@/shared/integrations/supabase/client";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmProject, PmTask } from "@/shared/lib/agents";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Loader2, ChevronLeft, ChevronDown, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { AddTaskForm } from "../components/AddTaskForm";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { cn } from "@/shared/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  open: "bg-secondary text-secondary-foreground",
  in_progress: "bg-primary/15 text-primary",
  done: "bg-emerald-500/15 text-emerald-600",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<PmProject | null>(null);
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTasks = async () => {
    if (!id) return;
    const data = await getTaskAgent().listTasks({ project_id: id });
    setTasks(data.filter((t) => !t.parent_task_id));
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      supabase.from("pm_projects").select("*").eq("id", id).maybeSingle().then(({ data }) => setProject(data as PmProject)),
      loadTasks(),
    ]).finally(() => setLoading(false));
  }, [id]);

  const handleTaskChanged = (updated: PmTask) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-muted-foreground">Project not found.</div>
      </AppLayout>
    );
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const ordered = [...open, ...done];

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3.5 w-3.5" /> Projects
            </Link>
            <h1 className="font-serif text-2xl">{project.name}</h1>
            {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
          </div>
        </div>

        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <AddTaskForm projectId={project.id} onCreated={loadTasks} />

            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet. Add the first one above.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden w-[110px] sm:table-cell">Due date</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordered.map((task) => (
                    <Fragment key={task.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                      >
                        <TableCell className="w-8 pr-0">
                          {expandedId === task.id ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {task.status === "done" ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            ) : (
                              <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className={cn("text-sm", task.status === "done" && "text-muted-foreground line-through")}>
                              {task.title}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                          {task.due_date || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[task.status] || ""} variant="secondary">
                            {task.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {expandedId === task.id && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/20 p-4">
                            <TaskDetailPanel task={task} onChanged={handleTaskChanged} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
