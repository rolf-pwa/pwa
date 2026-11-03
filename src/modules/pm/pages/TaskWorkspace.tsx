import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ListTodo, Loader2, Pencil, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/AppLayout";
import { useAuth } from "@/shared/hooks/useAuth";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmProject, PmTask } from "@/shared/lib/agents";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { TaskDetailPanel } from "@/modules/pm/components/TaskDetailPanel";
import { resolveTaskEntityLinks, type TaskEntityLink } from "@/modules/pm/lib/taskEntityLinks";
import { BUCKETS, BUCKET_LABEL, bucketCounts, bucketOf, byDue, inScope, matchesSearch, openTasks, resolveSelected, type Bucket, type Scope } from "@/modules/pm/lib/taskWorkspace";

const SCOPE_LABEL: Record<Scope, string> = { mine: "My tasks", georgia: "Georgia's tasks", everyone: "Everyone's tasks" };
const todayString = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dueText = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

/** The open task's title: click it to rename; Enter or leaving the box saves, Escape puts it back. */
function EditableTitle({ task, onSaved }: { task: PmTask; onSaved: (t: PmTask) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(task.title); setEditing(false); }, [task.id, task.title]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === task.title) { setValue(task.title); setEditing(false); return; }
    setSaving(true);
    try {
      const updated = await getTaskAgent().updateTask(task.id, { title: next });
      onSaved({ ...task, ...updated, title: next });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename the task.");
      setValue(task.title);
      setEditing(false);
    } finally { setSaving(false); }
  };
  if (editing) {
    return (
      <Input autoFocus value={value} disabled={saving} aria-label="Task title" data-testid="task-title-input" className="h-9 text-lg font-semibold"
        onChange={(e) => setValue(e.target.value)} onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape") { setValue(task.title); setEditing(false); } }} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Click to rename" data-testid="task-title" className="group flex w-full items-start gap-2 rounded text-left hover:bg-muted/50">
      <h2 className="text-lg font-semibold">{task.title}</h2>
      <Pencil className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export default function TaskWorkspace() {
  const { user } = useAuth();
  const phone = useIsMobile();
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState<PmTask[]>([]);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, TaskEntityLink>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const [bucket, setBucket] = useState<Bucket>("overdue");
  const [search, setSearch] = useState("");
  const today = todayString();
  const selectedId = params.get("task");

  const load = useCallback(async () => {
    try {
      const [tasks, projs] = await Promise.all([getTaskAgent().listTasks(), getTaskAgent().listProjects()]);
      const names: Record<string, string> = {};
      for (const p of projs as PmProject[]) names[p.id] = p.name;
      setProjects(names);
      setAll(tasks);
      setLinks(await resolveTaskEntityLinks(openTasks(tasks)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the tasks.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => resolveSelected(all, selectedId), [all, selectedId]);
  const mine = useMemo(() => openTasks(all).filter((t) => inScope(t, scope, user?.id ?? null)), [all, scope, user?.id]);
  const extra = (t: PmTask) => [t.project_id ? projects[t.project_id] ?? "" : "", links[t.id]?.label ?? ""];
  const searched = useMemo(() => mine.filter((t) => matchesSearch(t, search, extra(t))), [mine, search, projects, links]);
  const counts = useMemo(() => bucketCounts(searched, today), [searched, today]);
  const shown = useMemo(() => searched.filter((t) => bucketOf(t, today) === bucket).sort(byDue), [searched, bucket, today]);

  // A link to a task opens it on its own group and scope, so what was clicked is on screen.
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== "done") {
      setBucket(bucketOf(selected, today));
      if (!inScope(selected, scope, user?.id ?? null)) setScope(selected.assigned_agent_key === "georgia" ? "georgia" : "everyone");
    }
    // only when the linked task first resolves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const open = (id: string | null) => setParams((p) => { const q = new URLSearchParams(p); if (id) q.set("task", id); else q.delete("task"); return q; }, { replace: true });
  const changed = (t: PmTask) => {
    setAll((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    if (t.status === "done") { toast.success("Task closed"); open(null); }
  };
  const deleted = (id: string) => { setAll((prev) => prev.filter((t) => t.id !== id && t.parent_task_id !== id)); open(null); };

  const list = (
    <div className="space-y-1.5" data-testid="task-list">
      {shown.map((t) => {
        const isOpen = selected?.id === t.id;
        const b = bucketOf(t, today);
        const project = t.project_id ? projects[t.project_id] : null;
        return (
          <button key={t.id} type="button" onClick={() => open(t.id)} data-testid="task-row" aria-current={isOpen ? "true" : undefined}
            className={cn("flex w-full flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50", isOpen && "border-accent/40 bg-muted/60", b === "today" && !isOpen && "border-l-2 border-l-amber-500")}>
            <span className="text-sm font-medium">{t.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {t.due_date && <span className={cn(b === "overdue" && "font-medium text-destructive", b === "today" && "font-semibold text-amber-600")}>{b === "today" ? "Today" : dueText(t.due_date)}</span>}
              {project && <span className="text-accent">{project}</span>}
              {links[t.id] && <span className="text-sanctuary-bronze">{links[t.id].label}</span>}
              {t.assigned_agent_key === "georgia" && <span>Georgia</span>}
            </span>
          </button>
        );
      })}
      {shown.length === 0 && !loading && <p className="py-8 text-center text-sm text-muted-foreground">{search ? "No task matches." : `Nothing ${bucket === "none" ? "without a date" : BUCKET_LABEL[bucket].toLowerCase()}.`}</p>}
    </div>
  );

  const detail = selected ? (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="task-detail">
      {phone && <Button variant="ghost" size="sm" onClick={() => open(null)}><ArrowLeft className="mr-1 h-4 w-4" />Back to the list</Button>}
      <div>
        <EditableTitle task={selected} onSaved={changed} />
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {selected.project_id && projects[selected.project_id] && <span className="text-accent">{projects[selected.project_id]}</span>}
          {links[selected.id] && <a href={links[selected.id].to} className="text-sanctuary-bronze hover:underline">{links[selected.id].label}</a>}
        </p>
      </div>
      <TaskDetailPanel key={selected.id} task={selected} onChanged={changed} onDeleted={deleted} />
    </div>
  ) : (
    <div className="hidden rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground lg:block" data-testid="task-empty">Pick a task to open it here: its details, subtasks, comments and who it is with.</div>
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ListTodo className="h-7 w-7 text-amber-500" />
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Tasks</h1>
              <p className="hidden text-sm text-muted-foreground sm:block">Open a task to work on it here, without leaving the list</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <SelectItem key={s} value={s}>{SCOPE_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading</div>}

        {!loading && !error && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
                <TabsList className="flex h-auto w-full justify-start overflow-x-auto sm:inline-flex sm:w-auto" data-testid="task-tabs">
                  {BUCKETS.map((b) => <TabsTrigger key={b} value={b} className={cn(b === "overdue" && counts.overdue > 0 && "data-[state=active]:text-destructive")}>{BUCKET_LABEL[b]} ({counts[b]})</TabsTrigger>)}
                </TabsList>
              </Tabs>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search tasks, projects, clients…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
              {(!phone || !selected) && <div className="lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:pr-1">{list}</div>}
              {(!phone || selected) && <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">{detail}</div>}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
