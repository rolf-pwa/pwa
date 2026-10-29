import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Send, Loader2, ShieldCheck, Lock, ArrowUpRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const STORAGE_KEY = "vfo_onboarding_state_v1";

type Message = { role: "user" | "assistant"; content: string };
interface FunctionCall { name: string; args: Record<string, any>; }
type Phase = "chat" | "lead_capture" | "complete";

function loadSavedState(): { messages: Message[]; phase: Phase; vfoData?: Record<string, any> } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState(messages: Message[], phase: Phase, vfoData: Record<string, any>) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, phase, vfoData })); } catch {}
}

// ProsperWise brand palette (embed is rendered outside the app theme, so hex is required)
const C = {
  bg: "#FBFBF8", surface: "#F1EEE8", border: "rgba(164,123,87,0.35)",
  borderSubtle: "rgba(164,123,87,0.18)", vellum: "#FBFBF8",
  charcoal: "#334155", muted: "#5A6A80", green: "#1D2939", bronze: "#A47B57",
};

const WELCOME: Message = {
  role: "assistant",
  content:
    "Welcome. I’m Georgia, and I’ll help guide this conversation with discretion and care. ProsperWise’s Virtual Family Office is designed for important transitions, and I’ll keep this simple and private.\n\nIf you’d like, tell me what has changed and whether anything is creating immediate pressure on your personal or business side.",
};

