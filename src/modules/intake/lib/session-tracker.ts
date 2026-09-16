import { useEffect, useRef } from "react";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ENDPOINT = `${FUNCTIONS_URL}/georgia2-session`;

export interface Georgia2SessionPatch {
  domain?: string | null;
  catalyst?: string | null;
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const PENDING: Georgia2SessionPatch = {};
let CURRENT_KEY: string | null = null;

function flushPending() {
  if (!CURRENT_KEY || Object.keys(PENDING).length === 0) return;
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
