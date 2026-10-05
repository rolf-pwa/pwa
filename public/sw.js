// ProsperWise service worker. Deliberately minimal: it handles Web Push and
// notification taps only. It does NOT cache anything or intercept requests,
// so a deploy is never masked by a stale cached app shell and the staff app
// is unaffected.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Present so the app is installable; passes every request straight through.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* malformed payload: fall back below */ }
  const title = typeof data.title === "string" && data.title ? data.title : "ProsperWise";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "Open your portal to see what's new.",
      tag: typeof data.tag === "string" ? data.tag : "pw-update",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/portal" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
