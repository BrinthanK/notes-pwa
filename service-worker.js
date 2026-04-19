const CACHE_NAME = "notes-v2";

const BASE_PATH = self.location.pathname.replace(/service-worker\.js$/, "");

function asset(pathSuffix) {
  const suffix = pathSuffix.startsWith("/") ? pathSuffix.slice(1) : pathSuffix;
  const base = BASE_PATH.endsWith("/") ? BASE_PATH : `${BASE_PATH}/`;
  return `${base}${suffix}`;
}

const PRECACHE_URLS = [
  asset("index.html"),
  asset("styles.css"),
  asset("manifest.json"),
  asset("js/app.js"),
  asset("js/state.js"),
  asset("js/db.js"),
  asset("js/ui.js"),
  asset("js/utils.js"),
  asset("js/crypto.js"),
  asset("js/session.js"),
  asset("js/model.js"),
  asset("js/migrate.js"),
  asset("js/editors.js"),
  asset("assets/icons/icon-192.png"),
  asset("assets/icons/icon-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => (key === CACHE_NAME ? Promise.resolve() : caches.delete(key)))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req)
        .then((response) => {
          const copy = response.clone();
          if (response.ok && response.type === "basic") {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => offlineFallback(req));
    })
  );
});

function offlineFallback(req) {
  if (req.mode === "navigate") {
    return caches.match(asset("index.html"));
  }
  return caches.match(req);
}
