/* LifeLink PWA service worker.
   Cache only the application shell and same-origin static assets.
   Authentication, account data, AI, APIs and third-party services are never cached. */
const VERSION = "v7-native-volume-keys-only";
const SHELL_CACHE = "lifelink-shell-" + VERSION;
const ASSET_CACHE = "lifelink-assets-" + VERSION;
const APP_BASE = new URL(self.registration.scope);
const APP_ROOT = APP_BASE.href;
const INDEX_URL = new URL("index.html", APP_BASE).href;
const OFFLINE_URL = new URL("offline.html", APP_BASE).href;
const CORE_FILES = [
  APP_ROOT,
  INDEX_URL,
  new URL("manifest.webmanifest", APP_BASE).href,
  new URL("favicon.svg", APP_BASE).href,
  new URL("lifelink-icon-192.png", APP_BASE).href,
  new URL("lifelink-logo.webp", APP_BASE).href,
  OFFLINE_URL
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(CORE_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith("lifelink-shell-") || name.startsWith("lifelink-assets-"))
      .filter(name => name !== SHELL_CACHE && name !== ASSET_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE.pathname)) return;

  // Navigation is network-first so deployed fixes are picked up promptly.
  // A previously cached app shell is used only when the network is unavailable.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type !== "opaque") {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(APP_ROOT, response.clone());
          await cache.put(INDEX_URL, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) ||
          (await caches.match(APP_ROOT)) ||
          (await caches.match(INDEX_URL)) ||
          (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // Cache only static application resources. Never cache API calls, auth
  // endpoints, user content, compiler requests or cross-origin responses.
  if (!/\.(?:css|js|mjs|svg|webmanifest|png|webp|ico|woff2?)$/i.test(url.pathname)) return;
  if (/\/api\//i.test(url.pathname)) return;

  const cachePromise = caches.open(ASSET_CACHE);
  const refreshPromise = fetch(request).then(async response => {
    if (response && response.ok && response.type !== "opaque") {
      const cache = await cachePromise;
      await cache.put(request, response.clone());
    }
    return response;
  });
  // Register background refresh synchronously while the fetch event is active.
  event.waitUntil(refreshPromise.then(() => {}, () => {}));
  event.respondWith((async () => {
    const cache = await cachePromise;
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      return await refreshPromise;
    } catch {
      return new Response("This LifeLink resource is not available offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        await client.focus();
        try { await client.navigate(new URL("#/activity", APP_ROOT).href); } catch {}
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(new URL("#/activity", APP_ROOT).href);
  })());
});
