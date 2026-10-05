// web-push.ts — sends one Web Push message. Uses the reference `web-push`
// library only to build the encrypted, VAPID-signed request (verified to run
// under Deno); the network call is a plain fetch so we control status handling.

// @ts-ignore: npm: specifier; web-push ships no types
import webpush from "npm:web-push@3.6.7";
import { classifyPushStatus, type PushOutcome, type PushPayload } from "./push-payload.ts";

export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }
export interface VapidConfig { subject: string; publicKey: string; privateKey: string }

export function vapidFromEnv(): VapidConfig | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  return publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
}

export async function sendWebPush(sub: PushSubscriptionRow, payload: PushPayload, vapid: VapidConfig): Promise<PushOutcome> {
  try {
    const d = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600, urgency: "normal" },
    );
    const res = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body });
    await res.body?.cancel();
    return classifyPushStatus(res.status);
  } catch (e) {
    console.error("[web-push] send threw:", e instanceof Error ? e.message : String(e));
    return "retry";
  }
}
