/*
  Service Worker (o “modo offline” do app)

  O que ele faz:
  - Guarda os arquivos principais no cache pra abrir sem internet.
  - Pra API: tenta internet primeiro (se cair, tenta o cache).
  - Pros arquivos do app: usa cache primeiro (fica bem rápido).
*/
const CACHE_VERSION = "simbi-lite-v0.4.6";
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname.replace(/\/$/, "");
const API_PREFIX = `${SCOPE_PATH}/api/`;

const CORE_PATHS = [
  "./",
  "inicio.php",
  "manifesto.webmanifest",
  "icone.php?size=192",
  "icone.php?size=512",
  "app/css/estilo.css",
  "app/js/aplicativo.js",
  "app/js/sincronizacao.js",
  "app/js/lib/utilitarios.js",
  "app/js/lib/banco_local.js",
  "app/js/lib/cliente_api.js",
  "app/js/lib/dispositivo.js",
  "app/js/lib/imagem.js",
  "app/js/cv/solo.js",
  "app/js/cv/pragas.js",
  "app/js/cv/planta.js"
];

const CDN = [
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_PATHS.map(p => new URL(p, SCOPE).toString()));
    for (const url of CDN) {
      try { await cache.add(url); } catch {}
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_VERSION ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

/**
 * Jeito 1 (cache primeiro):
 * - se já tem no cache, usa
 * - se não tiver, busca na internet e guarda no cache
 */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const key = cacheKey(req);
  const hit = await cache.match(key, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(key, res.clone());
  return res;
}

/**
 * Jeito 2 (internet primeiro) pra API:
 * - tenta buscar na internet
 * - se não tiver internet, tenta pegar do cache (se tiver)
 * - se não tiver nada, devolve um erro 503 em JSON
 */
async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const key = cacheKey(req);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key, { ignoreSearch: false });
    if (hit) return hit;
    return new Response(JSON.stringify({ ok: false, error: { message: "Sem internet (offline)." } }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

/**
 * Ajusta a “chave” do cache:
 * - na API e no icone.php a gente mantém os parâmetros da URL
 * - nos arquivos normais, a gente ignora os parâmetros pra reaproveitar melhor o cache
 */
function cacheKey(req) {
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return req;
  if (url.pathname.startsWith(API_PREFIX)) return req;
  if (url.pathname.endsWith("/icone.php")) return req;
  return new Request(url.origin + url.pathname, { method: "GET" });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(API_PREFIX)) {
      event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.hostname.endsWith("jsdelivr.net")) {
    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "rq-sync") return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: "RQ_TRY_SYNC" });
  })());
});