export default function VfoOnboardingEmbed() {
  const saved = loadSavedState();
  const [messages, setMessages] = useState<Message[]>(saved?.messages?.length ? saved.messages : [WELCOME]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>(saved?.phase || "chat");
  const [vfoData, setVfoData] = useState<Record<string, any>>(saved?.vfoData || {});
  const [leadForm, setLeadForm] = useState({ first_name: "", phone: "", email: "" });
  const [pipedaConsent, setPipedaConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveState(messages, phase, vfoData); }, [messages, phase, vfoData]);
  useEffect(() => {
    const container = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, phase]);

  async function sendToGeorgia(msgs: Message[]) {
    setIsLoading(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/vfo-onboarding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: msgs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect");
      setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      if (data.functionCalls?.length) {
        const leadCall = data.functionCalls.find((fc: FunctionCall) => fc.name === "register_vfo_lead");
        if (leadCall) {
          setVfoData(leadCall.args);
          setPhase("lead_capture");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection error");
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;
    const newMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setInput("");
    await sendToGeorgia(newMessages);
  }

  async function submitLead() {
    if (!leadForm.first_name || !leadForm.email) { toast.error("Name and email are required."); return; }
    if (!pipedaConsent) { toast.error("Please accept the privacy consent."); return; }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/vfo-onboarding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: "register_lead",
          leadData: { ...leadForm, ...vfoData, pipeda_consent: true },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setPhase("complete");
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Thank you. Your details are with Rolf. He will personally review your context and reach out to coordinate your Transition Survey.",
      }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const auditType: "personal" | "corporate" = vfoData.audit_type === "corporate" ? "corporate" : "personal";
  const auditPrice = auditType === "corporate" ? "$2,000" : "$1,000";

  return (
    <div className="flex flex-col overflow-hidden w-full"
      style={{ height: "100dvh", maxHeight: "100dvh", backgroundColor: C.bg, color: C.vellum }}>
      <header className="flex items-center justify-between gap-2 px-3 py-3 sm:px-8 sm:py-5 shrink-0"
        style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.bg }}>
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: C.green, boxShadow: `0 0 0 1px rgba(42,64,52,0.3)` }}>
            <span className="font-serif text-base sm:text-lg" style={{ color: C.vellum }}>G</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-serif text-base sm:text-xl font-semibold" style={{ color: C.green, letterSpacing: "-0.01em" }}>
              Georgia
            </h1>
            <p className="text-[10px] sm:text-[11px] tracking-wide uppercase truncate" style={{ color: C.bronze, letterSpacing: "0.08em" }}>
              Virtual Family Office Onboarding · ProsperWise
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-4 py-1 sm:py-1.5 shrink-0"
          style={{ border: `1px solid ${C.border}`, backgroundColor: "rgba(42,64,52,0.05)" }}>
          <Lock className="h-3 w-3" style={{ color: C.green }} />
          <span className="text-[10px] sm:text-[11px] font-medium" style={{ color: C.green }}>PIPEDA</span>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        <div className="space-y-3 p-3">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: C.green, boxShadow: `0 0 0 1px ${C.border}` }}>
                    <span className="font-serif text-[10px]" style={{ color: C.vellum }}>G</span>
                  </div>
                )}
                <div className="max-w-[85%] text-xs leading-relaxed"
                  style={msg.role === "user"
                    ? { backgroundColor: C.green, color: C.vellum, borderRadius: "14px 4px 14px 14px", padding: "8px 12px", border: `1px solid rgba(169,140,90,0.25)` }
                    : { backgroundColor: C.surface, color: C.charcoal, borderRadius: "4px 14px 14px 14px", padding: "8px 12px", border: `1px solid ${C.borderSubtle}`, boxShadow: "0 1px 3px rgba(169,140,90,0.08)" }}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-2 prose-p:leading-relaxed" style={{ color: C.charcoal }}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: C.green }}>
                <span className="font-serif text-[10px]" style={{ color: C.vellum }}>G</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ backgroundColor: C.surface, border: `1px solid ${C.borderSubtle}` }}>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" style={{ backgroundColor: C.bronze }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" style={{ backgroundColor: C.bronze }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" style={{ backgroundColor: C.bronze }} />
              </div>
            </motion.div>
          )}

          {phase === "lead_capture" && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <div className="rounded-xl p-3 space-y-2.5" style={{ backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" style={{ color: C.bronze }} />
                  <span className="text-[11px] font-semibold font-serif" style={{ color: C.green }}>
                    Reserve Your Transition Survey ({auditPrice} {auditType === "corporate" ? "B2B" : "personal"})
                  </span>
                </div>
                <p className="text-[10px]" style={{ color: C.muted }}>
                  Share your details and Rolf will personally coordinate your 90-minute diagnostic.
                </p>
                {[
                  { key: "first_name", placeholder: "First name *", type: "text", max: 100 },
                  { key: "phone", placeholder: "Phone", type: "tel", max: 20 },
                  { key: "email", placeholder: "Email *", type: "email", max: 255 },
                ].map(({ key, placeholder, type, max }) => (
                  <input key={key} type={type}
                    value={leadForm[key as keyof typeof leadForm]}
                    onChange={(e) => setLeadForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder} maxLength={max}
                    className="w-full h-8 rounded-lg px-3 text-xs focus-visible:outline-none placeholder:text-[#5A6A80]"
                    style={{ backgroundColor: "#FFFFFF", border: `1px solid ${C.border}`, color: C.charcoal }} />
                ))}
                <div className="flex items-start gap-2 rounded-lg p-2"
                  style={{ backgroundColor: "rgba(169,140,90,0.06)", border: `1px solid ${C.border}` }}>
                  <Checkbox id="vfo-pipeda" checked={pipedaConsent}
                    onCheckedChange={(v) => setPipedaConsent(v === true)} className="mt-0.5 shrink-0" />
                  <label htmlFor="vfo-pipeda" className="text-[9px] leading-relaxed cursor-pointer" style={{ color: C.muted }}>
                    I consent to ProsperWise collecting my information under{" "}
                    <span style={{ color: C.bronze }}>PIPEDA</span>. Canadian data centres only.
                  </label>
                </div>
                <button onClick={submitLead}
                  disabled={isSubmitting || !leadForm.first_name || !leadForm.email || !pipedaConsent}
                  className="w-full h-8 rounded-lg text-xs font-semibold tracking-wide disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: C.green, color: C.vellum, border: `1px solid ${C.border}` }}>
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Submitting...
                    </span>
                  ) : `Request Transition Survey (${auditPrice})`}
                </button>
              </div>
            </motion.div>
          )}

          {phase === "complete" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
              <div className="rounded-xl p-4 text-center" style={{ backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
                <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: "rgba(169,140,90,0.12)", border: `1px solid ${C.border}` }}>
                  <ShieldCheck className="h-4 w-4" style={{ color: C.bronze }} />
                </div>
                <p className="text-xs font-semibold font-serif" style={{ color: C.green }}>Transition Survey Requested</p>
                <p className="mt-1 text-[10px]" style={{ color: C.muted }}>
                  Rolf will personally reach out to coordinate your 90-minute diagnostic.
                </p>
                <p className="mt-3 text-[9px] uppercase tracking-wider" style={{ color: C.bronze }}>
                  Fee-Only · Canada · PIPEDA
                </p>
              </div>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      {phase === "chat" && (
        <div className="shrink-0 px-3 py-3 sm:px-6 sm:py-4"
          style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.bg, paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-3xl items-end gap-2 sm:gap-3">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Share what's on your mind..." rows={1} disabled={isLoading}
              className="flex-1 resize-none rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 text-base sm:text-sm focus-visible:outline-none"
              style={{ backgroundColor: "#FFFFFF", border: `1px solid ${C.border}`, color: C.charcoal, fontFamily: "Inter, sans-serif", boxShadow: "0 1px 4px rgba(29,41,57,0.06)" }} />
            <button onClick={sendMessage} disabled={isLoading || !input.trim()}
              className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: C.green }}>
              <Send className="h-4 w-4" style={{ color: C.vellum }} />
            </button>
          </div>
          <div className="mx-auto mt-2 sm:mt-3 max-w-3xl flex items-center justify-center gap-1.5 px-2">
            <Lock className="h-3 w-3 shrink-0" style={{ color: C.bronze }} />
            <p className="text-[9px] sm:text-[10px] tracking-wide text-center" style={{ color: C.bronze }}>
              Private · Canadian servers (Montréal) · Nothing leaves this conversation until you choose a next step
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
