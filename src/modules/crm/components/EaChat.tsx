import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { LinkifyText } from "@/shared/components/LinkifyText";

export interface EaAction { id: string; kind: string; status: "done" | "proposed" | "dismissed" | "failed"; summary: string; payload: Record<string, any> }
export interface EaMessage { id: string; role: "user" | "assistant"; content: string; actions: EaAction[] }
interface Pref { id: string; kind: string; value: string }

const call = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("daily-briefing-generate", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Georgia could not answer");
  return data;
};
const when = (local: string) => { const d = new Date(`${local}:00`); return Number.isNaN(d.getTime()) ? local : d.toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

/** What Georgia did or prepared in answer to a message. Proposals wait here for Rolf: nothing is sent or added without his click. */
function ActionCard({ a, onDecide, onForget }: { a: EaAction; onDecide: (id: string, d: "done" | "dismissed") => void; onForget: (id: string) => void }) {
  const p = a.payload;
  const decided = a.status === "dismissed" ? "Dismissed" : a.status === "done" && (a.kind === "calendar_proposal" || a.kind === "email_draft" || a.kind === "text_draft") ? "Used" : null;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Couldn't copy"); } };

  if (a.kind === "calendar_proposal") return (
    <div className="rounded-md border bg-card p-2.5 text-xs" data-testid="calendar-proposal">
      <p className="font-medium text-foreground">{p.title}</p>
      <p className="text-muted-foreground">{when(p.start)} to {when(p.end)}{p.location ? ` · ${p.location}` : ""}</p>
      {decided ? <Badge variant="outline" className="mt-1.5 text-[10px]">{decided}</Badge> : (
        <div className="mt-1.5 flex gap-1.5">
          <Button asChild size="sm" className="h-7 text-xs"><a href={p.url} target="_blank" rel="noopener noreferrer" onClick={() => onDecide(a.id, "done")}>Add to my calendar <ExternalLink className="ml-1 h-3 w-3" /></a></Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onDecide(a.id, "dismissed")}>Dismiss</Button>
        </div>
      )}
    </div>
  );
  if (a.kind === "email_draft") return (
    <div className="rounded-md border bg-card p-2.5 text-xs" data-testid="email-draft">
      <p className="text-muted-foreground">Draft email{p.to || p.to_name ? ` to ${p.to_name ?? ""} ${p.to ? `<${p.to}>` : ""}`.trimEnd() : ""}</p>
      <p className="font-medium text-foreground">{p.subject}</p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-foreground/90">{p.body}</pre>
      {decided ? <Badge variant="outline" className="mt-1.5 text-[10px]">{decided}</Badge> : (
        <div className="mt-1.5 flex gap-1.5">
          <Button asChild size="sm" className="h-7 text-xs"><a href={p.url} target="_blank" rel="noopener noreferrer" onClick={() => onDecide(a.id, "done")}>Open in Gmail <ExternalLink className="ml-1 h-3 w-3" /></a></Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copy(`${p.subject}\n\n${p.body}`)}>Copy</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onDecide(a.id, "dismissed")}>Dismiss</Button>
        </div>
      )}
    </div>
  );
  if (a.kind === "text_draft") return (
    <div className="rounded-md border bg-card p-2.5 text-xs" data-testid="text-draft">
      <p className="text-muted-foreground">Draft text to {p.to_name ?? "someone"}{p.to_number ? ` (${p.to_number})` : ""}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-foreground/90">{p.body}</p>
      {decided ? <Badge variant="outline" className="mt-1.5 text-[10px]">{decided}</Badge> : (
        <div className="mt-1.5 flex gap-1.5">
          <Button size="sm" className="h-7 text-xs" onClick={() => { void copy(p.body); onDecide(a.id, "done"); }}>Copy</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onDecide(a.id, "dismissed")}>Dismiss</Button>
        </div>
      )}
    </div>
  );
  if (a.kind === "research") return (
    <details className="rounded-md border bg-card p-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{a.summary}</summary>
      <ul className="mt-1 space-y-0.5">{(p.sources ?? []).map((s: { title: string; url: string }, i: number) => <li key={i}><a className="text-accent hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul>
    </details>
  );
  return (
    <p className={`flex items-center gap-1.5 text-xs ${a.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
      {a.status === "failed" ? <X className="h-3 w-3" /> : <Check className="h-3 w-3 text-green-600" />}{a.summary}
      {a.kind === "preference" && p.id && <button type="button" className="underline" onClick={() => onForget(p.id)}>Undo</button>}
    </p>
  );
}

/** The morning meeting: Georgia and Rolf talk the briefing through, and she carries out what he asks inside the firm and prepares what goes outside it. */
export function EaChat() {
  const [messages, setMessages] = useState<EaMessage[] | null>(null);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const d = await call({ action: "ea_history" }); setMessages(d.messages ?? []); setPrefs(d.preferences ?? []); } catch (e: any) { setMessages([]); toast.error(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages, busy]);

  const send = async (start = false) => {
    const t = text.trim();
    if (!start && !t) return;
    setBusy(true);
    if (!start) { setMessages((m) => [...(m ?? []), { id: `tmp-${Date.now()}`, role: "user", content: t, actions: [] }]); setText(""); }
    try {
      const d = await call({ action: "ea_chat", message: t, start });
      setMessages((m) => [...(m ?? []), d.message as EaMessage]);
      // Something she was asked to remember joins the list at once.
      for (const a of (d.message as EaMessage).actions ?? []) if (a.kind === "preference" && a.payload.id) setPrefs((p) => [...p, { id: a.payload.id, kind: a.payload.kind, value: a.payload.value }]);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const decide = async (id: string, decision: "done" | "dismissed") => {
    setMessages((m) => (m ?? []).map((x) => ({ ...x, actions: x.actions.map((a) => (a.id === id ? { ...a, status: decision } : a)) })));
    try { await call({ action: "ea_decide", actionId: id, decision }); } catch { /* the link still worked; the status will catch up on reload */ }
  };
  const forget = async (id: string) => { try { await call({ action: "ea_forget", prefId: id }); toast.success("Forgotten"); setPrefs((p) => p.filter((x) => x.id !== id)); } catch (e: any) { toast.error(e.message); } };

  return (
    <Card className="flex max-h-[80vh] flex-col" data-testid="ea-chat">
      <CardHeader className="pb-2"><CardTitle className="text-base">Morning meeting with Georgia</CardTitle></CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-[14rem] flex-1 space-y-3 overflow-y-auto pr-1">
          {messages === null && <Loader2 className="h-4 w-4 animate-spin" />}
          {messages?.length === 0 && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Georgia goes through the briefing with you, and you tell her what to do. She sets tasks and reminders and looks things up. Anything that goes outside the firm she prepares for you to send.</p>
              <Button onClick={() => send(true)} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Start the morning meeting</Button>
            </div>
          )}
          {messages?.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={`max-w-[92%] space-y-1.5 ${m.role === "user" ? "rounded-lg bg-accent/10 px-3 py-2" : ""}`}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"><LinkifyText text={m.content} /></p>
                {m.actions.map((a) => <ActionCard key={a.id} a={a} onDecide={decide} onForget={forget} />)}
              </div>
            </div>
          ))}
          {busy && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Georgia is working on it…</p>}
          <div ref={endRef} />
        </div>
        {prefs.length > 0 && (
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What Georgia remembers ({prefs.length})</summary>
            <ul className="mt-1 space-y-0.5">{prefs.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{p.kind === "mute_sender" ? `Not showing mail from ${p.value}` : p.value}</span><button type="button" className="underline" onClick={() => forget(p.id)}>Forget</button></li>)}</ul>
          </details>
        )}
        {(messages?.length ?? 0) > 0 && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder="Tell Georgia what you need" aria-label="Message to Georgia" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
            <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
