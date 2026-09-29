import { useEffect, useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import { Card } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible";
import { toast } from "sonner";
import { Loader2, Send, Phone, MessageSquare, RefreshCw, ChevronDown } from "lucide-react";
import LinkQuoToContactButton from "@/modules/crm/components/LinkQuoToContactButton";

interface QuoCommunicationsProps {
  contactId: string;
  contactPhone: string | null;
  contactName: string;
}

interface QuoMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  occurred_at: string;
  portal_visible: boolean;
  pii_blocked: boolean;
  pii_block_reason: string | null;
}

interface QuoCall {
  id: string;
  direction: "inbound" | "outbound";
  duration_seconds: number;
  recording_url: string | null;
  summary: string | null;
  transcript: string | null;
  next_steps: string | null;
  occurred_at: string;
  portal_visible: boolean;
  is_voicemail?: boolean;
  voicemail_url?: string | null;
}

export default function QuoCommunications({ contactId, contactPhone, contactName }: QuoCommunicationsProps) {
  const [messages, setMessages] = useState<QuoMessage[]>([]);
  const [calls, setCalls] = useState<QuoCall[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [msgRes, callRes] = await Promise.all([
        supabase.functions.invoke("quo-service", {
          body: { action: "listMessages", contactId },
        }),
        supabase.functions.invoke("quo-service", {
          body: { action: "listCalls", contactId },
        }),
      ]);
      setMessages(msgRes.data?.messages || []);
      setCalls(callRes.data?.calls || []);
    } catch (err: any) {
      toast.error(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`quo-${contactId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "quo_messages", filter: `contact_id=eq.${contactId}` },
        () => load())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "quo_calls", filter: `contact_id=eq.${contactId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const sendSms = async () => {
    if (!draft.trim()) return;
    if (!contactPhone) {
      toast.error("Contact has no phone number");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("quo-service", {
        body: { action: "sendSms", contactId, to: contactPhone, content: draft.trim() },
      });
      // supabase-js raises FunctionsHttpError on non-2xx; parse the body so
      // PII Shield blocks (422) surface their real reason instead of a
      // generic "Send failed".
      if (error) {
        let parsed: any = null;
        try { parsed = await (error as any).context?.response?.json?.(); } catch {}
        if (parsed?.blocked) {
          toast.error(`PII Shield blocked: ${parsed.reason}`, {
            description: "Rephrase without dollar amounts, account numbers, or health terms — or use the ProsperWise Portal for sensitive details.",
          });
          load();
          return;
        }
        if (parsed?.error) {
          // A real, well-formed error from quo-service itself -- the send
          // attempt is recorded (status: 'failed') and safe to just retry.
          throw new Error(parsed.error);
        }
        // The response body wasn't parseable JSON at all -- quo-service
        // always returns valid JSON from both its validation and its
        // catch-all, so this means the invocation itself was killed
        // (platform timeout/crash) before it could respond. We genuinely
        // can't tell whether OpenPhone still processed the send.
        load();
        toast.warning("Couldn't confirm this was sent", {
          description: "The connection was interrupted before we got a response. Check Quo directly before resending, to avoid a duplicate.",
        });
        return;
      }
      if (data?.blocked) {
        toast.error(`PII Shield blocked: ${data.reason}`, {
          description: "Rephrase without dollar amounts, account numbers, or health terms — or use the Sovereign Portal for sensitive details.",
        });
      } else {
        toast.success("SMS sent");
        setDraft("");
      }
      load();
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };


  const syncContact = async () => {
    try {
      const { error } = await supabase.functions.invoke("quo-service", {
        body: { action: "syncContact", contactId },
      });
      if (error) throw error;
      toast.success("Contact synced");
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    }
  };

  // Merge into a single chronological timeline (oldest first, like a chat)
  const timeline = [
    ...messages.map((m) => ({ kind: "msg" as const, at: m.occurred_at, item: m })),
    ...calls.map((c) => ({ kind: "call" as const, at: c.occurred_at, item: c })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <Card className="p-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left hover:opacity-80">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
            <MessageSquare className="h-4 w-4 text-amber-500" />
            <h3 className="font-serif text-base">SMS &amp; Voice</h3>
            {timeline.length > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1">{timeline.length}</Badge>
            )}
          </CollapsibleTrigger>
          {open && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={syncContact} title="Sync contact" className="h-7 px-2">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={load} className="h-7 px-2 text-xs">Refresh</Button>
            </div>
          )}
        </div>

        <CollapsibleContent className="space-y-3 mt-3">
          {/* Chat thread */}
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 border-t border-border pt-3">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && timeline.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No SMS or call history yet.</p>
            )}
            {timeline.map((entry) => entry.kind === "msg" ? (
              <MessageRow key={`m-${entry.item.id}`} m={entry.item} primaryContactId={contactId} />
            ) : (
              <CallRow key={`c-${entry.item.id}`} c={entry.item} primaryContactId={contactId} />
            ))}
          </div>

          {/* Composer at bottom (chat-style) */}
          <div className="space-y-2 border-t border-border pt-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={contactPhone
                ? `Message ${contactName} · ${contactPhone}`
                : "Contact has no phone number"}
              disabled={!contactPhone || sending}
              className="min-h-[60px] text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                🛡️ PII Shield active
              </p>
              <Button onClick={sendSms} disabled={!draft.trim() || !contactPhone || sending} size="sm">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                Send SMS
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function MessageRow({ m, primaryContactId }: { m: QuoMessage; primaryContactId: string }) {
  const isOut = m.direction === "outbound";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg p-3 text-sm ${
        isOut ? "bg-amber-500/10 border border-amber-500/30" : "bg-muted"
      }`}>
        <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
          <MessageSquare className="h-3 w-3" />
          <span>{isOut ? "Sent" : "Received"}</span>
          <span>· {new Date(m.occurred_at).toLocaleString()}</span>
          {m.pii_blocked && <Badge variant="destructive" className="text-[10px]">PII BLOCKED</Badge>}
          {m.status && m.status !== "sent" && m.status !== "received" && (
            <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
          )}
          <LinkQuoToContactButton quoMessageId={m.id} excludeContactId={primaryContactId} />
        </div>
        <p className="whitespace-pre-wrap">{m.body}</p>
        {m.pii_blocked && m.pii_block_reason && (
          <p className="text-xs text-destructive mt-1">Blocked: {m.pii_block_reason}</p>
        )}
      </div>
    </div>
  );
}

function CallRow({ c, primaryContactId }: { c: QuoCall; primaryContactId: string }) {
  const mins = Math.floor(c.duration_seconds / 60);
  const secs = c.duration_seconds % 60;
  return (
    <div className={`rounded-lg border p-3 text-sm space-y-2 ${
      c.is_voicemail ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"
    }`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Phone className="h-3 w-3 text-amber-500" />
        {c.is_voicemail ? (
          <Badge className="text-[10px] bg-amber-500 text-amber-950 hover:bg-amber-500">Voicemail</Badge>
        ) : (
          <span>{c.direction === "inbound" ? "Incoming call" : "Outgoing call"}</span>
        )}
        <span>· {mins}m {secs}s</span>
        <span>· {new Date(c.occurred_at).toLocaleString()}</span>
        <div className="ml-auto"><LinkQuoToContactButton quoCallId={c.id} excludeContactId={primaryContactId} /></div>
      </div>
      {c.summary && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">AI Summary</p>
          <p className="whitespace-pre-wrap">{c.summary}</p>
        </div>
      )}
      {c.next_steps && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Next Steps</p>
          <p className="whitespace-pre-wrap text-amber-600 dark:text-amber-400">{c.next_steps}</p>
        </div>
      )}
      {c.transcript && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">View transcript</summary>
          <pre className="whitespace-pre-wrap mt-2 max-h-60 overflow-y-auto">{c.transcript}</pre>
        </details>
      )}
      {c.voicemail_url && (
        <audio controls src={c.voicemail_url} className="w-full h-8" preload="none" />
      )}
      {c.recording_url && !c.voicemail_url && (
        <a href={c.recording_url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-amber-500 hover:underline">▶ Listen to recording</a>
      )}
    </div>
  );
}
