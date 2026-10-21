import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { withAuthRaceRetry } from "@/shared/lib/authRaceRetry";
import { Card } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/shared/components/ui/dialog";
import {
  Loader2, MessageSquare, Phone, RefreshCw, Eye, EyeOff,
  Inbox as InboxIcon, UserPlus, Link2, Send, AlertCircle, ChevronRight, ChevronDown,
  Archive, ArchiveRestore, Trash2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { toast } from "sonner";

/** For a Callizy call: its transcript, summary and a fresh recording link are fetched when asked for (the links last an hour). */
function CallizyCallExtras({ call }: { call: { id: string; is_voicemail?: boolean; transcript?: string | null } }) {
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(call.transcript ?? null);
  const [note, setNote] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("quo-service", { body: { action: "callizyCall", callId: call.id } });
      if (error) throw error;
      setAudio(data?.audio ?? null);
      setText(data?.transcript || null);
      setNote(!data?.audio && !data?.transcript ? "Nothing is available yet. Callizy may still be processing this call." : null);
    } catch { toast.error("Couldn't load the call from Callizy"); } finally { setBusy(false); }
  };
  return (
    <div className="mt-1 space-y-1">
      <button type="button" onClick={() => void open()} disabled={busy} className="text-xs text-amber-500 hover:underline">{busy ? "Loading…" : call.is_voicemail ? "▶ Play voicemail" : "▶ Recording and transcript"}</button>
      {audio && <audio controls autoPlay src={audio} className="w-full h-8" />}
      {text && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">View transcript</summary><pre className="whitespace-pre-wrap mt-1 max-h-60 overflow-y-auto">{text}</pre></details>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Which phone provider texts are sent through from the CRM: Quo, or the Callizy trial. Incoming texts and calls from both land in this inbox. */
function ProviderSwitch() {
  const [provider, setProvider] = useState<"quo" | "callizy" | null>(null);
  useEffect(() => {
    supabase.functions.invoke("quo-service", { body: { action: "getProvider" } }).then(({ data }) => setProvider(data?.provider === "callizy" ? "callizy" : "quo")).catch(() => setProvider(null));
  }, []);
  if (!provider) return null;
  const choose = async (next: "quo" | "callizy") => {
    const prev = provider;
    setProvider(next);
    const { error } = await supabase.functions.invoke("quo-service", { body: { action: "setProvider", provider: next } });
    if (error) { setProvider(prev); toast.error("Couldn't switch the texting provider"); } else toast.success(next === "callizy" ? "Texts from the CRM now go out through Callizy" : "Texts from the CRM now go out through Quo");
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Send texts through
      <select value={provider} onChange={(e) => void choose(e.target.value as "quo" | "callizy")} className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground" aria-label="Texting provider">
        <option value="quo">Quo</option>
        <option value="callizy">Callizy (trial)</option>
      </select>
    </label>
  );
}

interface QuoMessage {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  occurred_at: string;
  portal_visible: boolean;
  pii_blocked: boolean;
  from_number: string | null;
  to_number: string | null;
  read_at: string | null;
}

interface QuoCall {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound";
  duration_seconds: number;
  recording_url: string | null;
  summary: string | null;
  next_steps: string | null;
  occurred_at: string;
  portal_visible: boolean;
  from_number: string | null;
  to_number: string | null;
  read_at: string | null;
  is_voicemail?: boolean;
  voicemail_url?: string | null;
  provider?: string;
}

interface ContactLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email?: string | null;
}

type TimelineEntry =
  | { kind: "msg"; at: string; item: QuoMessage }
  | { kind: "call"; at: string; item: QuoCall };

export default function Inbox() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<QuoMessage[]>([]);
  const [calls, setCalls] = useState<QuoCall[]>([]);
  const [contacts, setContacts] = useState<Record<string, ContactLite>>({});
  const [archive, setArchive] = useState<Record<string, string | null>>({}); // threadKey -> last_message_at (or null)
  const [loading, setLoading] = useState(true);

  // Reply state — keyed by phone number (the counterparty)
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  // Resolve-orphan dialog
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolvePhone, setResolvePhone] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await withAuthRaceRetry(() =>
        supabase.functions.invoke("quo-service", { body: { action: "inbox", limit: 200 } })
      );
      if (error) throw error;
      setMessages(data?.messages || []);
      setCalls(data?.calls || []);
      setContacts(data?.contacts || {});
      const archMap: Record<string, string | null> = {};
      for (const a of data?.archive || []) archMap[a.thread_key] = a.last_message_at || null;
      setArchive(archMap);
    } catch (err: any) {
      toast.error(`Inbox load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await supabase.functions.invoke("quo-service", { body: { action: "markRead", all: true } });
    } catch {}
  };

  useEffect(() => {
    // See authRaceRetry.ts -- there's a brief window right after an OAuth
    // redirect where a query can fire before the Supabase client's session
    // is fully settled for outgoing requests, even though the user is
    // genuinely signed in. Bail out until a real user exists.
    if (!user) return;

    load().then(() => markAllRead());
    const channel = supabase
      .channel("quo-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_messages" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_calls" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const togglePortal = async (recordType: "message" | "call", recordId: string, current: boolean) => {
    try {
      const { error } = await supabase.functions.invoke("quo-service", {
        body: { action: "togglePortalVisible", recordType, recordId, visible: !current },
      });
      if (error) throw error;
      toast.success(current ? "Hidden from portal" : "Visible in portal");
      load();
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`);
    }
  };

  const sendReply = async (to: string, contactId: string | null) => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("quo-service", {
        body: { action: "sendSms", contactId, to, content: replyBody.trim() },
      });
      if (error) throw error;
      if (data?.blocked) {
        toast.error(`PII Shield blocked: ${data.reason}`, {
          description: "Use the portal for sensitive details.",
        });
      } else {
        toast.success("Reply sent");
        setReplyBody("");
        setReplyTo(null);
      }
      load();
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const openResolve = (phone: string) => {
    setResolvePhone(phone);
    setResolveOpen(true);
  };

  const contactName = (id: string | null, fallback: string | null) => {
    if (id && contacts[id]) {
      const c = contacts[id];
      return `${c.first_name || ""} ${c.last_name || ""}`.trim() || fallback || "Unknown";
    }
    return fallback || "Unknown number";
  };

  const timeline: TimelineEntry[] = useMemo(() => [
    ...messages.map((m) => ({ kind: "msg" as const, at: m.occurred_at, item: m })),
    ...calls.map((c) => ({ kind: "call" as const, at: c.occurred_at, item: c })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()), [messages, calls]);

  const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read_at).length
    + calls.filter((c) => c.direction === "inbound" && !c.read_at).length;

  const unmatchedTimeline = timeline.filter((e) => !e.item.contact_id);

  // ---- Thread grouping ----
  const last10 = (p: string | null | undefined) =>
    (p || "").replace(/\D/g, "").slice(-10);

  const threads = useMemo(() => {
    const map = new Map<string, {
      key: string;
      contactId: string | null;
      counterparty: string | null;
      entries: TimelineEntry[];
      lastAt: string;
      unread: number;
    }>();
    for (const e of timeline) {
      const isOut = e.item.direction === "outbound";
      const cp = isOut
        ? (e.kind === "msg" ? e.item.to_number : e.item.to_number)
        : (e.kind === "msg" ? e.item.from_number : e.item.from_number);
      const digits = last10(cp);
      // Key by contact_id when known, otherwise by phone digits
      const key = e.item.contact_id || (digits ? `phone:${digits}` : `unknown:${e.item.id}`);
      const existing = map.get(key);
      if (existing) {
        existing.entries.push(e);
        if (new Date(e.at) > new Date(existing.lastAt)) existing.lastAt = e.at;
        if (!e.item.contact_id ? false : true) existing.contactId = existing.contactId || e.item.contact_id;
        if (!existing.counterparty && cp) existing.counterparty = cp;
        if (e.item.direction === "inbound" && !e.item.read_at) existing.unread++;
      } else {
        map.set(key, {
          key,
          contactId: e.item.contact_id,
          counterparty: cp,
          entries: [e],
          lastAt: e.at,
          unread: e.item.direction === "inbound" && !e.item.read_at ? 1 : 0,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
    );
  }, [timeline]);

  // A thread is "archived" if its key is in the archive AND no newer message has arrived since
  const isArchived = (t: { key: string; lastAt: string }) => {
    if (!(t.key in archive)) return false;
    const archivedAt = archive[t.key];
    if (!archivedAt) return true;
    return new Date(t.lastAt) <= new Date(archivedAt);
  };

  const archiveThread = async (t: ThreadGroup) => {
    try {
      const phoneDigits = t.key.startsWith("phone:") ? t.key.slice(6) : null;
      await supabase.functions.invoke("quo-service", {
        body: {
          action: "archiveThread",
          threadKey: t.key,
          contactId: t.contactId,
          phoneDigits,
          lastMessageAt: t.lastAt,
        },
      });
      setArchive((prev) => ({ ...prev, [t.key]: t.lastAt }));
      toast.success("Thread archived — still visible on contact + portal");
    } catch (err: any) {
      toast.error(`Archive failed: ${err.message}`);
    }
  };

  const unarchiveThread = async (t: ThreadGroup) => {
    try {
      await supabase.functions.invoke("quo-service", {
        body: { action: "unarchiveThread", threadKey: t.key },
      });
      setArchive((prev) => {
        const next = { ...prev };
        delete next[t.key];
        return next;
      });
      toast.success("Thread restored to inbox");
    } catch (err: any) {
      toast.error(`Restore failed: ${err.message}`);
    }
  };

  const deleteThread = async (t: ThreadGroup) => {
    try {
      const phoneDigits = t.key.startsWith("phone:") ? t.key.slice(6) : null;
      const { data, error } = await supabase.functions.invoke("quo-service", {
        body: {
          action: "deleteThread",
          threadKey: t.key,
          contactId: t.contactId,
          phoneDigits,
        },
      });
      if (error) throw error;
      toast.success(
        `Thread deleted · ${data?.deletedMessages || 0} messages, ${data?.deletedCalls || 0} calls removed`,
      );
      load();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const archivedThreads = useMemo(() => threads.filter(isArchived), [threads, archive]);
  const activeThreads = useMemo(() => threads.filter((t) => !isArchived(t)), [threads, archive]);

  const voicemailCount = calls.filter((c) => c.is_voicemail && !c.read_at).length;

  const filterThreads = (mode: "all" | "sms" | "calls" | "voicemail" | "unread" | "unmatched" | "archived") => {
    const source = mode === "archived" ? archivedThreads : activeThreads;
    return source
      .map((t) => {
        let entries = t.entries;
        if (mode === "sms") entries = entries.filter((e) => e.kind === "msg");
        if (mode === "calls") entries = entries.filter((e) => e.kind === "call");
        if (mode === "voicemail") entries = entries.filter((e) => e.kind === "call" && e.item.is_voicemail);
        if (mode === "unread") entries = entries.filter((e) => e.item.direction === "inbound" && !e.item.read_at);
        if (mode === "unmatched") entries = entries.filter((e) => !e.item.contact_id);
        return { ...t, entries };
      })
      .filter((t) => t.entries.length > 0);
  };

  const cardProps = {
    contactName,
    onToggle: togglePortal,
    onReplyOpen: (phone: string) => { setReplyTo(phone); setReplyBody(""); },
    onResolve: openResolve,
    onArchive: archiveThread,
    onUnarchive: unarchiveThread,
    onDelete: deleteThread,
    replyTo, replyBody, setReplyBody, sending,
    sendReply,
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <InboxIcon className="h-7 w-7 text-amber-500" />
            <div>
              <h1 className="text-3xl font-bold text-foreground">Inbox</h1>
              <p className="text-sm text-muted-foreground">
                Threaded SMS &amp; voice across all contacts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ProviderSwitch />
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All ({activeThreads.length})</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="voicemail" className="data-[state=active]:text-amber-500">
              Voicemails{voicemailCount > 0 ? ` (${voicemailCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
            <TabsTrigger value="unmatched" className="data-[state=active]:text-amber-500">
              Unmatched ({unmatchedTimeline.filter((e) => !isArchived({ key: e.item.contact_id || `phone:${last10(e.item.direction === "outbound" ? e.item.to_number : e.item.from_number)}`, lastAt: e.at })).length})
            </TabsTrigger>
            <TabsTrigger value="archived">Archived ({archivedThreads.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <ThreadList threads={filterThreads("all")} loading={loading} {...cardProps} />
          </TabsContent>
          <TabsContent value="sms" className="mt-4">
            <ThreadList threads={filterThreads("sms")} loading={loading} {...cardProps} />
          </TabsContent>
          <TabsContent value="calls" className="mt-4">
            <ThreadList threads={filterThreads("calls")} loading={loading} {...cardProps} />
          </TabsContent>
          <TabsContent value="voicemail" className="mt-4">
            <ThreadList threads={filterThreads("voicemail")} loading={loading} {...cardProps} defaultOpen />
          </TabsContent>
          <TabsContent value="unread" className="mt-4">
            <ThreadList threads={filterThreads("unread")} loading={loading} {...cardProps} defaultOpen />
          </TabsContent>
          <TabsContent value="unmatched" className="mt-4">
            <ThreadList threads={filterThreads("unmatched")} loading={loading} {...cardProps} />
          </TabsContent>
          <TabsContent value="archived" className="mt-4">
            <ThreadList threads={filterThreads("archived")} loading={loading} {...cardProps} archivedView />
          </TabsContent>
        </Tabs>
      </div>

      <ResolveOrphanDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        phone={resolvePhone}
        onResolved={load}
      />
    </AppLayout>
  );
}

interface CardSharedProps {
  contactName: (id: string | null, fallback: string | null) => string;
  onToggle: (recordType: "message" | "call", recordId: string, current: boolean) => void;
  onReplyOpen: (phone: string) => void;
  onResolve: (phone: string) => void;
  onArchive: (t: ThreadGroup) => void;
  onUnarchive: (t: ThreadGroup) => void;
  onDelete: (t: ThreadGroup) => void;
  replyTo: string | null;
  replyBody: string;
  setReplyBody: (v: string) => void;
  sending: boolean;
  sendReply: (to: string, contactId: string | null) => void;
}

interface ThreadGroup {
  key: string;
  contactId: string | null;
  counterparty: string | null;
  entries: TimelineEntry[];
  lastAt: string;
  unread: number;
}

function ThreadList({
  threads, loading, defaultOpen, archivedView, ...rest
}: { threads: ThreadGroup[]; loading: boolean; defaultOpen?: boolean; archivedView?: boolean } & CardSharedProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (threads.length === 0) {
    return <p className="text-sm text-muted-foreground italic py-12 text-center">
      {archivedView ? "No archived threads." : "No conversations yet."}
    </p>;
  }
  return (
    <div className="space-y-2">
      {threads.map((t) => (
        <ThreadCard key={t.key} thread={t} defaultOpen={defaultOpen} archivedView={archivedView} {...rest} />
      ))}
    </div>
  );
}

function ThreadCard({
  thread, defaultOpen, archivedView, contactName, onToggle, onReplyOpen, onResolve,
  onArchive, onUnarchive, onDelete,
  replyTo, replyBody, setReplyBody, sending, sendReply,
}: { thread: ThreadGroup; defaultOpen?: boolean; archivedView?: boolean } & CardSharedProps) {
  const [open, setOpen] = useState(!!defaultOpen || (thread.unread > 0 && !archivedView));
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Newest-first for the collapsed preview
  const sortedEntries = useMemo(
    () => [...thread.entries].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [thread.entries],
  );
  // Oldest-first chronological order for the chat bubble view
  const chronologicalEntries = useMemo(
    () => [...thread.entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [thread.entries],
  );
  const latest = sortedEntries[0];
  const isOrphan = !thread.contactId && !!thread.counterparty;
  const name = contactName(thread.contactId, thread.counterparty);

  // Auto-open the composer for this thread when expanded
  const composerOpen = !!thread.counterparty && replyTo === thread.counterparty;

  const preview = latest.kind === "msg"
    ? latest.item.body
    : (latest.item.summary || `${latest.item.direction === "outbound" ? "Outgoing" : "Incoming"} call · ${Math.floor(latest.item.duration_seconds / 60)}m ${latest.item.duration_seconds % 60}s`);

  return (
    <Card className={`overflow-hidden ${thread.unread > 0 && !archivedView ? "border-l-4 border-l-amber-500" : ""} ${archivedView ? "opacity-70" : ""}`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-3 p-3 hover:bg-muted/50 text-left min-w-0"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {thread.contactId ? (
                <Link to={`/contacts/${thread.contactId}`} onClick={(e) => e.stopPropagation()}
                  className="font-medium text-foreground hover:underline truncate">
                  {name}
                </Link>
              ) : (
                <span className="font-medium text-foreground truncate">{name}</span>
              )}
              {isOrphan && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                  <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Unknown
                </Badge>
              )}
              {thread.unread > 0 && !archivedView && (
                <Badge className="text-[10px] bg-amber-500 text-amber-950 hover:bg-amber-500">
                  {thread.unread} new
                </Badge>
              )}
              {archivedView && (
                <Badge variant="outline" className="text-[10px]">Archived</Badge>
              )}
              <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                {new Date(thread.lastAt).toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {latest.item.direction === "outbound" ? "You: " : ""}{preview}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {thread.entries.length} {thread.entries.length === 1 ? "message" : "messages"}
              {thread.counterparty && ` · ${thread.counterparty}`}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); archivedView ? onUnarchive(thread) : onArchive(thread); }}
          className="px-4 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 border-l border-border transition-colors"
          title={archivedView ? "Restore to inbox" : "Archive thread (still visible on contact + portal)"}
        >
          {archivedView ? (
            <>
              <ArchiveRestore className="h-4 w-4" />
              <span className="hidden sm:inline">Restore</span>
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" />
              <span className="hidden sm:inline">Archive</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          className="px-4 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 border-l border-border transition-colors"
          title="Permanently delete this thread (messages + calls)"
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{thread.entries.length}</strong>{" "}
              {thread.entries.length === 1 ? "record" : "records"} ({name}) from the database.
              This action cannot be undone, and the thread will also disappear from the
              contact page and the client portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmDelete(false); onDelete(thread); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open && (
        <div className="border-t border-border bg-background/40">
          {/* Orphan resolve banner */}
          {isOrphan && thread.counterparty && (
            <div className="px-3 pt-3">
              <ResolveBar phone={thread.counterparty} onResolve={onResolve} />
            </div>
          )}

          {/* Chat bubble thread */}
          <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto">
            {chronologicalEntries.map((entry) =>
              entry.kind === "msg" ? (
                <ChatBubble
                  key={`m-${entry.item.id}`}
                  kind="msg"
                  isOut={entry.item.direction === "outbound"}
                  occurredAt={entry.at}
                  isUnread={!entry.item.read_at && entry.item.direction === "inbound"}
                  portalVisible={entry.item.portal_visible}
                  onTogglePortal={() => onToggle("message", entry.item.id, entry.item.portal_visible)}
                  body={entry.item.body}
                  piiBlocked={entry.item.pii_blocked}
                />
              ) : (
                <ChatBubble
                  key={`c-${entry.item.id}`}
                  kind="call"
                  isOut={entry.item.direction === "outbound"}
                  occurredAt={entry.at}
                  isUnread={!entry.item.read_at && entry.item.direction === "inbound"}
                  portalVisible={entry.item.portal_visible}
                  onTogglePortal={() => onToggle("call", entry.item.id, entry.item.portal_visible)}
                  call={entry.item}
                />
              )
            )}
          </div>

          {/* Persistent composer (chat-style) */}
          {thread.counterparty && !archivedView && (
            <ChatComposer
              to={thread.counterparty}
              contactId={thread.contactId}
              isActive={composerOpen}
              onActivate={() => onReplyOpen(thread.counterparty!)}
              replyBody={replyBody}
              setReplyBody={setReplyBody}
              sending={sending}
              sendReply={sendReply}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function ChatBubble({
  kind, isOut, occurredAt, isUnread, portalVisible, onTogglePortal, body, piiBlocked, call,
}: {
  kind: "msg" | "call";
  isOut: boolean;
  occurredAt: string;
  isUnread: boolean;
  portalVisible: boolean;
  onTogglePortal: () => void;
  body?: string;
  piiBlocked?: boolean;
  call?: QuoCall;
}) {
  const align = isOut ? "justify-end" : "justify-start";
  const bubble = isOut
    ? "bg-amber-500/10 border border-amber-500/30"
    : "bg-muted border border-border";
  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[80%] rounded-lg p-3 text-sm ${bubble} ${isUnread ? "ring-1 ring-amber-500/40" : ""}`}>
        <div className="flex items-center gap-2 mb-1 text-[11px] text-muted-foreground">
          {kind === "msg" ? <MessageSquare className="h-3 w-3" /> : <Phone className="h-3 w-3 text-amber-500" />}
          <span>{isOut ? "Sent" : "Received"}</span>
          <span>· {new Date(occurredAt).toLocaleString()}</span>
          {piiBlocked && <Badge variant="destructive" className="text-[10px]">BLOCKED</Badge>}
        </div>
        {kind === "msg" ? (
          <p className="whitespace-pre-wrap">{body}</p>
        ) : call ? (
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1.5">
              {call.is_voicemail && (
                <Badge className="text-[10px] bg-amber-500 text-amber-950 hover:bg-amber-500">
                  Voicemail
                </Badge>
              )}
              {call.is_voicemail
                ? `Voicemail · ${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
                : `${isOut ? "Outgoing" : "Incoming"} call · ${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`}
            </p>
            {call.summary && <p className="whitespace-pre-wrap text-foreground/90">{call.summary}</p>}
            {call.next_steps && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                <span className="font-semibold">Next: </span>{call.next_steps}
              </p>
            )}
            {call.voicemail_url && (
              <audio controls src={call.voicemail_url} className="w-full mt-1 h-8" preload="none" />
            )}
            {call.recording_url && !call.voicemail_url && (
              <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-amber-500 hover:underline inline-block">
                ▶ Listen to recording
              </a>
            )}
            {call.provider === "callizy" && <CallizyCallExtras call={call} />}
          </div>
        ) : null}
        <div className="flex items-center gap-1 mt-1.5 -mb-1 text-[10px] text-muted-foreground">
          <button
            onClick={onTogglePortal}
            className="flex items-center gap-1 hover:text-foreground"
            title={portalVisible ? "Hide from portal" : "Show in portal"}
          >
            {portalVisible ? <Eye className="h-3 w-3 text-amber-500" /> : <EyeOff className="h-3 w-3" />}
            <span>{portalVisible ? "In portal" : "Staff only"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatComposer({
  to, contactId, isActive, onActivate, replyBody, setReplyBody, sending, sendReply,
}: {
  to: string; contactId: string | null;
  isActive: boolean; onActivate: () => void;
  replyBody: string; setReplyBody: (v: string) => void;
  sending: boolean; sendReply: (to: string, contactId: string | null) => void;
}) {
  return (
    <div className="border-t border-border bg-card/60 p-3 space-y-2">
      <Textarea
        value={isActive ? replyBody : ""}
        onFocus={() => { if (!isActive) onActivate(); }}
        onChange={(e) => { if (!isActive) onActivate(); setReplyBody(e.target.value); }}
        placeholder={`Message ${to}…`}
        className="min-h-[60px] text-sm"
        disabled={sending}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          🛡️ PII Shield active — financial, account, and health terms blocked.
        </p>
        <Button
          size="sm"
          onClick={() => sendReply(to, contactId)}
          disabled={!isActive || !replyBody.trim() || sending}
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
          Send
        </Button>
      </div>
    </div>
  );
}

function HeaderRow({
  Icon, label, badgeText, badgeVariant, occurredAt, contactId, contactName, fallback, isOrphan,
}: {
  Icon: any; label: string; badgeText: string; badgeVariant: "default" | "outline";
  occurredAt: string; contactId: string | null;
  contactName: (id: string | null, fallback: string | null) => string;
  fallback: string | null; isOrphan: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground flex-wrap">
      <Icon className="h-3.5 w-3.5 text-amber-500" />
      <span className="font-medium text-foreground">
        {contactId ? (
          <Link to={`/contacts/${contactId}`} className="hover:underline">
            {contactName(contactId, fallback)}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {contactName(null, fallback)}
            {isOrphan && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
              <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Unknown sender
            </Badge>}
          </span>
        )}
      </span>
      <Badge variant={badgeVariant} className="text-[10px]">{badgeText}</Badge>
      <span>· {new Date(occurredAt).toLocaleString()}</span>
    </div>
  );
}

function ResolveBar({
  phone, onResolve,
}: { phone: string; onResolve: (phone: string) => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
      <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <span className="text-xs text-muted-foreground flex-1">
        This sender ({phone}) isn't in your database yet.
      </span>
      <Button size="sm" variant="outline" onClick={() => onResolve(phone)} className="h-7 text-xs">
        <UserPlus className="h-3 w-3 mr-1" /> Create / Link
      </Button>
    </div>
  );
}

function ReplyBox({
  to, contactId, replyTo, replyBody, setReplyBody, sending, sendReply, onClose,
}: {
  to: string; contactId: string | null;
  replyTo: string | null; replyBody: string; setReplyBody: (v: string) => void;
  sending: boolean; sendReply: (to: string, contactId: string | null) => void;
  onClose: () => void;
}) {
  if (replyTo !== to) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <Textarea
        autoFocus value={replyBody}
        onChange={(e) => setReplyBody(e.target.value)}
        placeholder={`Reply to ${to}…`}
        className="min-h-[70px] text-sm"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          🛡️ PII Shield: financial figures, account #s, and health terms will be blocked.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button size="sm" onClick={() => sendReply(to, contactId)} disabled={!replyBody.trim() || sending}>
            {sending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageCard({
  m, contactName, onToggle, onReplyOpen, onResolve,
  replyTo, replyBody, setReplyBody, sending, sendReply,
}: { m: QuoMessage } & CardSharedProps) {
  const isOut = m.direction === "outbound";
  const counterparty = isOut ? m.to_number : m.from_number;
  const isOrphan = !m.contact_id && !!counterparty;
  const isUnread = !m.read_at && m.direction === "inbound";

  return (
    <Card className={`p-4 ${isUnread ? "border-l-4 border-l-amber-500 bg-amber-500/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <HeaderRow
            Icon={MessageSquare}
            label="msg"
            badgeText={isOut ? "Sent" : "Received"}
            badgeVariant={isOut ? "outline" : "default"}
            occurredAt={m.occurred_at}
            contactId={m.contact_id}
            contactName={contactName}
            fallback={counterparty}
            isOrphan={isOrphan}
          />
          {m.pii_blocked && <Badge variant="destructive" className="text-[10px] mb-1">PII BLOCKED</Badge>}
          <p className="text-sm whitespace-pre-wrap">{m.body}</p>

          {isOrphan && counterparty && <ResolveBar phone={counterparty} onResolve={onResolve} />}

          <div className="mt-2 flex items-center gap-2">
            {counterparty && replyTo !== counterparty && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => onReplyOpen(counterparty)}>
                <Send className="h-3 w-3 mr-1" /> Reply
              </Button>
            )}
          </div>

          {counterparty && (
            <ReplyBox
              to={counterparty} contactId={m.contact_id}
              replyTo={replyTo} replyBody={replyBody} setReplyBody={setReplyBody}
              sending={sending} sendReply={sendReply}
              onClose={() => onReplyOpen("")}
            />
          )}
        </div>
        <button
          onClick={() => onToggle("message", m.id, m.portal_visible)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          title={m.portal_visible ? "Hide from portal" : "Show in portal"}
        >
          {m.portal_visible ? <Eye className="h-4 w-4 text-amber-500" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
    </Card>
  );
}

function CallCard({
  c, contactName, onToggle, onReplyOpen, onResolve,
  replyTo, replyBody, setReplyBody, sending, sendReply,
}: { c: QuoCall } & CardSharedProps) {
  const isOut = c.direction === "outbound";
  const counterparty = isOut ? c.to_number : c.from_number;
  const isOrphan = !c.contact_id && !!counterparty;
  const isUnread = !c.read_at && c.direction === "inbound";
  const mins = Math.floor(c.duration_seconds / 60);
  const secs = c.duration_seconds % 60;

  return (
    <Card className={`p-4 ${isUnread ? "border-l-4 border-l-amber-500 bg-amber-500/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <HeaderRow
            Icon={Phone}
            label="call"
            badgeText={`${isOut ? "Outgoing" : "Incoming"} · ${mins}m ${secs}s`}
            badgeVariant={isOut ? "outline" : "default"}
            occurredAt={c.occurred_at}
            contactId={c.contact_id}
            contactName={contactName}
            fallback={counterparty}
            isOrphan={isOrphan}
          />
          {c.summary && <p className="text-sm whitespace-pre-wrap">{c.summary}</p>}
          {c.next_steps && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
              <span className="font-semibold">Next: </span>{c.next_steps}
            </p>
          )}
          {c.recording_url && (
            <a href={c.recording_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-amber-500 hover:underline mt-1.5 inline-block">
              ▶ Listen to recording
            </a>
          )}

          {isOrphan && counterparty && <ResolveBar phone={counterparty} onResolve={onResolve} />}

          <div className="mt-2 flex items-center gap-2">
            {counterparty && replyTo !== counterparty && (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => onReplyOpen(counterparty)}>
                <MessageSquare className="h-3 w-3 mr-1" /> Send SMS
              </Button>
            )}
          </div>
          {counterparty && (
            <ReplyBox
              to={counterparty} contactId={c.contact_id}
              replyTo={replyTo} replyBody={replyBody} setReplyBody={setReplyBody}
              sending={sending} sendReply={sendReply}
              onClose={() => onReplyOpen("")}
            />
          )}
        </div>
        <button
          onClick={() => onToggle("call", c.id, c.portal_visible)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          title={c.portal_visible ? "Hide from portal" : "Show in portal"}
        >
          {c.portal_visible ? <Eye className="h-4 w-4 text-amber-500" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
    </Card>
  );
}

function ResolveOrphanDialog({
  open, onOpenChange, phone, onResolved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  phone: string; onResolved: () => void;
}) {
  const [mode, setMode] = useState<"create" | "link">("create");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ContactLite[]>([]);

  useEffect(() => {
    if (open) {
      setMode("create");
      setFirstName(""); setLastName(""); setEmail("");
      setSearch(""); setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (mode !== "link" || search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke("quo-service", {
          body: { action: "searchContacts", q: search },
        });
        setResults(data?.contacts || []);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [search, mode]);

  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("quo-service", {
        body: { action: "createContactFromPhone", phone, firstName, lastName, email },
      });
      if (error) throw error;
      toast.success(`Contact created · linked ${data.linkedMessages} messages, ${data.linkedCalls} calls`);
      onOpenChange(false);
      onResolved();
    } catch (err: any) {
      toast.error(`Create failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  const link = async (contactId: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("quo-service", {
        body: { action: "linkPhoneToContact", phone, contactId },
      });
      if (error) throw error;
      toast.success(`Linked ${data.linkedMessages} messages, ${data.linkedCalls} calls`);
      onOpenChange(false);
      onResolved();
    } catch (err: any) {
      toast.error(`Link failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve {phone}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => setMode("create")}
            className={`px-3 py-2 text-sm border-b-2 ${mode === "create" ? "border-amber-500 text-foreground" : "border-transparent text-muted-foreground"}`}>
            <UserPlus className="h-3.5 w-3.5 inline mr-1" /> Create new
          </button>
          <button
            onClick={() => setMode("link")}
            className={`px-3 py-2 text-sm border-b-2 ${mode === "link" ? "border-amber-500 text-foreground" : "border-transparent text-muted-foreground"}`}>
            <Link2 className="h-3.5 w-3.5 inline mr-1" /> Link to existing
          </button>
        </div>

        {mode === "create" ? (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <Input placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Phone <span className="font-mono">{phone}</span> will be saved and all matching SMS/calls back-linked.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={create} disabled={busy || !firstName.trim()}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create &amp; Link
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <Input
              autoFocus placeholder="Search contacts by name, email or phone…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {results.length === 0 && search.length >= 2 && (
                <p className="text-xs text-muted-foreground italic p-2">No matches</p>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => link(c.id)}
                  disabled={busy}
                  className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted text-left text-sm"
                >
                  <span>
                    <span className="font-medium">{c.first_name} {c.last_name}</span>
                    <span className="text-muted-foreground"> · {c.email || c.phone || "—"}</span>
                  </span>
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
