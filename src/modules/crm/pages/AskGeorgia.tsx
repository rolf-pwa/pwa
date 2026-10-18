import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileText, Loader2, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/shared/integrations/supabase/client";
import { RequestDetailDialog, REQUESTS_SELECT, STATUS_CONFIG, TYPE_LABELS, type PortalRequest } from "@/modules/crm/components/RequestDetailDialog";
import { AppLayout } from "@/shared/components/AppLayout";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { getSupportOverview, handBackSupportConversation, replyToSupportConversation, reviewSupportConversation, setAway, type Away, type SupportConversation } from "@/modules/crm/lib/reviewAgent";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function AwayCard({ away, onSaved }: { away: Away; onSaved: () => void }) {
  const [from, setFrom] = useState(away.away_from ?? "");
  const [until, setUntil] = useState(away.away_until ?? "");
  const [note, setNote] = useState(away.note ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (a: Away) => {
    setBusy(true);
    try { await setAway(a); toast.success(a.away_until ? "Away dates saved" : "Away dates cleared"); onSaved(); } catch (e: any) { toast.error(e?.message ?? "Couldn't save"); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-lg">When you are away</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Weekends are covered automatically. For holidays and time off, set the dates. Georgia tells clients you are out of the office and when you are back, and still alerts you at once for urgent matters.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">Last day away</span><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-40" /></label>
          <label className="min-w-[14rem] flex-1 space-y-1"><span className="block text-xs text-muted-foreground">Anything clients should know (optional)</span><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For urgent matters, Georgia will alert Rolf." /></label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !until} onClick={() => save({ away_from: from || null, away_until: until, note: note || null })}>Save</Button>
          {away.away_until && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFrom(""); setUntil(""); setNote(""); void save({ away_from: null, away_until: null, note: null }); }}>Clear</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestRows({ requests, onOpen }: { requests: PortalRequest[]; onOpen: (r: PortalRequest) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Requests</p>
      {requests.map((r) => {
        const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.submitted;
        const fromClient = (r.messages || []).filter((m) => m.sender_type === "client").length;
        return (
          <button key={r.id} type="button" onClick={() => onOpen(r)} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/50">
            <Badge variant={sc.variant} className="text-[10px]">{sc.label}</Badge>
            <span className="font-medium">{TYPE_LABELS[r.request_type] || r.request_type}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.request_description}</span>
            {r.file_urls && r.file_urls.length > 0 && <FileText className="h-3 w-3 text-muted-foreground" aria-label="Has files" />}
            {fromClient > 0 && <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><MessageCircle className="h-3 w-3" />{fromClient}</span>}
            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
          </button>
        );
      })}
    </div>
  );
}

function Conversation({ c, requests, onOpenRequest, onChanged }: { c: SupportConversation; requests: PortalRequest[]; onOpenRequest: (r: PortalRequest) => void; onChanged: () => void }) {
  const openRequests = requests.filter((r) => r.status !== "resolved").length;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const waiting = !!c.flag && !c.reviewed_at;
  const send = () => run(async () => { await replyToSupportConversation(c.id, draft.trim()); setDraft(""); }, "Sent. Georgia holds her answers in this thread until you hand it back.");
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); onChanged(); } catch (e: any) { toast.error(e?.message ?? "Couldn't update"); } finally { setBusy(false); }
  };
  return (
    <div className="border-b border-border px-3 py-2.5 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="font-medium text-left">{c.contact_name}</button>
        {waiting && <Badge variant={c.flag === "urgent" ? "destructive" : "default"}>{c.flag === "urgent" ? "Urgent" : "Needs you"}</Badge>}
        {c.flag && c.reviewed_at && <Badge variant="secondary">Reviewed</Badge>}
        {openRequests > 0 && <Badge variant="outline">{openRequests} open request{openRequests !== 1 ? "s" : ""}</Badge>}
        {c.advisor_active && <Badge variant="outline">You are handling this</Badge>}
        {c.away_when_flagged && <span className="text-xs text-muted-foreground">while you were away</span>}
        <span className="ml-auto text-xs text-muted-foreground">{when(c.updated_at)}</span>
        <Link to={`/contacts/${c.contact_id}`} className="text-xs underline">Contact</Link>
        {waiting && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => reviewSupportConversation(c.id))}>Mark reviewed</Button>}
      </div>
      {c.flag_summary && <p className="mt-1 text-muted-foreground">{c.flag_summary}</p>}
      {open && (
        <div className="mt-2 space-y-3">
          <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
            {c.messages.map((m, i) => <p key={i}><span className="font-medium">{m.role === "user" ? "Client" : m.role === "advisor" ? "You" : "Georgia"}: </span>{m.content}</p>)}
          </div>
          {requests.length > 0 && <RequestRows requests={requests} onOpen={onOpenRequest} />}
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Return sends; Shift+Return adds a line. Not while an input method is composing, or while a send is under way.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim() && !busy) void send(); }
              }}
              placeholder="Reply to the client in their Ask Georgia thread. Return sends, Shift+Return adds a line."
              rows={3}
              maxLength={4000}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void send()}>Send reply</Button>
              {c.advisor_active && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => handBackSupportConversation(c.id), "Georgia will answer in this thread again")}>Hand back to Georgia</Button>}
              <span className="text-xs text-muted-foreground">The client sees this in their portal and is told by a short email with no details.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AskGeorgia() {
  const [data, setData] = useState<{ away: Away; conversations: SupportConversation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await getSupportOverview()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load"); } }, []);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [selected, setSelected] = useState<PortalRequest | null>(null);
  const loadRequests = useCallback(async () => {
    const { data, error: err } = await supabase.from("portal_requests").select(REQUESTS_SELECT).order("created_at", { ascending: false });
    if (err) { toast.error("Couldn't load client requests"); return; }
    setRequests((data as unknown as PortalRequest[]) || []);
  }, []);
  const reload = useCallback(() => { void load(); void loadRequests(); }, [load, loadRequests]);
  useEffect(() => { reload(); }, [reload]);
  const byContact = new Map<string, PortalRequest[]>();
  for (const r of requests) byContact.set(r.contact_id, [...(byContact.get(r.contact_id) ?? []), r]);
  const threadContacts = new Set((data?.conversations ?? []).map((c) => c.contact_id));
  // Clients who filed a request but have no Ask Georgia thread (older form submissions): still shown, never lost.
  const orphans = [...byContact.entries()].filter(([id]) => !threadContacts.has(id));
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <div className="flex items-center gap-2"><MessageCircle className="h-6 w-6 text-accent" /><h1 className="font-serif text-2xl font-semibold">Ask Georgia</h1></div>
        <p className="text-sm text-muted-foreground">Georgia's conversations with clients in the portal. She answers what she can, files requests and shows the booking page. Anything that needs you is flagged here and notifies you in the app, never by email. You can reply in a client's thread, and Georgia stays quiet there until you hand it back.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {data && (
          <>
            <AwayCard away={data.away} onSaved={load} />
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-lg">Conversations</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data.conversations.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">No conversations yet.</p> : data.conversations.map((c) => <Conversation key={c.id} c={c} requests={byContact.get(c.contact_id) ?? []} onOpenRequest={setSelected} onChanged={reload} />)}
              </CardContent>
            </Card>
            {orphans.length > 0 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-lg">Requests from clients without a chat</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {orphans.map(([id, rs]) => (
                    <div key={id} className="space-y-1">
                      <Link to={`/contacts/${id}`} className="text-sm font-medium hover:underline">{rs[0].contact?.full_name || "Unknown"}</Link>
                      <RequestRows requests={rs} onOpen={setSelected} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      <RequestDetailDialog request={selected} onClose={() => setSelected(null)} onChanged={loadRequests} />
    </AppLayout>
  );
}
