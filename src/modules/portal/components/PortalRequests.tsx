import { useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { ClipboardList, Send, Loader2, MessageCircle, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { LinkifyText } from "@/shared/components/LinkifyText";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface Message {
  id: string;
  sender_type: "advisor" | "client";
  sender_name: string | null;
  content: string;
  created_at: string;
}

interface PortalRequest {
  id: string;
  request_type: string;
  request_description: string;
  status: string;
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

export const TYPE_LABELS: Record<string, string> = {
  banking_withdrawal: "Banking & Withdrawals",
  personal_info: "Personal Info",
  document_request: "Document Request",
  data_access: "My Data — Access Request",
  general_inquiry: "General Inquiry",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  submitted: { label: "Submitted", variant: "default" },
  in_progress: { label: "In Progress", variant: "destructive" },
  resolved: { label: "Resolved", variant: "secondary" },
};

interface Props {
  requests: PortalRequest[];
  contactId: string;
  contactName: string;
  portalToken: string;
  onUpdate?: () => void;
}

export function PortalRequests({ requests, contactId, contactName, portalToken, onUpdate }: Props) {
  const [selected, setSelected] = useState<PortalRequest | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const sendReply = async () => {
    if (!replyText.trim() || !selected || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/portal-request-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: selected.id,
          content: replyText.trim(),
          sender_type: "client",
          sender_name: contactName,
          portal_token: portalToken,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setReplyText("");
      // Refresh data
      onUpdate?.();
      // Update local state optimistically
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...(prev.messages || []),
                {
                  id: crypto.randomUUID(),
                  sender_type: "client" as const,
                  sender_name: contactName,
                  content: replyText.trim(),
                  created_at: new Date().toISOString(),
                },
              ],
            }
          : null
      );
    } catch {
      // silent fail
    } finally {
      setSending(false);
    }
  };

  const openRequests = requests.filter((r) => r.status !== "resolved");
  const resolvedRequests = requests.filter((r) => r.status === "resolved");

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">No requests submitted yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Use "Ask Georgia for Help" to submit a request to your Personal CFO.
        </p>
      </div>
    );
  }

  const hasUnread = (req: PortalRequest) =>
    (req.messages || []).some((m) => m.sender_type === "advisor");

  return (
    <>
      <div className="space-y-3">
        {openRequests.length > 0 && (
          <div className="space-y-2">
            {openRequests.map((req) => {
              const sc = STATUS_CONFIG[req.status] || STATUS_CONFIG.submitted;
              const advisorMessages = (req.messages || []).filter((m) => m.sender_type === "advisor");
              return (
                <button
                  key={req.id}
                  onClick={() => setSelected(req)}
                  className="w-full text-left rounded-md border border-border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {TYPE_LABELS[req.request_type] || req.request_type}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {req.request_description}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={sc.variant} className="text-[10px]">{sc.label}</Badge>
                      {advisorMessages.length > 0 && (
                        <Badge variant="destructive" className="text-[10px]">
                          <MessageCircle className="h-2.5 w-2.5 mr-0.5" />
                          {advisorMessages.length} reply
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {resolvedRequests.length > 0 && (
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-2">
              Resolved ({resolvedRequests.length})
            </summary>
            <div className="space-y-2 mt-2">
              {resolvedRequests.map((req) => (
                <button
                  key={req.id}
                  onClick={() => setSelected(req)}
                  className="w-full text-left rounded-md border border-border p-3 hover:bg-muted/50 transition-colors opacity-60"
                >
                  <p className="text-sm font-medium text-foreground">
                    {TYPE_LABELS[req.request_type] || req.request_type}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Resolved · {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                  </p>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
            <DialogTitle className="font-serif text-base">
              {selected ? TYPE_LABELS[selected.request_type] || selected.request_type : "Request"}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Original request */}
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Your request</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{selected.request_description}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {format(new Date(selected.created_at), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>

                {/* Messages */}
                {(selected.messages || [])
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                  .map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender_type === "client" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          msg.sender_type === "client"
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <p className="text-[10px] font-medium mb-0.5 opacity-70">
                          {msg.sender_type === "advisor" ? "Your Personal CFO" : "You"}
                        </p>
                        <p className="whitespace-pre-wrap"><LinkifyText text={msg.content} /></p>
                        <p className="text-[9px] opacity-50 mt-1">
                          {format(new Date(msg.created_at), "MMM d, h:mm a")}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Reply input (only for open requests) */}
              {selected.status !== "resolved" && (
                <div className="border-t border-border px-4 py-3 flex gap-2">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    disabled={sending}
                    className="flex-1 min-h-[40px] max-h-[100px] text-sm resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  <Button size="icon" onClick={sendReply} disabled={sending || !replyText.trim()}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
