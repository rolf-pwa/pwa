import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";
import { format } from "date-fns";

interface PortalRequest {
  id: string;
  request_type: string;
  request_description: string;
  status: string;
  messages?: {
    id: string;
    sender_type: string;
    sender_name: string | null;
    content: string;
    created_at: string;
  }[];
}

interface ClientNotification {
  id: string;
  title: string;
  body: string | null;
  source_type: string;
  link_tab: string | null;
  read: boolean;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  banking_withdrawal: "Banking & Withdrawals",
  personal_info: "Personal Info",
  document_request: "Document Request",
  general_inquiry: "General Inquiry",
};

function getSeenMessageIds(contactId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`portal_seen_msgs_${contactId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markMessagesSeen(contactId: string, ids: string[]) {
  const existing = getSeenMessageIds(contactId);
  ids.forEach((id) => existing.add(id));
  localStorage.setItem(`portal_seen_msgs_${contactId}`, JSON.stringify([...existing]));
}

const SOURCE_ICONS: Record<string, string> = {
  task_comment: "🗨️",
  task_completed: "✅",
  task_reopened: "🔄",
  task_updated: "📋",
  ask_georgia_reply: "💬",
};

interface Props {
  requests: PortalRequest[];
  contactId: string;
  portalToken: string;
  onNavigateToRequests: () => void;
  onNavigateToTasks?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToDocuments?: () => void;
  onOpenGeorgia?: () => void;
}

export function PortalNotificationBell({ requests, contactId, portalToken, onNavigateToRequests, onNavigateToTasks, onNavigateToDashboard, onNavigateToDocuments, onOpenGeorgia }: Props) {
  const [open, setOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [clientNotifs, setClientNotifs] = useState<ClientNotification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeenIds(getSeenMessageIds(contactId));
    // Fetch portal client notifications via secure edge function
    (async () => {
      const resp = await supabase.functions.invoke("portal-notifications", {
        body: { action: "list", contact_id: contactId, portal_token: portalToken },
      });
      if (!resp.error && resp.data?.data) {
        setClientNotifs(resp.data.data as ClientNotification[]);
      }
    })();
  }, [contactId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Collect all unread advisor messages across requests
  const unreadMessages = requests.flatMap((req) =>
    (req.messages || [])
      .filter((m) => m.sender_type === "advisor" && !seenIds.has(m.id))
      .map((m) => ({ ...m, requestType: req.request_type, requestId: req.id, _kind: "request" as const }))
  );

  // Merge both notification types into a single sorted list
  const allNotifications = [
    ...unreadMessages.map((m) => ({
      id: m.id,
      title: `New reply on ${TYPE_LABELS[m.requestType] || m.requestType}`,
      body: m.content,
      icon: "💬",
      created_at: m.created_at,
      kind: "request" as const,
      requestId: m.requestId,
    })),
    ...clientNotifs.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      icon: SOURCE_ICONS[n.source_type] || "🔔",
      created_at: n.created_at,
      kind: "task" as const,
      linkTab: n.link_tab,
      sourceType: n.source_type,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const unreadCount = allNotifications.length;

  const handleOpen = () => setOpen(!open);

  const handleMarkAllRead = async () => {
    // Mark request messages seen
    const allAdvisorMsgIds = requests.flatMap((req) =>
      (req.messages || []).filter((m) => m.sender_type === "advisor").map((m) => m.id)
    );
    markMessagesSeen(contactId, allAdvisorMsgIds);
    setSeenIds(getSeenMessageIds(contactId));

    // Mark client notifications read via secure edge function
    if (clientNotifs.length > 0) {
      const ids = clientNotifs.map((n) => n.id);
      await supabase.functions.invoke("portal-notifications", {
        body: { action: "mark_read", contact_id: contactId, notification_ids: ids, portal_token: portalToken },
      });
      setClientNotifs([]);
    }
  };

  const handleClickNotif = async (notif: (typeof allNotifications)[0]) => {
    if (notif.kind === "request") {
      // Mark all messages in this request as seen
      const req = requests.find((r) => r.id === notif.requestId);
      if (req) {
        const ids = (req.messages || []).filter((m) => m.sender_type === "advisor").map((m) => m.id);
        markMessagesSeen(contactId, ids);
        setSeenIds(getSeenMessageIds(contactId));
      }
      setOpen(false);
      onNavigateToRequests();
    } else {
      // Mark this client notification as read via secure edge function
      await supabase.functions.invoke("portal-notifications", {
        body: { action: "mark_read", contact_id: contactId, notification_ids: [notif.id], portal_token: portalToken },
      });
      setClientNotifs((prev) => prev.filter((n) => n.id !== notif.id));
      setOpen(false);
      if ((notif as { sourceType?: string }).sourceType === "ask_georgia_reply" && onOpenGeorgia) onOpenGeorgia();
      else if ((notif as { linkTab?: string | null }).linkTab === "documents" && onNavigateToDocuments) onNavigateToDocuments(); // a report the advisor shared: the Documents page
      else if ((notif as { linkTab?: string | null }).linkTab === "dashboard" && onNavigateToDashboard) onNavigateToDashboard(); // a waiting document: the card on the dashboard
      else if (onNavigateToTasks) onNavigateToTasks();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative rounded-md p-1.5 text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-foreground text-[9px] font-bold text-primary px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border bg-background shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:text-primary/80 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {allNotifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No new notifications
              </div>
            ) : (
              allNotifications.slice(0, 20).map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClickNotif(notif)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 border-b border-border last:border-0 bg-primary/5"
                >
                  <span className="text-base mt-0.5">{notif.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight text-foreground">
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {format(new Date(notif.created_at), "MMM d, h:mm a")}
                    </p>
                  </div>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
