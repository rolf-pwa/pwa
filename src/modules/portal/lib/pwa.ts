// Pure helpers for the client PWA features (push subscription, document scanner).

/** Web Push's applicationServerKey must be a Uint8Array, but VAPID keys are distributed as base64url. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string } }

/** Narrows a browser PushSubscription's JSON to what portal-pwa needs, or null if it's incomplete. */
export function toSubscriptionJson(sub: { toJSON(): unknown }): PushSubscriptionJson | null {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return j.endpoint && j.keys?.p256dh && j.keys?.auth
    ? { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }
    : null;
}

export const isIos = (ua: string) => /iPad|iPhone|iPod/.test(ua);

/** iOS only delivers Web Push to a web app that's been added to the Home Screen. */
export function pushNeedsInstall(ua: string, standalone: boolean): boolean {
  return isIos(ua) && !standalone;
}

/** Fit an image on a page, preserving aspect ratio, centred inside a margin. */
export function fitOnPage(imgW: number, imgH: number, pageW = 595.28, pageH = 841.89, margin = 24) {
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / imgW, maxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { width, height, x: (pageW - width) / 2, y: (pageH - height) / 2 };
}
