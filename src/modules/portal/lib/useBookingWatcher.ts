import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/shared/integrations/supabase/client";

export interface FoundMeeting { label: string; start: string }

/** Asks the server whether a review meeting the client owes has just appeared on the calendar. */
export async function checkMeetingBookings(portalToken: string): Promise<FoundMeeting[]> {
  if (!portalToken) return [];
  try {
    const { data, error } = await supabase.functions.invoke("portal-meeting-check", { body: { portal_token: portalToken } });
    if (error || data?.error) return [];
    return (data?.found ?? []) as FoundMeeting[];
  } catch {
    return [];
  }
}

const POLL_MS = 10_000;
const MAX_POLLS = 90; // about fifteen minutes with the scheduler open
const RETRY_AFTER_CLOSE_MS = 6_000;

/**
 * While a booking scheduler is open (`active`), looks for the new meeting every few seconds; once it closes (Back to Meetings, or
 * leaving the tab) it checks once more, and once again a few seconds later in case the calendar was slow. When a meeting is found
 * it calls `onFound` so the page can refresh and show "Your meeting is booked".
 */
export function useBookingWatcher({ portalToken, active, onFound }: { portalToken: string; active: boolean; onFound: (found: FoundMeeting[]) => void }) {
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  const tokenRef = useRef(portalToken);
  tokenRef.current = portalToken;
  const wasActive = useRef(false);
  const polls = useRef(0);

  const checkNow = useCallback(async () => {
    const found = await checkMeetingBookings(tokenRef.current);
    if (found.length) onFoundRef.current(found);
    return found.length > 0;
  }, []);

  useEffect(() => {
    if (!active) return;
    polls.current = 0;
    const id = window.setInterval(async () => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) { window.clearInterval(id); return; }
      if (await checkNow()) window.clearInterval(id);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [active, checkNow]);

  useEffect(() => {
    if (wasActive.current && !active) {
      void checkNow();
      const retry = window.setTimeout(() => void checkNow(), RETRY_AFTER_CLOSE_MS);
      wasActive.current = active;
      return () => window.clearTimeout(retry);
    }
    wasActive.current = active;
  }, [active, checkNow]);
}
