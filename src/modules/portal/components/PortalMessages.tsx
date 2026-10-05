import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Card } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Send, MessageSquare } from "lucide-react";

interface PortalMessagesProps {
  portalToken: string;
  contactName: string;
}

interface Msg {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  occurred_at: string;
  pii_blocked: boolean;
  pii_block_reason: string | null;
}

export function PortalMessages({ portalToken, contactName }: PortalMessagesProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("portal-sms", {
        body: { action: "list", portal_token: portalToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages(data?.messages || []);
    } catch (err: any) {
      toast.error(`Couldn't load messages: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalToken]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("portal-sms", {
        body: { action: "send", portal_token: portalToken, content: draft.trim() },
      });
      if (error) throw error;
      if (data?.blocked) {
        toast.error(`Blocked: ${data.reason}`, {
          description: "Please avoid sharing financial figures or sensitive personal data over text. Use Requests for those.",
        });
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        toast.success("Message sent");
        setDraft("");
        load();
      }
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  // Display: client = inbound (right, gold). Staff = outbound (left, muted).
  const ordered = [...messages].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-accent" />
        <h3 className="font-serif text-lg">Direct Messages</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Please send a quick text for non-support related messages. Note that this is not a secure
        connection, so please do not send confidential or sensitive information like account numbers
        or health details. For those items, please <strong>Ask Georgia for Help</strong> instead, as these
        messages are filtered for privacy, and will not be received.
      </p>

      {/* Thread */}
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 border-t border-border pt-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && ordered.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No messages yet. Say hello below.</p>
        )}
        {ordered.map((m) => {
          const isClient = m.direction === "inbound";
          return (
            <div key={m.id} className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg p-3 text-sm ${
                  isClient
                    ? "bg-accent/15 border border-accent/30"
                    : "bg-muted border border-border"
                }`}
              >
                <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                  <span>{isClient ? contactName || "You" : "ProsperWise"}</span>
                  <span>· {new Date(m.occurred_at).toLocaleString()}</span>
                  {m.pii_blocked && (
                    <Badge variant="destructive" className="text-[10px]">BLOCKED</Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.pii_blocked && m.pii_block_reason && (
                  <p className="text-xs text-destructive mt-1">{m.pii_block_reason}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="space-y-2 border-t border-border pt-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          disabled={sending}
          className="min-h-[80px]"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            🛡️ Privacy filter active
          </p>
          <Button onClick={send} disabled={!draft.trim() || sending} size="sm">
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1" />
            )}
            Send
          </Button>
        </div>
      </div>
    </Card>
  );
}
