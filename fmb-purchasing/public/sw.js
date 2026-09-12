/*
 * FMB Purchasing service worker: push notifications (scratchpad #28), and a
 * page for taking receipt photos when there is no connection (#47).
 *
 * Still online-first. Nothing the app shows is ever served from a cache — a
 * stale page of approvals or payments would be worse than a slow one. The one
 * thing kept is /offline.html, shown only when a page can't be reached at
 * all, so a receipt can still be photographed in a car park with no signal.
 */

const OFFLINE_CACHE = "fmb-offline-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/fmb-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      // Fetched fresh rather than from the HTTP cache, so an update to the
      // offline page reaches phones with the next service worker.
      await cache.addAll(OFFLINE_ASSETS.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("fmb-offline-") && n !== OFFLINE_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || Response.error();
      })
    );
    return;
  }

  // The offline page's own image, when the network can't supply it.
  if (new URL(request.url).pathname === "/fmb-logo.png") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/fmb-logo.png")) || Response.error()));
  }
});

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
