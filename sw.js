/* Service worker voor de Contactplanner.
   Strategie:
   - vendor/ (SheetJS) en iconen: cache-first — groot en vrijwel onveranderlijk.
   - al het overige (index.html, app.js, styles.css, manifest): network-first met
     cache-fallback, zodat een nieuwe versie direct wordt opgepikt maar de app
     offline blijft werken.
   Verhoog CACHE_VERSIE bij elke wijziging aan de app-bestanden. */

const CACHE_VERSIE = "contactplanner-v4";
const KERN_BESTANDEN = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "vendor/xlsx.full.min.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "img/scipio-importselectie.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSIE).then((cache) => cache.addAll(KERN_BESTANDEN)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE_VERSIE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  const cacheFirst = url.pathname.includes("/vendor/") || url.pathname.includes("/icons/") || url.pathname.includes("/img/");
  if (cacheFirst) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
        const kopie = resp.clone();
        caches.open(CACHE_VERSIE).then((cache) => cache.put(e.request, kopie));
        return resp;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const kopie = resp.clone();
        caches.open(CACHE_VERSIE).then((cache) => cache.put(e.request, kopie));
        return resp;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
