import { CommentBody } from "@/shared/components/CommentBody";
import { commentPlainText } from "@/shared/lib/sanitizeHtml";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Input } from "@/shared/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, Circle, MessageSquare, Plus, ChevronDown, ChevronRight, Loader2, Home, Download } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { FN, proFetch } from "./ProPortalShell";

interface TaskContext { label: string; path: string }
interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  updated_at: string;
  context?: TaskContext | null;
}
interface Comment { id: string; body: string; body_format?: "text" | "html"; author_type: "staff" | "client" | "pro"; author_name: string; created_at: string }

interface Props {
  scopeType: "family" | "household" | "contact" | "portfolio";
  scopeId?: string;
  title?: string;
}

export default function ProTasksPanel({ scopeType, scopeId, title }: Props) {
  const isPortfolio = scopeType === "portfolio";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [composer, setComposer] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [printingTask, setPrintingTask] = useState<Task | null>(null);

  useEffect(() => {
    if (!printingTask) return;
    const afterPrint = () => setPrintingTask(null);
    window.addEventListener("afterprint", afterPrint);
    const timer = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [printingTask]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(FN.tasks, proFetch({ action: "list", scope_type: scopeType, scope_id: scopeId }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTasks(data.tasks || []);
    } catch (e: any) {
      toast.error(e.message || "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, [scopeType, scopeId]);

  useEffect(() => { load(); }, [load]);

  async function toggleExpand(t: Task) {
    if (expanded === t.id) { setExpanded(null); return; }
    setExpanded(t.id);
    if (!comments[t.id]) {
      try {
        const res = await fetch(FN.tasks, proFetch({ action: "comments", task_id: t.id }));
        const data = await res.json();
        if (res.ok) setComments((s) => ({ ...s, [t.id]: data.comments || [] }));
      } catch {/* noop */}
    }
  }

  async function comment(t: Task) {
    const text = (composer[t.id] || "").trim();
    if (!text) return;
    setSending(t.id);
    try {
      const res = await fetch(FN.tasks, proFetch({ action: "postComment", task_id: t.id, body: text }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setComposer((c) => ({ ...c, [t.id]: "" }));
      setComments((prev) => ({ ...prev, [t.id]: [...(prev[t.id] || []), data.comment] }));
    } catch (e: any) {
      toast.error(e.message || "Comment failed");
    } finally {
      setSending(null);
    }
  }

  async function complete(t: Task) {
    const nowDone = t.status !== "done";
    try {
      const res = await fetch(FN.tasks, proFetch({ action: "complete", task_id: t.id, completed: nowDone }));
      if (!res.ok) throw new Error();
      setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, status: nowDone ? "done" : "open" } : x));
      toast.success(nowDone ? "Marked complete" : "Reopened");
    } catch {
      toast.error("Could not update task");
    }
  }

  async function createTask() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(FN.tasks, proFetch({ action: "create", scope_type: scopeType, scope_id: scopeId, title: newTitle.trim(), notes: newNotes.trim() }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Task opened — ProsperWise notified");
      setNewOpen(false);
      setNewTitle("");
      setNewNotes("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Could not create task");
    } finally {
      setCreating(false);
    }
  }

  const filtered = tasks.filter((t) => tab === "open" ? t.status !== "done" : t.status === "done");

  return (
    <Card className="border-accent/20">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="font-serif text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-accent" /> {title || "Workflow Tasks"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs">
              <button
                onClick={() => setTab("open")}
                className={`px-3 py-1 rounded ${tab === "open" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >Open</button>
              <button
                onClick={() => setTab("done")}
                className={`px-3 py-1 rounded ${tab === "done" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >Done</button>
            </div>
            {!isPortfolio && (
              <Button size="sm" variant="outline" onClick={() => setNewOpen((v) => !v)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New task
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {newOpen && (
          <div className="space-y-2 border border-accent/25 bg-accent/[0.03] rounded-md p-3">
            <Input
              placeholder="Task title (e.g. Draft trust amendment)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <Textarea
              rows={3}
              placeholder="Context / next steps (avoid SIN, account numbers, balances)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={createTask} disabled={creating || !newTitle.trim()} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Open task"}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            {tab === "open" ? "No open tasks assigned to you here yet." : "No completed tasks."}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((t) => {
              const isExpanded = expanded === t.id;
              const isDone = t.status === "done";
              return (
                <li key={t.id} className="border border-border/60 rounded-md overflow-hidden bg-card">
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      onClick={() => complete(t)}
                      className="mt-0.5 text-muted-foreground hover:text-accent transition-colors"
                      title={isDone ? "Reopen" : "Mark complete"}
                    >
                      {isDone ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <Circle className="h-4 w-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => toggleExpand(t)} className="w-full text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {t.title}
                          </span>
                          {t.due_date && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              due {format(new Date(t.due_date), "MMM d")}
                            </span>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">
                          Updated {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                        </span>
                        {t.context && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <Link
                              to={t.context.path}
                              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                            >
                              <Home className="h-3 w-3" />
                              {t.context.label}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => toggleExpand(t)} className="text-muted-foreground shrink-0">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border/60 bg-muted/20 px-3 py-3 space-y-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setPrintingTask(t)}
                        >
                          <Download className="h-3 w-3 mr-1" /> Download PDF
                        </Button>
                      </div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">{t.description}</div>
                      )}
                      <div className="space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" /> Comments
                        </div>
                        {(comments[t.id] || []).length === 0 ? (
                          <div className="text-xs text-muted-foreground italic">No comments yet.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {(comments[t.id] || []).map((c) => {
                              const isMine = c.author_type === "pro";
                              return (
                                <div key={c.id} className="flex flex-col gap-0.5">
                                  <div className={`flex items-center gap-2 ${isMine ? "justify-end" : ""}`}>
                                    <span className="text-[10px] font-semibold text-foreground">{c.author_name}</span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {format(new Date(c.created_at), "PP p")}
                                    </span>
                                  </div>
                                  <div
                                    className={`rounded px-2 py-1.5 text-xs break-words max-w-[90%] ${
                                      isMine
                                        ? "bg-accent/10 border border-accent/30 text-foreground ml-auto"
                                        : "bg-card border border-border/60 text-foreground"
                                    }`}
                                  >
                                    <CommentBody body={c.body} format={c.body_format} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Textarea
                          rows={2}
                          placeholder="Add a comment…"
                          value={composer[t.id] || ""}
                          onChange={(e) => setComposer((c) => ({ ...c, [t.id]: e.target.value }))}
                          className="text-xs"
                        />
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => comment(t)}
                            disabled={sending === t.id || !(composer[t.id] || "").trim()}
                            className="bg-accent hover:bg-accent/90 text-accent-foreground"
                          >
                            {sending === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Post"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {printingTask && createPortal(
        <div id="pw-task-print-root">
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #pw-task-print-root, #pw-task-print-root * { visibility: visible; }
              #pw-task-print-root { position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
              @page { size: A4 portrait; margin: 16mm; }
            }
            @media screen {
              #pw-task-print-root { display: none; }
            }
          `}</style>
          <h1 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>{printingTask.title}</h1>
          <p style={{ fontSize: "11px", color: "#666", marginBottom: "16px" }}>
            {printingTask.context ? `${printingTask.context.label} · ` : ""}
            Status: {printingTask.status === "done" ? "Done" : "Open"}
            {printingTask.due_date ? ` · Due ${format(new Date(printingTask.due_date), "MMM d, yyyy")}` : ""}
            {" · Exported "}{format(new Date(), "MMM d, yyyy 'at' p")}
          </p>
          {printingTask.description && (
            <p style={{ fontSize: "12px", whiteSpace: "pre-wrap", marginBottom: "16px" }}>{printingTask.description}</p>
          )}
          <h2 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Conversation</h2>
          {(comments[printingTask.id] || []).length === 0 ? (
            <p style={{ fontSize: "12px", color: "#666" }}>No comments.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {(comments[printingTask.id] || []).map((c) => (
                <div key={c.id} style={{ borderBottom: "1px solid #ddd", paddingBottom: "8px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 700, marginBottom: "2px" }}>
                    {c.author_name} <span style={{ fontWeight: 400, color: "#666" }}>{format(new Date(c.created_at), "PP p")}</span>
                  </p>
                  <p style={{ fontSize: "12px", whiteSpace: "pre-wrap" }}>{commentPlainText(c.body, c.body_format)}</p>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </Card>
  );
}
