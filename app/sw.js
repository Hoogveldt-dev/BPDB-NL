// Eenvoudige service worker: app-schil offline beschikbaar, data altijd vers van het netwerk.
const CACHE = "bierkoers-v19";
const SCHIL = ["./", "index.html", "styles.css", "app.js", "config.js", "icon.svg", "icon-180.png", "icon-512.png", "icon-maskable-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SCHIL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Alleen de eigen app-bestanden; Supabase, kaarttegels en CDN's gaan direct naar het netwerk.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const kopie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); return r; })
      .catch(() => caches.match(e.request)),
  );
});
