// Service worker: deja el shell de la app (y el detector de rostro bajado
// del CDN) en caché para que el kiosco abra aunque se caiga el internet.
// Las marcaciones viven en IndexedDB, no aquí. Estrategia "red primero"
// (lección de Hub Limpieza: con "caché primero" las tablets se quedaban
// para siempre con la primera versión del JS).
const CACHE_NAME = "hub-asistencia-v2";
const SHELL_FILES = [
  "./", "./index.html", "./manifest.json", "./css/styles.css", "./icons/logo.png", "./icons/icon-192.png",
  "./js/app.js", "./js/config.js", "./js/auth.js", "./js/graph.js", "./js/db.js",
  "./js/store.js", "./js/camera.js", "./js/kiosk.js", "./js/admin.js", "./js/dom.js",
  "./vendor/msal-browser.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.hostname.includes("graph.microsoft.com") || url.hostname.includes("login.microsoftonline.com")) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
