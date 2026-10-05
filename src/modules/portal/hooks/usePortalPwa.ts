import { useCallback, useEffect, useState } from "react";
import { toSubscriptionJson, urlBase64ToUint8Array } from "../lib/pwa";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callPwa(portalToken: string, body: Record<string, unknown>) {
  const res = await fetch(`${FUNCTIONS_URL}/portal-pwa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-portal-token": portalToken },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export type PushState = "unsupported" | "blocked" | "off" | "on";

/**
 * Client-portal PWA features. `enabled` mirrors the household's V2 flag, so
 * V1 households see nothing and never register a service worker.
 */
export function usePortalPwa(portalToken: string | undefined) {
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);

  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!portalToken) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await callPwa(portalToken, { action: "status" });
        if (cancelled || !s.enabled) return;
        setEnabled(true); setPublicKey(s.publicKey ?? null);
        if (!supported) { setState("unsupported"); return; }
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (Notification.permission === "denied") { setState("blocked"); return; }
        setState((await reg.pushManager.getSubscription()) ? "on" : "off");
      } catch { /* PWA features are optional; the portal works without them */ }
    })();
    return () => { cancelled = true; };
  }, [portalToken, supported]);

  const subscribe = useCallback(async () => {
    if (!portalToken || !publicKey) throw new Error("Notifications aren't set up yet");
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      const json = toSubscriptionJson(sub);
      if (!json) throw new Error("This device returned an incomplete subscription");
      await callPwa(portalToken, { action: "subscribe", subscription: json, userAgent: navigator.userAgent });
      setState("on");
    } finally { setBusy(false); }
  }, [portalToken, publicKey]);

  const unsubscribe = useCallback(async () => {
    if (!portalToken) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await callPwa(portalToken, { action: "unsubscribe", endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  }, [portalToken]);

  return { enabled, state, busy, subscribe, unsubscribe };
}
