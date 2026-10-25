import { useEffect, useState } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/shared/integrations/supabase/client";
import { withAuthRaceRetry } from "@/shared/lib/authRaceRetry";

export interface AttentionCounts { inbox: number | null; requests: number | null; review: number | null }

/** What is waiting on staff, for the badges: unread texts and calls, open client requests, and reviews pending. Texts and calls update as they arrive. */
export function useAttentionCounts(): AttentionCounts {
  const { user } = useAuth();
  const [review, setReview] = useState<number | null>(null);
  const [requests, setRequests] = useState<number | null>(null);
  const [inbox, setInbox] = useState<number | null>(null);

  useEffect(() => {
    // ProtectedRoute already waits for auth to resolve before this ever mounts, but there's still a brief window right after an OAuth redirect where the Supabase
    // client's session isn't fully settled for outgoing requests yet (see authRaceRetry.ts). Bail out if there's no user yet, and retry once on a transient failure.
    if (!user) return;

    (async () => {
      try {
        const { count } = await withAuthRaceRetry<any>(() => (supabase.from("review_queue" as any) as any).select("id", { count: "exact", head: true }).eq("status", "pending"));
        setReview(count ?? 0);
      } catch {}
    })();

    (async () => {
      try {
        const { count } = await withAuthRaceRetry<any>(() => (supabase.from("portal_requests").select("id", { count: "exact", head: true }).in("status", ["submitted", "in_progress"]) as any));
        setRequests(count ?? 0);
      } catch {}
    })();

    const loadInboxUnread = async () => {
      try {
        const { data } = await withAuthRaceRetry(() => supabase.functions.invoke("quo-service", { body: { action: "unreadCount" } }));
        setInbox(data?.unread ?? 0);
      } catch {}
    };
    loadInboxUnread();

    const channel = supabase
      .channel("attention-quo-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_messages" }, loadInboxUnread)
      .on("postgres_changes", { event: "*", schema: "public", table: "quo_calls" }, loadInboxUnread)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return { inbox, requests, review };
}
