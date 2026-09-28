import { useEffect, useRef } from "react";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ENDPOINT = `${FUNCTIONS_URL}/georgia2-session`;

export interface Georgia2SessionPatch {
  domain?: string | null;
  catalyst?: string | null;
  spoke?: string | null;
  source?: string | null;
  answers?: Record<string, unknown>;
  scale?: number;
  chosen_pathway?: string | null;
  final_phase?: string;
  reached_lead_capture?: boolean;
  lead_captured?: boolean;
  ended?: boolean;
  /** First-reach timestamps per Stepper-labeled step -- see Georgia2App.tsx, sent once per step per session. */
  step_domain_reached_at?: string;
  step_catalyst_reached_at?: string;
  step_diagnostic_reached_at?: string;
  step_pathway_reached_at?: string;
  step_confidential_reached_at?: string;
}

// "Started" on the Analytics dashboard should mean a real visitor, not a
// crawler or link-preview bot that merely renders the page (server-side bot
// filtering in georgia2-session catches self-identifying ones, but not every
// automated renderer names itself). Nothing is sent to georgia2-session --
// not even the very first ping that creates the session row -- until the
// visit looks "engaged": either a real input event, or the tab having
// stayed visible for a couple of seconds. This never delays anything the
// visitor sees; it only delays when analytics data is written.
const ENGAGE_DWELL_MS = 2500;
let engaged = false;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;

function markEngaged() {
  if (engaged) return;
  engaged = true;
  flushPending();
}

function armDwellTimer() {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  dwellTimer = setTimeout(markEngaged, ENGAGE_DWELL_MS);
}

function clearDwellTimer() {
  if (dwellTimer) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
  }
}

if (typeof window !== "undefined") {
  const ENGAGEMENT_EVENTS = ["pointerdown", "mousemove", "keydown", "touchstart", "scroll"] as const;
  const onFirstInteraction = () => {
    markEngaged();
    for (const evt of ENGAGEMENT_EVENTS) window.removeEventListener(evt, onFirstInteraction);
  };
  for (const evt of ENGAGEMENT_EVENTS) window.addEventListener(evt, onFirstInteraction, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") armDwellTimer();
    else clearDwellTimer();
  });
  armDwellTimer();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const PENDING: Georgia2SessionPatch = {};
let CURRENT_KEY: string | null = null;

function flushPending() {
  if (!engaged || !CURRENT_KEY || Object.keys(PENDING).length === 0) return;
  const body = JSON.stringify({ session_key: CURRENT_KEY, ...PENDING });
  for (const k of Object.keys(PENDING)) delete (PENDING as Record<string, unknown>)[k];
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function bindGeorgia2Session(sessionKey: string) {
  CURRENT_KEY = sessionKey;
}

export function trackGeorgia2(update: Georgia2SessionPatch) {
  if (!CURRENT_KEY) return;
  Object.assign(PENDING, update);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPending, 700);
}

export function useGeorgia2ExitBeacon(getState: () => Georgia2SessionPatch, sessionKey: string) {
  const stateRef = useRef(getState);
  stateRef.current = getState;
  useEffect(() => {
    bindGeorgia2Session(sessionKey);
    const send = () => {
      // A visit that never became "engaged" never had a row created for it
      // (see flushPending above) -- nothing to update on the way out either.
      if (!engaged) return;
      const payload = JSON.stringify({
        session_key: sessionKey,
        ...stateRef.current(),
        ended: true,
      });
      try {
        const blob = new Blob([payload], { type: "application/json" });
        const ok = navigator.sendBeacon?.(ENDPOINT, blob);
        if (!ok) {
          fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => undefined);
        }
      } catch {
        /* noop */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") send();
    };
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", onVis);
    // initial ping to create the row
    trackGeorgia2({ final_phase: "chat" });
    return () => {
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [sessionKey]);
}
