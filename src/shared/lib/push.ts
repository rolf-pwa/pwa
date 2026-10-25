import { supabase } from "@/shared/integrations/supabase/client";

export const PUSH_CATEGORIES = [
  { id: "texts", label: "Texts", hint: "A client texts you, and urgent texts Georgia flags" },
  { id: "calls", label: "Voicemails", hint: "A client leaves a voicemail" },
  { id: "requests", label: "Client requests", hint: "New requests, replies, Ask Georgia flags and task replies" },
  { id: "documents", label: "Signed documents", hint: "A client signs an insurance or investment document" },
  { id: "alerts", label: "System alerts", hint: "Something in the system failed" },
] as const;

/** Push needs a service worker, the push manager and notifications; on an iPhone only the app on the home screen has them. */
export function pushSupported(): boolean {
  try { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; } catch { return false; }
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* push is optional */ }); });
}

async function ea<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { ok?: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("daily-briefing-generate", { body });
  if (error) throw new Error(error.message);
  return data as T & { ok?: boolean; error?: string };
}

const keyBytes = (b64: string) => {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; }
}

export async function enablePush(): Promise<PushSubscription> {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them for ProsperWise in the phone's Settings.");
  const { key } = await ea<{ key: string }>({ action: "ea_push_key" });
  if (!key) throw new Error("Notifications are not set up on the server yet.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const r = await ea({ action: "ea_push_subscribe", subscription: sub.toJSON() });
  if (!r.ok) { await sub.unsubscribe().catch(() => undefined); throw new Error(r.error || "Could not turn notifications on"); }
  return sub;
}

export async function disablePush(sub: PushSubscription) {
  await ea({ action: "ea_push_unsubscribe", endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export const savePushPrefs = (endpoint: string, prefs: { categories?: string[]; quiet?: boolean }) => ea({ action: "ea_push_prefs", endpoint, ...prefs });
export const sendPushTest = (endpoint: string) => ea<{ sent: number }>({ action: "ea_push_test", endpoint });

/** This device's saved choices (which kinds buzz, quiet hours). */
export async function loadPushPrefs(endpoint: string): Promise<{ categories: string[]; quiet: boolean } | null> {
  const { data } = await (supabase.from("push_subscriptions" as never) as any).select("categories, quiet").eq("endpoint", endpoint).maybeSingle();
  return data ?? null;
}
