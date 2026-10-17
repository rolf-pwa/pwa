import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Send, Loader2, MessageCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { PortalAdminRequestForm } from "./PortalAdminRequestForm";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type Message = { role: "user" | "assistant" | "advisor"; content: string };

const POLL_MS = 30_000;

interface FormTrigger {
  requestType: string;
  prefillDescription: string;
}

export interface BookableMeeting { label: string; url: string; embedUrl: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName?: string;
  contactId?: string;
  portalToken?: string;
  onRequestSubmitted?: () => void;
  /** Meetings this person can book now, and ones already booked, as the portal page has them. */
  meetingTypes?: BookableMeeting[];
  bookedMeetings?: { label: string; start: string }[];
  onOpenBooking?: (m: BookableMeeting) => void;
}

export function PortalGeorgiaChat({ open, onOpenChange, contactName, contactId, portalToken, onRequestSubmitted, meetingTypes = [], bookedMeetings = [], onOpenBooking }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [formTrigger, setFormTrigger] = useState<FormTrigger | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [offered, setOffered] = useState<BookableMeeting[]>([]);
  const [advisorActive, setAdvisorActive] = useState(false);
  const serverCount = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const greeting: Message = {
    role: "assistant",
    content: `Hello${contactName ? ` ${contactName}` : ""}! I'm Georgia, your ProsperWise support assistant. I can help you with questions about your accounts, submit admin requests, or direct you to the right resources. How can I help you today?`,
  };

  // The thread is kept: reopening picks it up, and a reply from Rolf appears without the client doing anything.
  async function loadThread(initial: boolean) {
    if (!portalToken) { if (initial) setMessages([greeting]); return; }
    try {
      const res = await fetch(`${FUNCTIONS_URL}/portal-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "history", portal_token: portalToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const server: Message[] = Array.isArray(data.messages) ? data.messages : [];
      setAdvisorActive(!!data.advisorActive);
      if (data.conversationId) setConversationId(data.conversationId);
      if (initial) {
        serverCount.current = server.length;
        setMessages(server.length ? [greeting, ...server] : [greeting]);
      } else if (server.length !== serverCount.current) {
        serverCount.current = server.length;
        setMessages([greeting, ...server]);
      }
    } catch {
      if (initial) setMessages([greeting]);
    }
  }

  useEffect(() => {
    if (open) {
      setMessages([greeting]);
      setInput("");
      setFormTrigger(null);
      setConversationId(null);
      setOffered([]);
      setAdvisorActive(false);
      serverCount.current = 0;
      void loadThread(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactName]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { if (!isLoading) void loadThread(false); }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading, portalToken]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, formTrigger]);

  async function sendMessage() {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`${FUNCTIONS_URL}/portal-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          portal_token: portalToken,
          conversation_id: conversationId,
          context: { bookable: meetingTypes.map((m) => m.label), booked: bookedMeetings.map((b) => ({ label: b.label, start: b.start })) },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      if (data.conversationId) setConversationId(data.conversationId);
      if (data.held) setAdvisorActive(true);
      serverCount.current += data.text ? 2 : 1;

      // Handle text response
      if (data.text) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      }

      // Handle function calls (form trigger)
      if (data.functionCalls?.length) {
        for (const fc of data.functionCalls) {
          if (fc.name === "offer_booking") {
            // Georgia names a meeting; only one this page actually lists is offered.
            const wanted = String(fc.args?.meeting ?? "").trim().toLowerCase();
            const m = meetingTypes.find((t) => t.label.toLowerCase() === wanted);
            if (m) setOffered((prev) => (prev.some((p) => p.label === m.label) ? prev : [...prev, m]));
          }
          if (fc.name === "open_admin_request_form") {
            // If no text was returned with the tool call, add a friendly message
            if (!data.text) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "I can help you with that! Please fill out the form below to submit your request securely.",
                },
              ]);
            }
            setFormTrigger({
              requestType: fc.args.request_type || "",
              prefillDescription: fc.args.prefill_description || "",
            });
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  const handleFormSubmitted = () => {
    setFormTrigger(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "Your request has been submitted successfully! Your Personal CFO will review it and follow up with you shortly. Is there anything else I can help you with?",
      },
    ]);
    onRequestSubmitted?.();
  };

  const handleFormCancel = () => {
    setFormTrigger(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "No problem — the form has been closed. If you'd like to submit a request later, just let me know. Is there anything else I can help with?",
      },
    ]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 font-serif">
            <MessageCircle className="h-5 w-5 text-accent" />
            Ask Georgia
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-accent text-accent-foreground"
                      : msg.role === "advisor"
                        ? "border border-accent/40 bg-background text-foreground"
                        : "bg-muted text-foreground"
                  }`}
                >
                  {msg.role === "advisor" && <p className="mb-1 text-xs font-medium text-accent">Rolf</p>}
                  {msg.role !== "user" ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert [&>p]:mb-0 [&_a]:text-accent [&_a]:underline">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {offered.map((m) => (
              <div key={m.label} className="flex justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { onOpenChange(false); onOpenBooking?.(m); }}
                >
                  Choose a time: {m.label}
                </Button>
              </div>
            ))}

            {/* Admin Request Form (inline) */}
            {formTrigger && contactId && (
              <div className="py-2">
                <PortalAdminRequestForm
                  contactId={contactId}
                  contactName={contactName || ""}
                  portalToken={portalToken || ""}
                  onSubmitted={handleFormSubmitted}
                  onCancel={handleFormCancel}
                  prefillType={formTrigger.requestType}
                  prefillDescription={formTrigger.prefillDescription}
                  chatTranscript={messages.map((m) => ({ role: m.role, content: m.content }))}
                />
              </div>
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3.5 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>
        </div>

        {advisorActive && <p className="border-t border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">Rolf is handling this conversation and will reply here.</p>}
        <div className="border-t border-border px-4 py-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type your question..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button size="icon" onClick={sendMessage} disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
