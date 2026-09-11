/*
 * FMB Purchasing service worker — push notifications only (scratchpad #28).
 *
 * Deliberately does no caching: the app is always online-first, and a stale
 * cached page of approvals or payments would be worse than a slow one.
 * Offline receipt capture (#47) is handled separately in the page itself.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "FMB Purchasing" };
  }

  const title = data.title || "FMB Purchasing";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || undefined,
      icon: "/fmb-logo.png",
      badge: "/fmb-logo.png",
      // A second notification about the same expense replaces the first rather
      // than stacking up on the lock screen.
      tag: data.tag || undefined,
      data: { url: data.url || "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          return client.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
