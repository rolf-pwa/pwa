import { CommentBody } from "@/shared/components/CommentBody";
import { SystemCommentLine } from "@/shared/components/SystemCommentLine";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Send, Loader2, MessageCircle, CheckCircle2, Circle, ListChecks, ChevronRight, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { toast } from "@/shared/hooks/use-toast";
import { parseLocalDate } from "@/shared/lib/date-utils";
import { cn } from "@/shared/lib/utils";

interface Comment {
  id: string;
  body: string;
  body_format?: "text" | "html";
  kind?: "comment" | "system";
  edited_at?: string | null;
  author_type: "staff" | "client";
  author_name: string;
  created_at: string;
}

interface Subtask {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  due_date: string | null;
}

interface Props {
  taskId: string;
  portalToken: string;
  clientName?: string;
  readOnly?: boolean;
}

export function PortalTaskConversation({ taskId, portalToken, clientName, readOnly }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [expandedSubtask, setExpandedSubtask] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      const [commentsRes, subtasksRes] = await Promise.all([
        supabase.functions.invoke("portal-pm-tasks", {
          body: { action: "comments", task_id: taskId, portal_token: portalToken },
        }),
        supabase.functions.invoke("portal-pm-tasks", {
          body: { action: "subtasks", task_id: taskId, portal_token: portalToken },
        }),
      ]);
      if (commentsRes.data?.comments) {
        setComments(commentsRes.data.comments);
      }
      if (subtasksRes.data?.tasks) {
        setSubtasks(subtasksRes.data.tasks);
      }
    } catch (e) {
      console.error("Failed to load task data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setComments([]);
    setSubtasks([]);
    fetchData();
  }, [taskId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending) return;
    if (text.length > 5000) {
      toast({ title: "Message too long", description: "Please keep your message under 5,000 characters.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const res = await supabase.functions.invoke("portal-pm-tasks", {
        body: { action: "postComment", task_id: taskId, body: text, portal_token: portalToken },
      });
      if (res.data?.error) {
        toast({ title: "Error", description: res.data.error, variant: "destructive" });
      } else {
        setMessage("");
        await fetchData();
      }
    } catch {
      toast({ title: "Error", description: "Failed to send message.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Subtasks */}
      {subtasks.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Subtasks ({subtasks.filter(s => s.status === "done").length}/{subtasks.length})
            </span>
          </div>
          <ul className="space-y-1">
            {subtasks.map((st) => {
              const isExpanded = expandedSubtask === st.id;
              const isDone = st.status === "done";
              return (
                <li key={st.id}>
                  <button
                    onClick={() => setExpandedSubtask(isExpanded ? null : st.id)}
                    className="w-full flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted/50 transition-colors text-left group"
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={cn("truncate", isDone && "line-through text-muted-foreground")}>
                      {st.title}
                    </span>
                    {st.due_date && !isDone && (
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                        {parseLocalDate(st.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    <ChevronRight className={cn(
                      "h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform ml-auto",
                      isExpanded ? "rotate-90" : "opacity-0 group-hover:opacity-100"
                    )} />
                  </button>
                  {isExpanded && (
                    <div className="ml-6 mt-1 mb-2 rounded-lg border border-border bg-background p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-semibold text-foreground">{st.title}</h5>
                        <button onClick={() => setExpandedSubtask(null)} className="p-0.5 rounded hover:bg-muted">
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </div>
                      <PortalTaskConversation
                        taskId={st.id}
                        portalToken={portalToken}
                        clientName={clientName}
                        readOnly={readOnly || isDone}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Chat Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageCircle className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No messages yet. Start the conversation below.
            </p>
          </div>
        ) : (
        comments.map((comment) => {
            const isClient = comment.author_type === "client";
            return (
              comment.kind === "system" ? <SystemCommentLine key={comment.id} body={comment.body} at={comment.created_at} /> :
              <div key={comment.id} className="flex flex-col gap-1">
                <div className={`flex items-center gap-2 ${isClient ? 'justify-end' : ''}`}>
                  <span className="text-xs font-semibold text-foreground">
                    {comment.author_name}
                  </span>
                  {comment.edited_at && <span className="text-[10px] italic text-muted-foreground">edited</span>}
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(comment.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed max-w-[90%] break-words ${
                  isClient
                    ? 'bg-accent/10 border border-accent/30 text-foreground ml-auto'
                    : 'bg-muted border border-border text-foreground'
                }`}>
                  <CommentBody body={comment.body} format={comment.body_format} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Message Input */}
      {readOnly ? (
        <div className="border-t border-border px-4 py-3 bg-muted/50">
          <p className="text-xs text-muted-foreground text-center">This task is completed. Comments are closed.</p>
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3 bg-background">
          <div className="flex gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Send a message…"
              className="min-h-[44px] max-h-[120px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              size="icon"
              className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground h-[44px] w-[44px]"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
