/*
  SIMBIOSIS LITE (feito pra rodar no celular e funcionar sem internet)

  Ideia do app:
  - O usuário faz os registros normalmente (mesmo offline).
  - A gente salva tudo no banco local (IndexedDB).
  - Quando tem internet, o app tenta sincronizar sozinho em segundo plano.

  Como o arquivo está organizado:
  - Cada tela é uma função que monta o DOM.
  - Quase tudo vira um item do Diário (registro) pra ficar salvo.
*/
import { el, qs, qsa, setNetBadge, toast, uuidv4, nowIso, humanDateTime, isOnline, shareOrCopy, isStandalone, isIos } from "./lib/utilitarios.js";
import { userGet, userPut, recordPut, recordsListByType, recordsListRecent, imagePut, imagesByRecord, metaGet, metaSet, outboxCount } from "./lib/banco_local.js";
import { apiFetch } from "./lib/cliente_api.js";
import { getDeviceId } from "./lib/dispositivo.js";
import { fileToBitmap, canvasFromBitmap, canvasToJpegBlob, centerImageData, photoQuality } from "./lib/imagem.js";
import { avgRgb, analyzeSoil } from "./cv/solo.js";
import { countDarkSpots, pestProfile, trendFromSeries } from "./cv/pragas.js";
import { plantAiFromImage, plantNutritionFromImage, plantStressFromImage } from "./cv/planta.js";
import { queueAlert, queueRecord, maybeRegisterBackgroundSync, trySync } from "./sincronizacao.js";

const appRoot = document.getElementById("rqApp");

let deferredInstallPrompt = null;
let syncingNow = false;
let activeCropCache = null;

/**
 * Guarda os erros de JavaScript pra gente conseguir ver depois se der problema.
 */
async function captureJsError(kind, errLike) {
  const info = normalizeError(errLike);
  const payload = { kind, at: nowIso(), ...info };
  try { await metaSet("last_js_error", payload); } catch {}
}

/**
 * Deixa o erro num formato simples ({ message, stack? }).
 */
function normalizeError(errLike) {
  if (!errLike) return { message: "Erro desconhecido." };
  if (typeof errLike === "string") return { message: errLike };
  const e = errLike;
  const message = String(e?.message || e?.toString?.() || "Erro");
  const stack = e?.stack ? String(e.stack) : null;
  return { message, stack };
}

window.addEventListener("error", (ev) => {
  captureJsError("error", ev?.error || ev?.message || "Erro");
});
window.addEventListener("unhandledrejection", (ev) => {
  captureJsError("promise", ev?.reason || "Promise rejeitada");
});

const CROPS = ["mandioca", "milho", "feijao", "melancia"];
const CROP_LABEL = {
  mandioca: "Mandioca",
  milho: "Milho",
  feijao: "Feijão",
  melancia: "Melancia"
};

/**
 * Deixa o nome da cultura bonitinho pra mostrar na tela (primeira letra maiúscula).
 */
function cropLabel(key) {
  const s = CROP_LABEL[key] || String(key || "");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pega a cultura ativa. Se não tiver, usa a primeira cultura do cadastro.
 */
async function getActiveCrop() {
  if (activeCropCache) return activeCropCache;
  const c = await metaGet("active_crop");
  if (c && typeof c === "string") {
    activeCropCache = c;
    return c;
  }
  const profile = await userGet();
  const fallback = profile?.crops?.[0] || null;
  if (fallback) {
    await metaSet("active_crop", fallback);
    activeCropCache = fallback;
    return fallback;
  }
  return null;
}

async function setActiveCrop(cropKey, { rerender = true } = {}) {
  const c = CROPS.includes(cropKey) ? cropKey : null;
  if (!c) return;
  await metaSet("active_crop", c);
  activeCropCache = c;
  toast(`Cultura ativa: ${cropLabel(c)}.`);
  if (rerender) render();
}

function plantModuleSupportsCrop(cropKey) {
  return CROPS.includes(cropKey);
}

const MODULES = [
  { route: "#/solo", icon: "🧪", title: "Foto Raio‑X do Solo", desc: "pH + palhada → dica simples" },
  { route: "#/pragas", icon: "🪲", title: "Espantalho Digital", desc: "foto da armadilha → conta insetos" },
  { route: "#/consorcio", icon: "🗺️", title: "Planejador de Consórcio", desc: "passos → mapa colorido" },
  { route: "#/planta", icon: "🪴", title: "Planta Falante", desc: "foto da folha → diz se molha" },
  { route: "#/diario", icon: "📒", title: "Diário da Roça", desc: "histórico da safra" }
];

function routeNow() {
  return location.hash || "#/home";
}

function setActiveNav() {
  const r = routeNow();
  for (const b of qsa(".rq-navbtn")) {
    const rr = b.getAttribute("data-route");
    b.setAttribute("aria-current", rr && r.startsWith(rr) ? "page" : "false");
  }
}

function mount(node) {
  appRoot.innerHTML = "";
  appRoot.append(node);
  appRoot.focus();
  setActiveNav();
}

async function ensureSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("trabalhador_servico.js", { scope: "./" });
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data?.type === "RQ_TRY_SYNC") {
        ensureServerUser().then(() => syncNow({ silent: true }));
      }
    });
  } catch {}
}

async function ensureServerUser() {
  const profile = await userGet();
  if (!profile) return false;
  if (!isOnline()) return false;
  const already = await metaGet("server_user_ok").catch(() => false);
  try {
    const me = await apiFetch("/users/me", { method: "GET" });
    const u = me?.user || null;
    if (u?.id) {
      if (u?.producer_code) {
        await metaSet(PRODUCER_CODE_META_KEY, String(u.producer_code)).catch(() => {});
        if (!profile.producer_code) {
          await userPut({ ...profile, producer_code: String(u.producer_code) });
        }
      }
      await metaSet("server_user_ok", true);
      return true;
    }
  } catch (e) {
    await metaSet("last_sync_error", { at: nowIso(), message: e?.message || String(e) }).catch(() => {});
  }
  if (already === true) await metaSet("server_user_ok", false).catch(() => {});
  try {
    const producerCode = profile?.producer_code || await metaGet(PRODUCER_CODE_META_KEY).catch(() => null);
    const reg = await apiFetch("/users/register", {
      method: "POST",
      body: { first_name: profile.first_name, community: profile.community, crops: profile.crops || [], producer_code: producerCode || null }
    });
    const u = reg?.user || null;
    if (u?.producer_code) {
      await metaSet(PRODUCER_CODE_META_KEY, String(u.producer_code)).catch(() => {});
      if (!profile.producer_code) {
        await userPut({ ...profile, producer_code: String(u.producer_code) });
      }
    }
    await metaSet("server_user_ok", true);
    return true;
  } catch (e) {
    await metaSet("last_sync_error", { at: nowIso(), message: e?.message || String(e) }).catch(() => {});
    return false;
  }
}

async function updateTopbar() {
  let pending = null;
  try { pending = await outboxCount(); } catch {}
  setNetBadge({ pending, syncing: syncingNow });
}

async function syncNow({ silent = true, all = false } = {}) {
  if (syncingNow) return { ok: false, reason: "busy" };
  syncingNow = true;
  await updateTopbar();
  let r = null;
  if (!all) {
    r = await trySync({ silent });
  } else {
    let pushed = 0;
    let pulled = 0;
    let batches = 0;
    for (let i = 0; i < 10; i++) {
      const one = await trySync({ silent: true });
      r = one;
      if (!one?.ok) break;
      pushed += Number(one.pushed || 0);
      pulled += Number(one.pulled || 0);
      batches++;
      const pending = await outboxCount().catch(() => 0);
      if (pending <= 0) break;
    }
    if (r?.ok) r = { ...r, pushed, pulled, batches };
    if (!silent) {
      if (r?.ok) toast(`Sincronizei. Enviei ${r.pushed || 0}, recebi ${r.pulled || 0}.`);
      else toast("Não deu pra sincronizar agora. Vou tentar depois.");
    }
  }
  syncingNow = false;
  await updateTopbar();
  return r;
}

function card(title, bodyNode, { subtitle = null } = {}) {
  return el("div", { class: "card rq-card" }, [
    el("div", { class: "card-body" }, [
      el("div", { class: "d-flex align-items-start justify-content-between gap-3" }, [
        el("div", {}, [
          el("h1", { class: "h5 fw-bold mb-1", text: title }),
          subtitle ? el("div", { class: "rq-help", text: subtitle }) : el("div")
        ]),
      ]),
      el("div", { class: "mt-3" }, [bodyNode])
    ])
  ]);
}

function bigButton({ icon, title, desc, onClick }) {
  return el("button", { class: "rq-btn-big", type: "button", onclick: onClick }, [
    el("div", { class: "rq-btn-big__icon", "aria-hidden": "true", text: icon }),
    el("div", { class: "flex-grow-1" }, [
      el("p", { class: "rq-btn-big__title", text: title }),
      el("p", { class: "rq-btn-big__desc", text: desc })
    ])
  ]);
}

function chips(list) {
  return el("div", { class: "d-flex flex-wrap gap-2" }, list.map(t => el("span", { class: "rq-badge", text: t })));
}

async function pickPhoto({ label = "Tirar foto" } = {}) {
  const input = el("input", { type: "file", accept: "image/*", capture: "environment", class: "d-none" });
  document.body.append(input);
  return await new Promise((resolve) => {
    input.addEventListener("change", () => {
      const f = input.files?.[0] || null;
      input.remove();
      resolve(f);
    }, { once: true });
    input.click();
  });
}

async function savePhotoToIdb(recordId, file) {
  try {
    const bmp = await fileToBitmap(file);
    const { canvas, ctx, width, height } = canvasFromBitmap(bmp, 1280, 1280);
    const blob = await canvasToJpegBlob(canvas, 0.72);
    const imgId = uuidv4();
    await imagePut({
      id: imgId,
      record_id: recordId,
      created_at: nowIso(),
      mime: "image/jpeg",
      width,
      height,
      blob
    });
    return { imgId, blob, width, height, ctx };
  } catch {
    toast("Não consegui salvar a foto (celular fraco). Mas salvei o registro no Diário.");
    return null;
  }
}

function imgPreviewFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = el("img", { class: "rq-photo", src: url, alt: "Foto" });
  img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  return img;
}

async function notifyLocal(title, body) {
  if (!("Notification" in window)) {
    toast(body);
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "icone.php?size=192" });
    return;
  }
  if (Notification.permission === "denied") {
    toast(body);
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted") new Notification(title, { body, icon: "icone.php?size=192" });
    else toast(body);
  } catch {
    toast(body);
  }
}

const GEO_COMMUNITY_CACHE_KEY = "geo_community_cache_v1";
const GEO_COMMUNITY_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const PRODUCER_CODE_META_KEY = "producer_code_v1";

function makeProducerCode(len = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function getOrCreateProducerCode() {
  const existing = await metaGet(PRODUCER_CODE_META_KEY).catch(() => null);
  if (typeof existing === "string" && existing.trim().length >= 6) return existing.trim();
  const code = makeProducerCode(10);
  await metaSet(PRODUCER_CODE_META_KEY, code).catch(() => {});
  return code;
}

function pickNominatimLocality(address) {
  if (!address || typeof address !== "object") return null;
  const place = String(
    address.village
      || address.town
      || address.city
      || address.hamlet
      || address.municipality
      || address.county
      || address.suburb
      || ""
  ).trim();
  const iso = String(
    address["ISO3166-2-lvl4"]
      || address["ISO3166-2-lvl6"]
      || address["ISO3166-2-lvl8"]
      || ""
  ).trim();
  const uf = iso.startsWith("BR-") ? iso.slice(3) : "";
  const state = String(address.state || "").trim();
  const tail = (uf || state).trim();
  const label = [place, tail].filter(Boolean).join(" - ").trim();
  return label.length >= 2 ? label : null;
}

async function geolocationCurrentPosition({ timeoutMs = 9000, maximumAgeMs = 120_000 } = {}) {
  if (!("geolocation" in navigator)) throw new Error("Geolocalização indisponível.");
  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: maximumAgeMs
    });
  });
}

async function reverseGeocodeCommunity(lat, lon, { timeoutMs = 8000 } = {}) {
  if (!isOnline()) throw new Error("Offline.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "12");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("Falha no geocoder.");
    const data = await res.json().catch(() => null);
    const community = pickNominatimLocality(data?.address || null);
    if (!community) throw new Error("Sem localidade.");
    return community;
  } finally {
    clearTimeout(t);
  }
}

async function maybeAutofillCommunityInput(communityInput) {
  if (!communityInput) return;
  if (String(communityInput.value || "").trim().length >= 2) return;

  const cached = await metaGet(GEO_COMMUNITY_CACHE_KEY).catch(() => null);
  if (cached?.community && cached?.at) {
    const ageMs = Date.now() - Date.parse(String(cached.at));
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= GEO_COMMUNITY_CACHE_TTL_MS) {
      communityInput.value = String(cached.community);
      return;
    }
  }

  let userTouched = false;
  const onUser = () => { userTouched = true; };
  communityInput.addEventListener("input", onUser, { once: true });

  const prevPh = communityInput.getAttribute("placeholder") || "";
  communityInput.setAttribute("placeholder", "Pegando sua localização…");
  try {
    const pos = await geolocationCurrentPosition();
    const lat = pos?.coords?.latitude;
    const lon = pos?.coords?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") throw new Error("Sem coordenadas.");
    const co = await reverseGeocodeCommunity(lat, lon);
    if (userTouched) return;
    if (String(communityInput.value || "").trim().length >= 2) return;
    communityInput.value = co;
    await metaSet(GEO_COMMUNITY_CACHE_KEY, { at: nowIso(), community: co, lat, lon }).catch(() => {});
  } catch {
  } finally {
    if (!userTouched) {
      communityInput.setAttribute("placeholder", prevPh);
    }
  }
}

async function screenOnboarding() {
  const existing = await userGet();
  const firstName = el("input", { class: "form-control form-control-lg", placeholder: "Ex.: Maria", value: existing?.first_name || "" });
  const community = el("input", { class: "form-control form-control-lg", placeholder: "Ex.: Lagoa Nova", value: existing?.community || "" });
  maybeAutofillCommunityInput(community);
  const producerCode = await getOrCreateProducerCode();
  const producerCodeShort = producerCode ? `${producerCode.slice(0, 4)}…${producerCode.slice(-3)}` : "";
  const recoverCode = el("input", { class: "form-control form-control-lg", placeholder: "Ex.: A2B3C4D5E6", autocapitalize: "characters" });
  const btnRecover = el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold", type: "button", text: "Entrar com meu código" });

  const crops = [
    { key: "mandioca", label: "Mandioca" },
    { key: "milho", label: "Milho" },
    { key: "feijao", label: "Feijão" },
    { key: "melancia", label: "Melancia" }
  ];
  const selected = new Set(existing?.crops || []);
  const checks = crops.map(c => {
    const id = `crop_${c.key}`;
    const input = el("input", { class: "form-check-input", type: "checkbox", id });
    if (selected.has(c.key)) input.checked = true;
    const label = el("label", { class: "form-check-label fw-bold", for: id, text: c.label });
    return el("div", { class: "form-check" }, [input, label]);
  });

  const btn = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Salvar meu cadastro" });
  btn.addEventListener("click", async () => {
    const fn = firstName.value.trim();
    const co = community.value.trim();
    const cs = [];
    for (const c of crops) {
      const ch = qs(`#crop_${c.key}`);
      if (ch?.checked) cs.push(c.key);
    }
    if (fn.length < 2) return toast("Bota seu primeiro nome.");
    if (co.length < 2) return toast("Bota o nome da comunidade.");

    const profile = { id: "me", first_name: fn, community: co, crops: cs, producer_code: producerCode, created_at: existing?.created_at || nowIso() };
    await userPut(profile);
    await metaSet("server_user_ok", false);
    toast("Pronto. Pode usar offline.");

    await recordPut({
      id: `profile:${profile.id}`,
      type: "profile",
      created_at: nowIso(),
      data: { first_name: fn, community: co, crops: cs, producer_code: producerCode }
    });

    ensureServerUser().then(() => syncNow({ silent: true }));
    location.hash = "#/home";
  });

  btnRecover.addEventListener("click", async () => {
    const code = recoverCode.value.trim().toUpperCase();
    if (code.length < 6) return toast("Digite seu código do produtor.");
    if (!isOnline()) return toast("Sem internet agora. Conecta e tenta de novo.");
    try {
      const res = await apiFetch("/users/claim_code", { method: "POST", body: { code } });
      const u = res?.user || null;
      if (!u?.first_name || !u?.community) throw new Error("Não consegui recuperar seu cadastro.");
      const prof = { id: "me", first_name: u.first_name, community: u.community, crops: u.crops || [], producer_code: u.producer_code || code, created_at: nowIso() };
      await userPut(prof);
      await metaSet(PRODUCER_CODE_META_KEY, prof.producer_code).catch(() => {});
      await metaSet("server_user_ok", true);
      await recordPut({ id: `profile:${prof.id}`, type: "profile", created_at: nowIso(), data: { first_name: prof.first_name, community: prof.community, crops: prof.crops, producer_code: prof.producer_code } });
      toast("Pronto. Recuperei seu cadastro nesse celular.");
      syncNow({ silent: true });
      location.hash = "#/home";
    } catch (e) {
      toast(e?.message || "Não consegui entrar com esse código.");
    }
  });

  const body = el("div", {}, [
    el("div", { class: "rq-help mb-3" }, [
      el("div", { text: "Bem rapidinho: só seu primeiro nome, comunidade e o que planta." }),
      el("div", { text: "Sem senha complicada. Funciona offline e sincroniza quando pega internet." }),
      producerCode ? el("div", { class: "mt-2" }, [
        el("div", { class: "rq-help", text: "Seu código do produtor (guarde pra trocar de celular):" }),
        el("div", { class: "d-flex align-items-center justify-content-between gap-2 mt-1" }, [
          el("span", { class: "rq-badge", text: producerCodeShort }),
          el("button", {
            class: "btn btn-outline-success btn-sm fw-bold",
            type: "button",
            text: "Copiar código",
            onclick: async () => {
              await shareOrCopy({ title: "SIMBIOSIS LITE", text: producerCode });
            }
          })
        ])
      ]) : el("div")
    ]),
    el("div", { class: "rq-field mb-3" }, [el("label", { class: "form-label", text: "Seu primeiro nome" }), firstName]),
    el("div", { class: "rq-field mb-3" }, [el("label", { class: "form-label", text: "Sua comunidade" }), community]),
    el("div", { class: "rq-field mb-3" }, [el("label", { class: "form-label", text: "O que você planta?" }), el("div", { class: "d-grid gap-2" }, checks)]),
    btn,
    el("div", { class: "rq-card card mt-2" }, [
      el("div", { class: "card-body" }, [
        el("div", { class: "fw-bold mb-1", text: "Trocar de celular" }),
        el("div", { class: "rq-help mb-2", text: "Se você já tem um código do produtor, digite aqui pra puxar seu cadastro." }),
        recoverCode,
        btnRecover
      ])
    ]),
    el("div", { class: "rq-help mt-3" }, [
      el("div", { text: "Dica: quando estiver com internet, deixe o app aberto um pouquinho pra sincronizar com a comunidade." })
    ])
  ]);
  return card("Seu cadastro", body, { subtitle: "Só o básico, do jeitinho da roça." });
}

async function screenHome() {
  const profile = await userGet();
  const pending = await outboxCount().catch(() => 0);
  const lastOk = await metaGet("last_sync_ok");
  const lastErr = await metaGet("last_sync_error").catch(() => null);
  const lastTry = await metaGet("last_sync_try").catch(() => null);
  const serverOk = await metaGet("server_user_ok").catch(() => null);
  const deviceId = await getDeviceId().catch(() => "");
  const producerCode = profile?.producer_code || await metaGet(PRODUCER_CODE_META_KEY).catch(() => null);
  const activeCrop = await getActiveCrop();
  const top = profile
    ? el("div", { class: "mb-3" }, [
        el("div", { class: "d-flex align-items-center justify-content-between gap-2" }, [
          el("div", {}, [
            el("div", { class: "h5 fw-bold mb-1", text: `Oi, ${profile.first_name}!` }),
            el("div", { class: "rq-help", text: `Comunidade: ${profile.community}` }),
            producerCode ? el("div", { class: "rq-help", text: `Código do produtor: ${String(producerCode).slice(0, 4)}…${String(producerCode).slice(-3)}` }) : (deviceId ? el("div", { class: "rq-help", text: `ID: ${deviceId.slice(0, 8)}…${deviceId.slice(-6)}` }) : el("div"))
          ]),
          el("button", { class: "btn btn-outline-success fw-bold", type: "button", text: "Editar", onclick: () => location.hash = "#/cadastro" })
        ]),
        profile.crops?.length ? el("div", { class: "mt-2" }, [chips(profile.crops.map(c => cropLabel(c)))]) : el("div")
      ])
    : el("div", { class: "mb-3" }, [
        el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
          el("div", { class: "fw-bold", text: "Falta seu cadastro rapidinho." }),
          el("div", { class: "rq-help", text: "Sem isso, você usa offline, mas não envia alerta pra vizinhança." }),
          el("button", { class: "btn btn-warning fw-bold mt-2", type: "button", text: "Fazer cadastro", onclick: () => location.hash = "#/cadastro" })
        ])
      ]);

  const buttons = MODULES.filter(m => m.route !== "#/diario").map(m => bigButton({
    icon: m.icon,
    title: m.title,
    desc: m.desc,
    onClick: () => location.hash = m.route
  }));

  const cropInfo = el("div", { class: "rq-card card" }, [
    el("div", { class: "card-body" }, [
      el("div", { class: "d-flex align-items-center justify-content-between gap-2" }, [
        el("div", {}, [
          el("div", { class: "fw-bold mb-1", text: "Cultura ativa" }),
          el("div", { class: "rq-help", text: activeCrop ? `Você está vendo dicas da cultura: ${cropLabel(activeCrop)}.` : "Escolha uma cultura no mapa para o app focar." })
        ]),
        el("span", { class: "rq-badge", text: activeCrop ? cropLabel(activeCrop) : "não escolhida" })
      ]),
      el("button", {
        class: "btn btn-outline-success btn-lg w-100 fw-bold mt-2",
        type: "button",
        text: "Trocar cultura (no mapa)",
        onclick: () => location.hash = "#/consorcio"
      })
    ])
  ]);

  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const installBlock = !isStandalone()
    ? el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Instalar no celular" }),
          el("div", { class: "rq-help mb-3", text: "Instalado fica mais rápido e funciona melhor offline." }),
          el("button", {
            class: "btn btn-success btn-lg w-100 fw-bold",
            type: "button",
            text: "Instalar agora",
            onclick: async () => {
              if (deferredInstallPrompt) {
                try {
                  deferredInstallPrompt.prompt();
                  await deferredInstallPrompt.userChoice;
                } catch {
                } finally {
                  deferredInstallPrompt = null;
                  toast("Pronto. Se não aparecer, tente pelo menu do navegador.");
                  render();
                }
                return;
              }

              if (isIos()) {
                toast("No Safari: Compartilhar → “Adicionar à Tela de Início”.");
                return;
              }

              toast("No Chrome: menu ⋮ → “Instalar app” (ou “Adicionar à tela inicial”).");
              if (isAndroid) toast("Se não aparecer: confirme se está em HTTPS (no IP local pode não liberar instalar).");
            }
          })
        ])
      ])
    : el("div");

  const syncInfo = el("div", { class: "rq-card card" }, [
    el("div", { class: "card-body" }, [
      el("div", { class: "d-flex align-items-center justify-content-between gap-2" }, [
        el("div", { class: "fw-bold", text: "Sincronização" }),
        (() => {
          const okTs = lastOk ? Date.parse(lastOk) : NaN;
          const errTs = lastErr?.at ? Date.parse(lastErr.at) : NaN;
          const ok = Number.isFinite(okTs)
            && (Number.isFinite(errTs) ? okTs >= errTs : true)
            && Number(pending || 0) <= 0
            && serverOk === true;
          const style = ok
            ? "background: rgba(25,135,84,.14); color:#198754; font-size:18px; line-height:1; padding:.22rem .55rem;"
            : "background: rgba(220,53,69,.14); color:#dc3545; font-size:18px; line-height:1; padding:.22rem .55rem;";
          return el("span", { class: "rq-badge", style, text: "●", "aria-label": ok ? "sincronizado" : "não sincronizado" });
        })()
      ])
    ])
  ]);

  const syncBtn = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Sincronizar agora" });
  syncBtn.addEventListener("click", async () => {
    if (!isOnline()) return toast("Sem internet agora. Tenta depois.");
    if (!profile) {
      toast("Falta seu cadastro (nome e comunidade) pra sincronizar com o banco.");
      location.hash = "#/cadastro";
      return;
    }
    await metaSet("last_sync_try", nowIso()).catch(() => {});
    const okUser = await ensureServerUser();
    if (!okUser) return toast("Não consegui validar seu cadastro no servidor. Tenta salvar o cadastro de novo.");
    const r = await syncNow({ silent: false, all: true });
    if (r.ok) await maybeRegisterBackgroundSync();
    render();
  });

  return el("div", { class: "d-grid gap-3" }, [
    top,
    cropInfo,
    installBlock,
    ...buttons,
    syncInfo,
    el("div", { class: "rq-card card" }, [
      el("div", { class: "card-body" }, [
        el("div", { class: "fw-bold mb-1", text: "Comunidade" }),
        el("div", { class: "rq-help mb-3", text: "Alertas são anônimos e só vão pra gente cadastrada na mesma região (pela comunidade)." }),
        syncBtn,
        el("button", {
          class: "btn btn-outline-success btn-lg w-100 fw-bold mt-2",
          type: "button",
          text: "Compartilhar o app no WhatsApp",
          onclick: async () => {
            const url = location.href.split("#")[0];
            await shareOrCopy({
              title: "SIMBIOSIS LITE",
              text: `Baixa aqui o SIMBIOSIS LITE (funciona offline): ${url}`
            });
          }
        })
      ])
    ])
  ]);
}

async function screenSoil() {
  const cropKey = await getActiveCrop();
  if (!cropKey) {
    return card("Foto Raio‑X do Solo", el("div", { class: "d-grid gap-3" }, [
      el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
        el("div", { class: "fw-bold", text: "Escolha uma cultura no mapa" }),
        el("div", { class: "mt-1", text: "O app só mostra informações da cultura escolhida no mapa." })
      ]),
      el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Ir pro mapa", onclick: () => location.hash = "#/consorcio" })
    ]), { subtitle: "Dica rápida pra melhorar palhada e pH." });
  }
  const ph = el("input", { class: "form-control form-control-lg", placeholder: "Ex.: 5.5", inputmode: "decimal" });
  const tone = el("select", { class: "form-select form-select-lg" }, Array.from({ length: 8 }).map((_, i) =>
    el("option", { value: String(i + 1), text: `Tom ${i + 1} (da carta)` })
  ));
  const photoWrap = el("div");
  const resultWrap = el("div");

  let photoFile = null;
  let photoSaved = null;

  const btnPhoto = el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold", type: "button", text: "Fotografar palhada" });
  btnPhoto.addEventListener("click", async () => {
    const f = await pickPhoto();
    if (!f) return;
    photoFile = f;
    const bmp = await fileToBitmap(f);
    const { canvas, ctx } = canvasFromBitmap(bmp, 960, 960);
    const blob = await canvasToJpegBlob(canvas, 0.72);
    photoWrap.innerHTML = "";
    photoWrap.append(imgPreviewFromBlob(blob));
    photoSaved = { blob, ctx };
  });

  const btn = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Ver recomendação" });
  btn.addEventListener("click", async () => {
    const phV = ph.value.trim().replace(",", ".");
    const t = Number(tone.value);

    let rgb = null;
    if (photoSaved?.ctx) {
      const id = centerImageData(photoSaved.ctx, 0.78);
      const q = photoQuality(id, 7);
      if (!q.ok) toast("A foto parece escura ou sem contraste. Se puder, tire mais perto e com mais luz.");
      rgb = avgRgb(id, 7);
    }
    const analysis = analyzeSoil({ ph: phV, tone: t, rgb });
    const data = { ...analysis, crop: cropKey };
    resultWrap.innerHTML = "";
    resultWrap.append(el("div", { class: "alert alert-success rq-card", role: "alert" }, [
      el("div", { class: "fw-bold", text: "Recomendação" }),
      el("div", { class: "mt-1", text: analysis.message })
    ]));
    resultWrap.append(el("button", {
      class: "btn btn-outline-success btn-lg w-100 fw-bold mt-2",
      type: "button",
      text: "Enviar no WhatsApp",
      onclick: async () => {
        await shareOrCopy({
          title: "Raio‑X do Solo",
          text: `SIMBIOSIS LITE – Raio‑X do Solo\nCultura: ${cropKey ? cropLabel(cropKey) : "—"}\npH: ${analysis.ph ?? "—"}\nPalhada (C/N): ${analysis.residue_cn}\n\n${analysis.message}`
        });
      }
    }));

    const recordId = `soil:${uuidv4()}`;
    await recordPut({ id: recordId, type: "soil_scan", created_at: nowIso(), data });
    await queueRecord({ id: recordId, type: "soil_scan", created_at: nowIso(), data });

    if (photoFile) await savePhotoToIdb(recordId, photoFile);
    await maybeRegisterBackgroundSync();
    syncNow({ silent: true });
    toast("Salvei no Diário.");
  });

  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "rq-help" }, [
      el("div", { text: "1) Bote o pH da fitinha." }),
      el("div", { text: "2) Fotografe a palhada junto da carta de 8 tons (bem pertinho)." })
    ]),
    el("div", { class: "rq-field" }, [el("label", { class: "form-label", text: "pH (da fita reagente)" }), ph]),
    el("div", { class: "rq-field" }, [el("label", { class: "form-label", text: "Tom da palhada (na carta)" }), tone]),
    btnPhoto,
    photoWrap,
    btn,
    resultWrap
  ]);
  return card("Foto Raio‑X do Solo", body, { subtitle: "Dica rápida pra melhorar palhada e pH." });
}

async function screenPests() {
  const cropKey = await getActiveCrop();
  if (!cropKey) {
    return card("Espantalho Digital", el("div", { class: "d-grid gap-3" }, [
      el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
        el("div", { class: "fw-bold", text: "Escolha uma cultura no mapa" }),
        el("div", { class: "mt-1", text: "O app só mostra informações da cultura escolhida no mapa." })
      ]),
      el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Ir pro mapa", onclick: () => location.hash = "#/consorcio" })
    ]), { subtitle: "Conta insetos na armadilha e avisa cedo." });
  }
  const photoWrap = el("div");
  const resultWrap = el("div");
  let photoFile = null;
  let lastAnalysis = null;

  const btnPhoto = el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold", type: "button", text: "Fotografar armadilha amarela" });
  btnPhoto.addEventListener("click", async () => {
    const f = await pickPhoto();
    if (!f) return;
    photoFile = f;
    const bmp = await fileToBitmap(f);
    const { canvas, ctx } = canvasFromBitmap(bmp, 960, 960);
    const blob = await canvasToJpegBlob(canvas, 0.72);
    photoWrap.innerHTML = "";
    photoWrap.append(imgPreviewFromBlob(blob));

    const imgData = centerImageData(ctx, 0.84);
    const q = photoQuality(imgData, 6);
    if (!q.ok) toast("A foto parece escura. Tente com mais luz e mais perto da armadilha.");
    const rgb = avgRgb(imgData, 8);
    const yellowish = ((rgb.r + rgb.g) / 2) > 155 && rgb.b < 150;
    if (!yellowish) toast("Dica: a armadilha precisa estar bem amarela na foto (fundo mais limpo possível).");
    const counted = countDarkSpots(imgData, { downsample: 2, minPixels: 7, maxPixels: 900 });
    const prof = pestProfile(counted);
    const reliable = q.ok && yellowish && counted?.ok === true;

    const history = await recordsListByType("pest_trap", 20);
    const series = history.map(h => ({ count: h.data?.count || 0 })).reverse().concat([{ count: counted.count }]);
    const tr = trendFromSeries(series, 6);

    const kind = reliable && tr.label === "subindo" && counted.count >= 22 ? "alerta" : "aviso";
    const sev = !reliable
      ? 2
      : (tr.label === "subindo" && counted.count >= 22 ? 4 : (counted.count >= 15 ? 3 : 2));
    const guessLine = prof.ok ? `Tipo provável: ${prof.guess}.` : "Tipo provável: não deu pra ler.";
    const sizeLine = prof.ok ? `Tamanho: ${prof.sizes.small} pequenos, ${prof.sizes.medium} médios, ${prof.sizes.large} grandes.` : "";
    const msg = !reliable
      ? `Não consegui ler com confiança essa foto (${counted.count} manchas). Tente outra foto com mais luz, mais perto e com a armadilha bem amarela.`
      : (tr.label === "subindo"
      ? `Atenção: insetos subindo (${counted.count} na armadilha). ${guessLine} Olhe as folhas e faça controle cedo.`
      : `Hoje deu ${counted.count} insetos na armadilha. Tendência: ${tr.label}. ${guessLine}`);

    lastAnalysis = { crop: cropKey, ...counted, reliable, profile: prof, trend: tr, message: msg, kind, severity: sev };
    resultWrap.innerHTML = "";
    resultWrap.append(el("div", { class: `alert ${sev >= 4 ? "alert-danger" : "alert-success"} rq-card`, role: "alert" }, [
      el("div", { class: "fw-bold", text: "Resultado" }),
      el("div", { class: "mt-1", text: msg }),
      sizeLine ? el("div", { class: "rq-help mt-2", text: sizeLine }) : el("div"),
      prof.ok ? el("div", { class: "rq-help mt-1", text: prof.tips[0] }) : el("div"),
      el("div", { class: "rq-help mt-2", text: "Feito no celular (offline). Se tiver internet, envia alerta anônimo pra vizinhança." })
    ]));
    resultWrap.append(el("button", {
      class: "btn btn-outline-success btn-lg w-100 fw-bold mt-2",
      type: "button",
      text: "Enviar no WhatsApp",
      onclick: async () => {
        await shareOrCopy({
          title: "Espantalho Digital",
          text: `SIMBIOSIS LITE – Espantalho Digital\nCultura: ${lastAnalysis.crop ? cropLabel(lastAnalysis.crop) : "—"}\nInsetos: ${lastAnalysis.count}\nTendência: ${lastAnalysis.trend?.label || "—"}\n${lastAnalysis.profile?.ok ? `Tipo: ${lastAnalysis.profile.guess}` : ""}\n\n${lastAnalysis.message}`
        });
      }
    }));

    if (sev >= 4) await notifyLocal("Alerta de pragas", msg);
  });

  const btnSave = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Salvar e (se der) avisar a comunidade" });
  btnSave.addEventListener("click", async () => {
    if (!lastAnalysis) return toast("Tira a foto primeiro.");
    const recordId = `pest:${uuidv4()}`;
    await recordPut({ id: recordId, type: "pest_trap", created_at: nowIso(), data: lastAnalysis });
    await queueRecord({ id: recordId, type: "pest_trap", created_at: nowIso(), data: lastAnalysis });
    if (photoFile) await savePhotoToIdb(recordId, photoFile);

    const send = lastAnalysis.reliable === true && lastAnalysis.severity >= 3;
    if (send) {
      const alertId = uuidv4();
      await recordPut({
        id: `alert_out:${alertId}`,
        type: "alert_outgoing",
        created_at: nowIso(),
        data: { kind: "pragas", severity: lastAnalysis.severity, message: lastAnalysis.message, meta: { crop: lastAnalysis.crop || null, count: lastAnalysis.count, trend: lastAnalysis.trend, guess: lastAnalysis.profile?.guess || null, sizes: lastAnalysis.profile?.sizes || null } }
      });
      await queueAlert({
        id: alertId,
        kind: "pragas",
        severity: lastAnalysis.severity,
        message: lastAnalysis.message,
        created_at: nowIso(),
        meta: { crop: lastAnalysis.crop || null, count: lastAnalysis.count, trend: lastAnalysis.trend, guess: lastAnalysis.profile?.guess || null, sizes: lastAnalysis.profile?.sizes || null }
      });
    }

    await maybeRegisterBackgroundSync();
    ensureServerUser().then(() => syncNow({ silent: true }));
    toast("Salvei no Diário.");
  });

  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "rq-help" }, [
      el("div", { text: "Armadilha simples: saco plástico amarelo + óleo usado. Fotografe bem de frente." }),
      el("div", { text: "O app conta os pontos escuros e vê se está aumentando." })
    ]),
    btnPhoto,
    photoWrap,
    btnSave,
    resultWrap
  ]);
  return card("Espantalho Digital", body, { subtitle: "Conta insetos na armadilha e avisa cedo." });
}

function cropColor(c) {
  if (c === "milho") return "#f7c948";
  if (c === "feijao") return "#3a8350";
  if (c === "mandioca") return "#9c6b3f";
  if (c === "melancia") return "#d94848";
  return "#5a6b62";
}

function makeConsortiumPlan({ stepsW, stepsH, pattern }) {
  const w = Math.max(1, Math.min(20, stepsW));
  const h = Math.max(1, Math.min(30, stepsH));
  const cells = [];
  const order = pattern === "milho_feijao_mandioca_melancia"
    ? ["milho", "feijao", "feijao", "milho", "mandioca", "melancia"]
    : ["milho", "feijao", "mandioca", "melancia"];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (x + y) % order.length;
      cells.push({ x, y, crop: order[idx] });
    }
  }
  const instruction = [
    "Faça as linhas no sentido mais fácil do terreno.",
    "Exemplo simples: 1 passo de milho, 2 de feijão, mandioca no passo 5.",
    "Mantenha palhada e observe sombra/vento: onde seca mais, bote feijão e cobertura."
  ];
  return { w, h, cells, instruction };
}

const CONSORTIUM_SPACING_M = {
  milho: { row: 0.9, plant: 0.25 },
  feijao: { row: 0.5, plant: 0.15 },
  mandioca: { row: 1.0, plant: 1.0 },
  melancia: { row: 2.5, plant: 1.8 }
};

async function screenConsortium() {
  const active = await getActiveCrop();
  const profile = await userGet().catch(() => null);
  const defaultSet = new Set(Array.isArray(profile?.crops) ? profile.crops : []);
  if (active && CROPS.includes(active)) defaultSet.add(active);

  const cropChecks = CROPS.map(c => {
    const id = `cons_crop_${c}`;
    const input = el("input", { class: "form-check-input", type: "checkbox", id });
    if (defaultSet.has(c)) input.checked = true;
    const label = el("label", { class: "form-check-label fw-bold", for: id, text: cropLabel(c) });
    return el("div", { class: "form-check" }, [input, label]);
  });
  const cropsWrap = el("div", { class: "rq-card", style: "background:#fff; padding:12px; border-radius:18px;" }, cropChecks);

  const textWrap = el("div");

  const btn = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Mostrar distâncias" });
  btn.addEventListener("click", async () => {
    const selected = [];
    for (let i = 0; i < CROPS.length; i++) {
      const input = cropChecks[i].querySelector("input");
      if (input && input.checked) selected.push(CROPS[i]);
    }
    if (!selected.length && active && CROPS.includes(active)) selected.push(active);
    if (!selected.length) selected.push("mandioca");

    const spacing = {};
    for (const c of selected) {
      const s = CONSORTIUM_SPACING_M[c] || null;
      if (!s) continue;
      spacing[c] = { row_m: s.row, plant_m: s.plant };
    }

    textWrap.innerHTML = "";
    textWrap.append(el("div", { class: "alert alert-success rq-card", role: "alert" }, [
      el("div", { class: "fw-bold", text: "Distâncias recomendadas" }),
      el("div", { class: "rq-help mt-2", text: "Entre linhas / entre plantas." }),
      el("div", { class: "mt-2 d-grid gap-1" }, selected.map(c => {
        const s = spacing[c] || null;
        const row = s?.row_m ? `${s.row_m} m` : "—";
        const plant = s?.plant_m ? `${s.plant_m} m` : "—";
        return el("div", { text: `${cropLabel(c)}: linhas ${row} • plantas ${plant}` });
      }))
    ]));

    const recordId = `plan:${uuidv4()}`;
    const data = { focus_crop: active || null, crops: selected, spacing, unit: "m" };
    await recordPut({ id: recordId, type: "consortium_plan", created_at: nowIso(), data });
    await queueRecord({ id: recordId, type: "consortium_plan", created_at: nowIso(), data });
    await maybeRegisterBackgroundSync();
    ensureServerUser().then(() => syncNow({ silent: true }));
    toast("Plano salvo no Diário.");
  });

  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "rq-field" }, [el("label", { class: "form-label", text: "Escolha as culturas que vai juntar" }), cropsWrap]),
    btn,
    textWrap
  ]);
  return card("Planejador de Consórcio", body, { subtitle: "Escolha as culturas e veja a distância de plantio." });
}

async function screenPlant() {
  const cropKey = await getActiveCrop();
  if (!cropKey) {
    return card("Planta Falante", el("div", { class: "d-grid gap-3" }, [
      el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
        el("div", { class: "fw-bold", text: "Escolha uma cultura no mapa" }),
        el("div", { class: "mt-1", text: "O app só mostra informações da cultura escolhida no mapa." })
      ]),
      el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Ir pro mapa", onclick: () => location.hash = "#/consorcio" })
    ]), { subtitle: "IA no celular: água, nutrição e problemas na folha." });
  }

  const photoWrap = el("div");
  const resultWrap = el("div");
  const profile = await userGet().catch(() => null);
  const cropSet = new Set();
  if (Array.isArray(profile?.crops)) {
    for (const c of profile.crops) cropSet.add(c);
  }
  cropSet.add(cropKey);
  const cropChoices = Array.from(cropSet).filter(c => CROPS.includes(c));

  let selectedCrop = CROPS.includes(cropKey) ? cropKey : (cropChoices[0] || cropKey);
  let photoInput = null;
  let last = null;
  let nutri = null;
  let ai = null;
  let lastRecordId = null;

  function resetPlantUi() {
    photoInput = null;
    last = null;
    nutri = null;
    ai = null;
    lastRecordId = null;
    photoWrap.innerHTML = "";
    resultWrap.innerHTML = "";
    btnSave.textContent = "Salvar no Diário";
  }

  async function analyzePlantFromInput(input) {
    const cropKeyNow = selectedCrop;
    let bmp = null;
    try {
      bmp = await fileToBitmap(input);
    } catch (e) {
      captureJsError("file_bitmap", e);
      toast("Não consegui abrir a foto. Tente tirar de novo.");
      return;
    }
    const { canvas, ctx } = canvasFromBitmap(bmp, 960, 960);
    let blob = null;
    try {
      blob = await canvasToJpegBlob(canvas, 0.72);
    } catch {
      blob = null;
    }
    photoWrap.innerHTML = "";
    if (blob) photoWrap.append(imgPreviewFromBlob(blob));

    let best = null;
    const crops = [0.78, 0.92];
    for (const cfrac of crops) {
      const imgData = centerImageData(ctx, cfrac);
      const q = photoQuality(imgData, 6);
      try {
        const water = plantStressFromImage(imgData, { step: 2, crop: cropKeyNow });
        const nutrition = plantNutritionFromImage(imgData, { step: 3, crop: cropKeyNow });
        const aiLocal = plantAiFromImage(imgData, { step: 3, crop: cropKeyNow });
        const photoS = aiScore(aiLocal, "foto_ruim");
        const leafF = typeof aiLocal?.debug?.leaf_frac === "number" ? aiLocal.debug.leaf_frac : 0;
        const nutrS = typeof nutrition?.best?.score === "number" ? nutrition.best.score : 0;
        const score = (1 - Math.max(0, Math.min(1, photoS))) + 1.35 * leafF + 0.60 * nutrS + (q.ok ? 0.08 : 0);
        if (!best || score > best.score) best = { imgData, q, water, nutrition, aiLocal, score };
      } catch (e) {
        captureJsError("plant_analyze", e);
      }
    }

    if (!best) {
      toast("Deu erro na análise. Tente outra foto com mais luz e mais perto.");
      return;
    }

    if (!best.q.ok) toast("A foto parece escura. Se puder, tire mais perto e com mais luz.");
    last = best.water;
    nutri = best.nutrition;
    ai = best.aiLocal;

    const historyStats = await computePlantHistoryStats(cropKeyNow).catch(() => null);
    resultWrap.innerHTML = "";
    const header = el("div", { class: "fw-bold" });
    const body = el("div", { class: "mt-1" });
    const help = el("div", { class: "rq-help mt-2" });
    const note = el("div", { class: "rq-help mt-2" });
    const decisionAlert = el("div", { class: "alert rq-card", role: "alert" }, [header, body, help, note]);
    const shareBtn = el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold mt-2", type: "button", text: "Enviar no WhatsApp" });
    resultWrap.append(decisionAlert, shareBtn);

    let onlineSuggestion = null;
    let refSuggestion = null;
    let decision = decidePlantMostProbable({ crop: cropKeyNow, water: last, nutrition: nutri, ai, online: null, ref: null, history: historyStats });
    applyDecisionToUi({ alert: decisionAlert, header, body, help, note, decision, cropKey: cropKeyNow });
    shareBtn.onclick = async () => {
      await shareOrCopy({
        title: "Planta Falante",
        text: `SIMBIOSIS LITE – Planta Falante\nCultura: ${cropLabel(cropKeyNow)}\n\n${decision.share}`
      });
    };

    if (last?.ok === true && last.label === "estressada") await notifyLocal("Sinal de sede", last.message);
    if (ai?.best?.key === "doenca" && ai.best.score >= 0.75) await notifyLocal("Possível mancha/doença", ai.message);
    if (ai?.best?.key === "pragas" && ai.best.score >= 0.75) await notifyLocal("Possível praga na folha", ai.message);

    lastRecordId = await savePlantCheckAuto({ cropKey: cropKeyNow, water: last, nutrition: nutri, ai, decision, photoInput: input });
    btnSave.textContent = "Abrir Diário";

    if (isOnline()) {
      note.textContent = "Online: comparando com imagens de referência da internet e casos parecidos da comunidade (sem enviar sua foto).";

      const features = buildPlantFeatures({ crop: cropKeyNow, water: last, nutrition: nutri, ai });

      try {
        await ensureServerUser();
        const [cmp, ref] = await Promise.all([
          apiFetch("/plant/compare", { method: "POST", body: { crop: cropKeyNow, features, limit: 18 } }).catch(() => null),
          internetRefSuggest(cropKeyNow, features).catch(() => null),
        ]);
        onlineSuggestion = computeOnlineSuggestion(cmp?.compare);
        refSuggestion = ref;
        decision = decidePlantMostProbable({ crop: cropKeyNow, water: last, nutrition: nutri, ai, online: onlineSuggestion, ref: refSuggestion, history: historyStats });
        applyDecisionToUi({ alert: decisionAlert, header, body, help, note, decision, cropKey: cropKeyNow });
        if (lastRecordId) {
          await savePlantCheckUpdate(lastRecordId, { cropKey: cropKeyNow, water: last, nutrition: nutri, ai, decision });
        }
      } catch (e) {
        captureJsError("plant_online", e);
        note.textContent = "Online: não consegui comparar agora. Segui só com o diagnóstico do celular.";
      }
    }
  }

  const cropSelect = el("select", { class: "form-select form-select-lg fw-bold" }, cropChoices.map(c => el("option", { value: c, text: cropLabel(c) })));
  cropSelect.value = selectedCrop;
  cropSelect.addEventListener("change", () => {
    const v = cropSelect.value;
    selectedCrop = CROPS.includes(v) ? v : selectedCrop;
    resetPlantUi();
  });

  const btnPhoto = el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold", type: "button", text: "Fotografar folhas" });
  btnPhoto.addEventListener("click", async () => {
    const f = await pickPhoto();
    if (!f) return;
    photoInput = f;
    await analyzePlantFromInput(f);
  });

  const btnSave = el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Salvar no Diário" });
  btnSave.addEventListener("click", async () => {
    if (!last) return toast("Tira a foto primeiro.");
    location.hash = "#/diario";
  });

  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "rq-help" }, [
      el("div", { text: "Tire foto todo dia, mais ou menos no mesmo horário." }),
      el("div", { text: "Quanto mais parecido o jeito da foto, melhor a comparação." })
    ]),
    el("div", { class: "rq-field" }, [el("label", { class: "form-label", text: "Cultura para análise" }), cropSelect]),
    btnPhoto,
    photoWrap,
    btnSave,
    resultWrap
  ]);
  return card("Planta Falante", body, { subtitle: "Vê sinal de sede pela folha." });
}

async function savePlantCheckAuto({ cropKey, water, nutrition, ai, decision, photoInput }) {
  const recordId = `plant:${uuidv4()}`;
  const data = { crop: cropKey, water, nutrition, ai, decision };
  await recordPut({ id: recordId, type: "plant_check", created_at: nowIso(), data });
  await queueRecord({ id: recordId, type: "plant_check", created_at: nowIso(), data });
  if (photoInput) {
    try { await savePhotoToIdb(recordId, photoInput); } catch { toast("Não consegui salvar a foto, mas salvei o registro."); }
  }

  await queueAlertsFromPlantCheck({ cropKey, water, ai });
  await maybeRegisterBackgroundSync();
  ensureServerUser().then(() => syncNow({ silent: true }));
  toast("Já salvei no Diário.");
  return recordId;
}

async function savePlantCheckUpdate(recordId, { cropKey, water, nutrition, ai, decision }) {
  const data = { crop: cropKey, water, nutrition, ai, decision };
  await recordPut({ id: recordId, type: "plant_check", created_at: nowIso(), data });
  await queueRecord({ id: recordId, type: "plant_check", created_at: nowIso(), data });
}

async function queueAlertsFromPlantCheck({ cropKey, water, ai }) {
  if (water?.ok === true && water?.label === "estressada" && typeof water?.stress === "number" && water.stress >= 0.7) {
    const alertId = uuidv4();
    const msg = `Sinal de sede em ${cropLabel(cropKey)}. Se puder, irrigue hoje.`;
    await queueAlert({ id: alertId, kind: "seca", severity: 3, message: msg, created_at: nowIso(), meta: { crop: cropKey, stress: water.stress } });
    await recordPut({ id: `alert_out:${alertId}`, type: "alert_outgoing", created_at: nowIso(), data: { kind: "seca", severity: 3, message: msg } });
  }
  if (ai?.best?.key === "doenca" && typeof ai?.best?.score === "number" && ai.best.score >= 0.8) {
    const alertId = uuidv4();
    const dname = ai?.disease?.name ? ` (${ai.disease.name})` : "";
    const msg = `Possível doença em ${cropLabel(cropKey)}${dname}. ${ai?.disease?.solution || "Olhe se está espalhando e retire folhas muito atacadas."}`;
    await queueAlert({ id: alertId, kind: "doenca", severity: 3, message: msg, created_at: nowIso(), meta: { crop: cropKey, ai: ai.best, disease: ai?.disease || null } });
    await recordPut({ id: `alert_out:${alertId}`, type: "alert_outgoing", created_at: nowIso(), data: { kind: "doenca", severity: 3, message: msg } });
  }
  if (ai?.best?.key === "pragas" && typeof ai?.best?.score === "number" && ai.best.score >= 0.8) {
    const alertId = uuidv4();
    const msg = `Possível praga sugadora em ${cropLabel(cropKey)}. Olhe embaixo das folhas e brotações.`;
    await queueAlert({ id: alertId, kind: "pragas_folha", severity: 3, message: msg, created_at: nowIso(), meta: { crop: cropKey, ai: ai.best } });
    await recordPut({ id: `alert_out:${alertId}`, type: "alert_outgoing", created_at: nowIso(), data: { kind: "pragas_folha", severity: 3, message: msg } });
  }
}

function buildPlantFeatures({ crop, water, nutrition, ai }) {
  const f = {};
  if (ai?.debug) {
    for (const [k, v] of Object.entries(ai.debug)) {
      if (typeof v === "number" && Number.isFinite(v)) f[k] = v;
    }
  }
  const issues = Array.isArray(ai?.issues) ? ai.issues : [];
  const issueScore = (key) => {
    const it = issues.find(x => x?.key === key);
    const s = it?.score;
    return typeof s === "number" && Number.isFinite(s) ? s : 0;
  };
  f.ai_doenca = issueScore("doenca");
  f.ai_pragas = issueScore("pragas");
  f.ai_sol_forte = issueScore("sol_forte");
  f.ai_foto_ruim = issueScore("foto_ruim");
  f.ai_clorose = issueScore("clorose");
  if (water?.stress !== undefined) f.water_stress = Number(water.stress) || 0;
  if (nutrition?.best?.score !== undefined) f.nutrient_score = Number(nutrition.best.score) || 0;
  if (ai?.best?.score !== undefined) f.ai_score = Number(ai.best.score) || 0;
  if (crop) f.crop_code = ({ mandioca: 1, milho: 2, feijao: 3, melancia: 4 }[crop] || 0);
  return f;
}

const REF_CACHE_PREFIX = "ref_cache_v3:";
const REF_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function internetRefListForCrop(cropKey) {
  const any = [
    {
      id: "chlorosis_generic",
      url: "https://upload.wikimedia.org/wikipedia/commons/1/10/2015-12-28_00_15_17_Chlorosis_on_an_Araucaria.jpg",
      category: "nutricao",
      nutrient: "Clorose (falta de Fe/Mg/N) (possível)"
    },
    {
      id: "nitrogen_def_generic",
      url: "https://upload.wikimedia.org/wikipedia/commons/c/cf/Spitskool_stikstofgebrek_%28nitrogen_deficiency%29_Brassica_oleracea_convar._capitata_var._alba.jpg",
      category: "nutricao",
      nutrient: "Falta de nitrogênio (N) (possível)"
    },
    {
      id: "aphids_macro",
      url: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Aphids_feeding_on_fennel.jpg",
      category: "pragas",
      pest: "Pulgões (possível)"
    },
    {
      id: "leaf_spot_generic",
      url: "https://upload.wikimedia.org/wikipedia/commons/b/b4/Cordana_leaf_spot_by_Cordana_musae.jpg",
      category: "doenca",
      disease: "Mancha foliar (possível)"
    }
  ];

  if (cropKey === "melancia") {
    return [
      ...any,
      {
        id: "powdery_mildew_melon",
        url: "https://upload.wikimedia.org/wikipedia/commons/0/07/Powdery_mildew.JPG",
        category: "doenca",
        disease: "Oídio / míldio (possível)"
      },
      {
        id: "watermelon_anthracnose",
        url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Colletotrichum_orbiculare_on_watermelon_leaf.JPG",
        category: "doenca",
        disease: "Antracnose (possível)"
      }
    ];
  }

  if (cropKey === "milho") {
    return [
      ...any,
      {
        id: "maize_mo_def",
        url: "https://upload.wikimedia.org/wikipedia/commons/4/40/Mo_deficienct_maize_subsistence_farmer_2017_05_09_6639.jpg",
        category: "nutricao",
        nutrient: "Falta de micronutriente (possível)"
      },
      {
        id: "maize_rust_leaf",
        url: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Common_rust_on_maize.jpg",
        category: "doenca",
        disease: "Ferrugem (possível)"
      }
    ];
  }

  if (cropKey === "feijao") {
    return [
      ...any,
      {
        id: "bean_n_def",
        url: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Phaseolus_vulgaris_nitrogen_deficiency.jpg",
        category: "nutricao",
        nutrient: "Falta de nitrogênio (N) (possível)"
      },
      {
        id: "bean_rust",
        url: "https://upload.wikimedia.org/wikipedia/commons/8/86/Uromyces_appendiculatus_rust_on_bean_leaf.jpg",
        category: "doenca",
        disease: "Ferrugem do feijoeiro (possível)"
      }
    ];
  }

  if (cropKey === "mandioca") {
    return [
      ...any,
      {
        id: "cassava_cbds",
        url: "https://upload.wikimedia.org/wikipedia/commons/0/04/Distribution_of_cassava_brown_streak_disease_%28CBSD%29_symptoms_on_cassava.JPG",
        category: "doenca",
        disease: "Virose / manchas (possível)"
      },
      {
        id: "cassava_witches_broom",
        url: "https://upload.wikimedia.org/wikipedia/commons/e/ed/Symptoms_of_cassava_witches%E2%80%99_broom_disease_%28French_Guiana%29.jpg",
        category: "doenca",
        disease: "Vassoura-de-bruxa (possível)"
      },
      {
        id: "cassava_mosaic",
        url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/Forestryimages_cassava.jpg",
        category: "doenca",
        disease: "Mosaico (vírus) (possível)"
      }
    ];
  }

  return any;
}

async function internetRefSuggest(cropKey, features) {
  if (!isOnline()) return null;
  const cacheKey = `${REF_CACHE_PREFIX}${cropKey}`;
  const cached = await metaGet(cacheKey);
  const now = Date.now();
  if (cached?.created_at && (now - cached.created_at) < REF_CACHE_TTL_MS && Array.isArray(cached.items) && cached.items.length) {
    return computeInternetRefSuggestion(features, cached.items);
  }

  const refs = internetRefListForCrop(cropKey);
  const built = [];
  for (const r of refs) {
    const item = await buildRefItem(cropKey, r).catch(() => null);
    if (item) built.push(item);
  }
  if (built.length) await metaSet(cacheKey, { created_at: now, items: built });
  return built.length ? computeInternetRefSuggestion(features, built) : null;
}

async function buildRefItem(cropKey, ref) {
  const imgData = await imageDataFromUrl(ref.url);
  const water = plantStressFromImage(imgData, { step: 3, crop: cropKey });
  const nutrition = plantNutritionFromImage(imgData, { step: 4, crop: cropKey });
  const ai = plantAiFromImage(imgData, { step: 4, crop: cropKey });
  const features = buildPlantFeatures({ crop: cropKey, water, nutrition, ai });
  return {
    id: ref.id,
    url: ref.url,
    category: ref.category,
    disease: ref.disease || null,
    nutrient: ref.nutrient || null,
    pest: ref.pest || null,
    features
  };
}

async function imageDataFromUrl(url) {
  const res = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!res.ok) throw new Error("fetch_failed");
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const side = 320;
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, side, side);
  return ctx.getImageData(0, 0, side, side);
}

function featureDistance(a, b, keys = null) {
  if (!keys) keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    if (a?.[k] === undefined || b?.[k] === undefined) continue;
    const x = Number(a[k]);
    const y = Number(b[k]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = x - y;
    sum += d * d;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 999999;
}

function computeInternetRefSuggestion(features, items) {
  if (!Array.isArray(items) || !items.length) return null;
  const FEAT = {
    doenca: ["ai_doenca", "lesion_frac", "frac_necrosis", "std_gi", "frac_dark_leaf", "frac_dark", "mean_red_dom", "edge_aniso", "leaf_frac", "mean_lum"],
    nutricao: ["nutrient_score", "ai_clorose", "mean_gi", "mean_yellow", "std_gi", "burn_rate", "edge_drop", "leaf_frac", "mean_lum"],
    pragas: ["ai_pragas", "frac_dark_leaf", "frac_dark", "std_gi", "leaf_frac", "mean_lum"],
  };
  const keySetFor = (cat) => {
    const arr = FEAT[cat] || [];
    return new Set(arr);
  };
  const bestPerCat = [];
  for (const cat of ["doenca", "nutricao", "pragas"]) {
    const cand = items.filter(it => it?.category === cat);
    if (!cand.length) continue;
    const ks = keySetFor(cat);
    const ranked = cand.map(it => {
      const d = featureDistance(features, it.features, ks);
      return { ...it, distance: d };
    }).sort((a, b) => a.distance - b.distance);
    bestPerCat.push(...ranked.slice(0, 2));
  }
  const scored = bestPerCat.length
    ? bestPerCat.sort((a, b) => a.distance - b.distance)
    : items.map(it => ({ ...it, distance: featureDistance(features, it.features) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6);

  const ds = scored.map(m => (typeof m.distance === "number" && Number.isFinite(m.distance)) ? m.distance : 999999).sort((a, b) => a - b);
  const median = ds.length ? ds[Math.floor(ds.length / 2)] : 999999;
  const scale = Math.max(0.06, 1.35 * median);
  const eps = 1e-9;
  const vote = new Map();
  const diseaseVote = new Map();
  const nutrVote = new Map();
  const pestVote = new Map();
  let sumW = 0;
  for (const m of scored) {
    const d = (typeof m.distance === "number" && Number.isFinite(m.distance)) ? m.distance : 999999;
    const w = Math.exp(-(d * d) / (2 * scale * scale + eps));
    sumW += w;
    vote.set(m.category, (vote.get(m.category) || 0) + w);
    if (m.category === "doenca" && m.disease) diseaseVote.set(m.disease, (diseaseVote.get(m.disease) || 0) + w);
    if (m.category === "nutricao" && m.nutrient) nutrVote.set(m.nutrient, (nutrVote.get(m.nutrient) || 0) + w);
    if (m.category === "pragas" && m.pest) pestVote.set(m.pest, (pestVote.get(m.pest) || 0) + w);
  }

  const pickMax = (map) => {
    let bestK = null;
    let bestS = 0;
    for (const [k, s] of map.entries()) {
      if (s > bestS) { bestS = s; bestK = k; }
    }
    return bestK;
  };

  const cat = pickMax(vote);
  if (!cat) return null;
  const catW = vote.get(cat) || 0;
  const voteArr = Array.from(vote.values()).sort((a, b) => b - a);
  const secondW = voteArr[1] || 0;
  const confRaw = sumW ? Math.max(0, Math.min(1, catW / sumW)) : 0;
  const margin = sumW ? Math.max(0, Math.min(1, (catW - secondW) / sumW)) : 0;
  const quality = ds.length ? Math.exp(-ds[0] / (scale + eps)) : 0;
  const conf = Math.max(0, Math.min(1, 0.55 * confRaw + 0.30 * margin + 0.15 * quality));
  if (conf < 0.46) return null;

  return {
    category: cat,
    confidence: conf,
    disease: cat === "doenca" ? pickMax(diseaseVote) : null,
    nutrient: cat === "nutricao" ? pickMax(nutrVote) : null,
    pest: cat === "pragas" ? pickMax(pestVote) : null,
    matches: scored.map(m => ({ id: m.id, url: m.url, category: m.category, distance: m.distance }))
  };
}

function computeOnlineSuggestion(compare) {
  const matches = Array.isArray(compare?.matches) ? compare.matches : [];
  if (!matches.length) return null;
  const sorted = matches
    .map(m => ({ ...m, distance: (typeof m?.distance === "number" && Number.isFinite(m.distance)) ? m.distance : 999999 }))
    .sort((a, b) => a.distance - b.distance);
  const take = sorted.slice(0, Math.min(8, sorted.length));
  const ds = take.map(m => m.distance).sort((a, b) => a - b);
  const median = ds.length ? ds[Math.floor(ds.length / 2)] : 999999;
  const scale = Math.max(0.05, 1.35 * median);
  const eps = 1e-9;
  const vote = new Map();
  const diseaseVote = new Map();
  const nutrVote = new Map();
  let sumW = 0;
  let minDist = 999999;

  for (const m of take) {
    const d = m.distance;
    const w = Math.exp(-(d * d) / (2 * scale * scale + eps));
    sumW += w;
    if (d < minDist) minDist = d;
    const bestKey = m?.prediction?.best?.key || null;
    const nutr = m?.prediction?.nutrient || null;
    const dis = m?.prediction?.disease?.name || null;

    const cat = bestKey === "doenca" ? "doenca"
      : bestKey === "pragas" ? "pragas"
      : bestKey === "agua" ? "agua"
      : bestKey === "nutricao" ? "nutricao"
      : null;
    if (cat) vote.set(cat, (vote.get(cat) || 0) + w);
    if (cat === "doenca" && dis) diseaseVote.set(dis, (diseaseVote.get(dis) || 0) + w);
    if (cat === "nutricao" && nutr) nutrVote.set(nutr, (nutrVote.get(nutr) || 0) + w);
  }

  let bestCat = null;
  let bestScore = 0;
  for (const [k, s] of vote.entries()) {
    if (s > bestScore) {
      bestScore = s;
      bestCat = k;
    }
  }
  if (!bestCat) return null;

  const voteArr = Array.from(vote.values()).sort((a, b) => b - a);
  const secondScore = voteArr[1] || 0;
  const pickMaxKey = (m) => {
    let k = null;
    let s = 0;
    for (const [kk, ss] of m.entries()) {
      if (ss > s) { s = ss; k = kk; }
    }
    return k;
  };

  const confRaw = sumW ? Math.max(0, Math.min(1, bestScore / sumW)) : 0;
  const margin = sumW ? Math.max(0, Math.min(1, (bestScore - secondScore) / sumW)) : 0;
  const quality = ds.length ? Math.exp(-ds[0] / (scale + eps)) : 0;
  const conf = Math.max(0, Math.min(1, 0.55 * confRaw + 0.30 * margin + 0.15 * quality));
  if (take.length < 3 || conf < 0.46) return null;

  return {
    category: bestCat,
    score: bestScore,
    confidence: conf,
    count: take.length,
    closest_distance: Number.isFinite(minDist) ? minDist : null,
    disease: bestCat === "doenca" ? pickMaxKey(diseaseVote) : null,
    nutrient: bestCat === "nutricao" ? pickMaxKey(nutrVote) : null
  };
}

function aiScore(ai, key) {
  const xs = Array.isArray(ai?.issues) ? ai.issues : [];
  const it = xs.find(x => x.key === key);
  const s = it?.score;
  return typeof s === "number" && Number.isFinite(s) ? s : 0;
}

async function computePlantHistoryStats(cropKey) {
  const rows = await recordsListByType("plant_check", 40);
  const same = rows.filter(r => r?.data?.crop === cropKey);
  if (same.length < 3) return null;

  const take = same.slice(0, 12);
  let n = 0;
  let sumW = 0;
  let sumN = 0;
  let sumD = 0;
  let sumP = 0;
  for (const r of take) {
    const w = r?.data?.water?.stress;
    const ns = r?.data?.nutrition?.best?.score;
    const d = aiScore(r?.data?.ai, "doenca");
    const p = aiScore(r?.data?.ai, "pragas");
    if (typeof w === "number") sumW += w;
    if (typeof ns === "number") sumN += ns;
    sumD += d;
    sumP += p;
    n++;
  }
  return {
    avg_water: sumW / n,
    avg_nutr: sumN / n,
    avg_doenca: sumD / n,
    avg_pragas: sumP / n
  };
}

function decidePlantMostProbable({ crop, water, nutrition, ai, online, ref, history }) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const waterOk = water?.ok === true;
  const sWaterRaw = typeof water?.stress === "number" ? water.stress : 0;
  const sWater = clamp01(sWaterRaw) * (waterOk ? 1 : 0.7);
  const sNutr = typeof nutrition?.best?.score === "number" ? nutrition.best.score : 0;
  const dbg = ai?.debug || {};
  const leafFrac = (typeof dbg?.leaf_frac === "number" && Number.isFinite(dbg.leaf_frac)) ? dbg.leaf_frac : 0;
  const lesionFrac = (typeof dbg?.lesion_frac === "number" && Number.isFinite(dbg.lesion_frac)) ? dbg.lesion_frac : 0;
  const necFrac = (typeof dbg?.frac_necrosis === "number" && Number.isFinite(dbg.frac_necrosis)) ? dbg.frac_necrosis : 0;
  const meanLum = (typeof dbg?.mean_lum === "number" && Number.isFinite(dbg.mean_lum)) ? dbg.mean_lum : 0;
  const meanGI = (typeof dbg?.mean_gi === "number" && Number.isFinite(dbg.mean_gi)) ? dbg.mean_gi : 0;
  const meanYellow = (typeof dbg?.mean_yellow === "number" && Number.isFinite(dbg.mean_yellow)) ? dbg.mean_yellow : 0;
  const stdGI = (typeof dbg?.std_gi === "number" && Number.isFinite(dbg.std_gi)) ? dbg.std_gi : 0;

  let sDisease = aiScore(ai, "doenca");
  if (leafFrac >= 0.28) {
    if (lesionFrac > 0.03) sDisease = Math.max(sDisease, 0.48 + 0.22 * clamp01((lesionFrac - 0.03) / 0.06));
    if (necFrac > 0.02) sDisease = Math.max(sDisease, 0.56);
  }
  const sPests = aiScore(ai, "pragas");
  const sSun = aiScore(ai, "sol_forte");
  const sPhoto = aiScore(ai, "foto_ruim");

  const hasLeafRead = leafFrac >= 0.28 && sPhoto < 0.50 && meanLum >= 55 && meanLum <= 205;
  const canDecide = hasLeafRead || (sPhoto < 0.55 && leafFrac >= 0.24);
  if (!canDecide) {
    const msg = ai?.issues?.find(x => x?.key === "foto_ruim")?.message || "Não consegui ler bem a folha nessa foto. Tente mais perto e com mais luz.";
    return {
      key: "foto_ruim",
      tone: "warning",
      title: "Mais provável: foto sem leitura",
      text: msg,
      help: "Encha a tela com uma folha só (bem perto), com luz de dia, sem sombra forte.",
      share: `Mais provável: foto sem leitura.\nConfiança: baixa.\n${msg}`.trim()
    };
  }
  const nutrHint = hasLeafRead
    ? clamp01((0.032 - meanGI) / 0.075) * clamp01((meanYellow + 0.02) / 0.24) * clamp01((0.030 - necFrac) / 0.030)
    : 0;
  const diseaseHint = hasLeafRead
    ? clamp01((lesionFrac - 0.028) / 0.070) * clamp01((stdGI - 0.020) / 0.080) + clamp01((necFrac - 0.015) / 0.050)
    : 0;
  const biasNutr = 0.16 * clamp01(nutrHint) - 0.10 * clamp01(diseaseHint);
  const biasDisease = 0.16 * clamp01(diseaseHint) - 0.10 * clamp01(nutrHint);

  const nutrKey = typeof nutrition?.best?.key === "string" ? nutrition.best.key : "";
  let sNutrAdj = clamp01(sNutr + biasNutr);
  const diseaseStrong = hasLeafRead && (lesionFrac >= 0.042 || necFrac >= 0.022 || sDisease >= 0.70);
  if (diseaseStrong) sNutrAdj = clamp01(sNutrAdj - 0.22);
  if (hasLeafRead && sWater >= 0.58) sNutrAdj = clamp01(sNutrAdj - 0.10);
  const micro = nutrKey === "zinco" || nutrKey === "ferro_manganes" || nutrKey === "ferro";
  if (micro && sNutrAdj < 0.80) sNutrAdj = clamp01(sNutrAdj * 0.65);

  const uniformGI = clamp01((0.050 - stdGI) / 0.070);
  const yellowish = clamp01((meanYellow - 0.055) / 0.19);
  const pale = clamp01((0.024 - meanGI) / 0.075);
  const notThirsty = clamp01((0.40 - sWater) / 0.40);
  const canOverwater = hasLeafRead && meanLum >= 65 && sPhoto < 0.45;
  const sOverWater = canOverwater ? clamp01((0.55 * yellowish + 0.35 * pale + 0.20 * uniformGI) * (0.45 + 0.55 * notThirsty)) : 0;

  if (hasLeafRead && sDisease < 0.62 && necFrac < 0.02 && lesionFrac < 0.04) {
    sDisease = Math.max(0, sDisease - 0.12);
  }

  const histBoost = (cat) => {
    if (!history) return 0;
    if (cat === "agua") return sWater > (history.avg_water + 0.12) ? 0.07 : 0;
    if (cat === "nutricao") return sNutr > (history.avg_nutr + 0.10) ? 0.06 : 0;
    if (cat === "doenca") return sDisease > (history.avg_doenca + 0.10) ? 0.06 : 0;
    if (cat === "pragas") return sPests > (history.avg_pragas + 0.10) ? 0.06 : 0;
    return 0;
  };

  let onlineConf = 0;
  if (typeof online?.confidence === "number") onlineConf = clamp01(online.confidence);
  else if (typeof online?.score === "number" && Number.isFinite(online.score)) onlineConf = clamp01(online.score / 4.5);

  const onlineNutr = (typeof online?.nutrient === "string" ? online.nutrient : "").toLowerCase();
  const onlineMicro = onlineNutr.includes("zinco") || onlineNutr.includes("ferro") || onlineNutr.includes("mangan");

  const onlineBoost = (cat) => {
    if (online?.category !== cat) return 0;
    let b = 0.10 + 0.24 * onlineConf;
    if (typeof online?.count === "number" && online.count < 5) b *= 0.75;
    if (cat === "nutricao") {
      if (diseaseStrong || sWater >= 0.65) b *= 0.40;
      if (onlineMicro && onlineConf < 0.78) b *= 0.25;
    }
    return clamp01(b);
  };

  const refConf = typeof ref?.confidence === "number" ? clamp01(ref.confidence) : 0;
  const refNutr = (typeof ref?.nutrient === "string" ? ref.nutrient : "").toLowerCase();
  const refMicro = refNutr.includes("zinco") || refNutr.includes("ferro") || refNutr.includes("mangan");
  const refBoost = (cat) => {
    if (ref?.category !== cat) return 0;
    let b = 0.10 + 0.22 * refConf;
    if (cat === "nutricao") {
      if (diseaseStrong || sWater >= 0.65) b *= 0.45;
      if (refMicro && refConf < 0.78) b *= 0.30;
    }
    return clamp01(b);
  };

  const scored = [
    { key: "agua", score: (waterOk ? sWater : 0) + onlineBoost("agua") + refBoost("agua") + histBoost("agua") },
    { key: "agua_excesso", score: (hasLeafRead ? sOverWater : 0) },
    { key: "nutricao", score: (hasLeafRead ? sNutrAdj : (0.45 * sNutrAdj)) + onlineBoost("nutricao") + refBoost("nutricao") + histBoost("nutricao") },
    { key: "doenca", score: (hasLeafRead ? (sDisease + biasDisease) : (0.55 * sDisease)) + onlineBoost("doenca") + refBoost("doenca") + histBoost("doenca") },
    { key: "pragas", score: (hasLeafRead ? sPests : (0.55 * sPests)) + onlineBoost("pragas") + refBoost("pragas") + histBoost("pragas") },
    { key: "sol_forte", score: sSun },
    { key: "foto_ruim", score: sPhoto }
  ].sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const margin = best.score - (second?.score ?? 0);
  const confidence = best.score >= 0.70 ? "alta" : (best.score >= 0.55 ? (margin >= 0.10 ? "alta" : "média") : "baixa");

  const allowOk =
    best.score < 0.40 &&
    sPhoto < 0.55 &&
    leafFrac >= 0.28 &&
    lesionFrac < 0.022 &&
    necFrac < 0.015 &&
    sWater < 0.42 &&
    sNutr < 0.45 &&
    sDisease < 0.40 &&
    sPests < 0.40 &&
    sSun < 0.45;

  if (allowOk) {
    return {
      key: "ok",
      tone: "success",
      title: "Mais provável: tudo ok",
      text: "Não vi um problema forte nessa foto. Se a planta estiver ruim, tire outra foto mais perto e com boa luz.",
      help: "Para manter bem: molhe só quando o solo estiver seco (2 dedos), use palhada e evite molhar as folhas.",
      share: `Mais provável: tudo ok.\nConfiança: ${confidence}.\n${water?.message || ""}`.trim()
    };
  }

  if (confidence === "baixa" && margin < 0.10 && best.score < 0.68) {
    const label = (k) => ({
      agua: "água",
      agua_excesso: "excesso de água",
      nutricao: "nutrição",
      doenca: "doença",
      pragas: "pragas",
      sol_forte: "sol forte",
      foto_ruim: "foto sem leitura"
    }[k] || k);
    return {
      key: "incerto",
      tone: "warning",
      title: "Mais provável: não deu pra ter certeza",
      text: `Ficou parecido entre ${label(best.key)} e ${label(second?.key)}. Tente outra foto (mais perto, só uma folha, luz de dia).`,
      help: "Se puder, tire outra foto no mesmo horário de sempre e compare no Diário.",
      share: `Mais provável: não deu pra ter certeza.\nConfiança: ${confidence}.\nPossíveis: ${label(best.key)} / ${label(second?.key)}.`.trim()
    };
  }

  if (best.key === "foto_ruim") {
    const msg = ai?.issues?.find(x => x?.key === "foto_ruim")?.message || "Não consegui ler bem a folha nessa foto. Tente mais perto e com mais luz.";
    return {
      key: "foto_ruim",
      tone: "warning",
      title: "Mais provável: foto sem leitura",
      text: msg,
      help: "Encha a tela com uma folha só (bem perto), com luz de dia, sem sombra forte.",
      share: `Mais provável: foto sem leitura.\nConfiança: ${confidence}.\n${msg}`.trim()
    };
  }

  if (best.key === "sol_forte") {
    const msg = ai?.issues?.find(x => x?.key === "sol_forte")?.message || "Tem sinal de queimadura/estresse de sol/calor na folha.";
    return {
      key: "sol_forte",
      tone: "warning",
      title: "Mais provável: sol forte",
      text: msg,
      help: "Mantenha palhada, evite solo descoberto e reduza stress hídrico.",
      share: `Mais provável: sol forte.\nConfiança: ${confidence}.\n${msg}`.trim()
    };
  }

  if (best.key === "agua") {
    const tone = water?.label === "estressada" ? "danger" : "warning";
    return {
      key: "agua",
      tone,
      title: "Mais provável: falta de água",
      text: water?.message || "A planta está pedindo água.",
      help: "Como resolver: confirme com 2 dedos no solo. Se estiver seco, regue na raiz (sem molhar as folhas) de manhã cedo. Use palhada para segurar a umidade.",
      share: `Mais provável: falta de água.\nConfiança: ${confidence}.\n${water?.message || ""}`.trim()
    };
  }

  if (best.key === "agua_excesso") {
    const tone = best.score >= 0.72 ? "danger" : "warning";
    const msg = "A folha está mais amarelada e uniforme, com pouco sinal de sede. Pode ser excesso de água (encharcamento) ou drenagem ruim.";
    return {
      key: "agua_excesso",
      tone,
      title: "Mais provável: excesso de água",
      text: msg,
      help: "Como resolver: pare de molhar por agora. Veja se a água está empoçando. Faça escoamento/camalhão, evite regar à noite e volte a molhar só quando o solo secar (2 dedos).",
      share: `Mais provável: excesso de água.\nConfiança: ${confidence}.\n${msg}`.trim()
    };
  }

  if (best.key === "nutricao") {
    const nutrient =
      (online?.category === "nutricao" && onlineConf >= 0.75 && online?.nutrient) ? online.nutrient
        : (ref?.category === "nutricao" && refConf >= 0.75 && ref?.nutrient) ? ref.nutrient
          : (nutrition?.nutrient || null);
    const solution = nutrition?.solution || "";
    const fallbackSolution = "Use matéria orgânica (composto/esterco curtido), mantenha palhada e, se possível, faça análise de solo para corrigir com precisão.";
    return {
      key: "nutricao",
      tone: "warning",
      title: "Mais provável: falta de nutriente",
      text: nutrient ? `Nutriente: ${nutrient}.` : (nutrition?.message || "Possível falta de nutriente."),
      help: `O que fazer: ${solution || fallbackSolution}`,
      share: `Mais provável: falta de nutriente.\nConfiança: ${confidence}.\n${nutrient ? `Nutriente: ${nutrient}.` : ""}\nO que fazer: ${solution || fallbackSolution}`.trim()
    };
  }

  if (best.key === "doenca") {
    const dname =
      (ref?.category === "doenca" && ref?.disease) ? ref.disease
        : (online?.category === "doenca" && online?.disease) ? online.disease
          : (ai?.disease?.name || "mancha/doença (possível)");
    const dsol = ai?.disease?.solution || "Retire folhas muito atacadas, evite molhar folhas, aumente a ventilação e observe se está espalhando.";
    return {
      key: "doenca",
      tone: "danger",
      title: "Mais provável: doença",
      text: `Doença possível: ${dname}.`,
      help: `O que fazer: ${dsol}`,
      share: `Mais provável: doença.\nConfiança: ${confidence}.\nDoença possível: ${dname}.\nO que fazer: ${dsol}`.trim()
    };
  }

  const ptxt = "Possível praga sugadora na folha. Olhe embaixo das folhas e brotações.";
  return {
    key: "pragas",
    tone: "danger",
    title: "Mais provável: praga",
    text: ptxt,
    help: "Se estiver aumentando, faça controle cedo (biológicos/caldas conforme prática local) e reduza mato hospedeiro ao redor.",
    share: `Mais provável: praga.\nConfiança: ${confidence}.\n${ptxt}`
  };
}

function applyDecisionToUi({ alert, header, body, help, note, decision, cropKey }) {
  alert.className = `alert alert-${decision.tone} rq-card`;
  header.textContent = decision.title;
  body.textContent = decision.text;
  help.textContent = decision.help || "";
  if (!isOnline()) note.textContent = "Offline: decisão feita no celular.";
  if (isOnline() && note.textContent === "") note.textContent = "Online: decisão pode ficar mais certa com a comparação.";
}

function recordIcon(type) {
  if (type === "soil_scan") return "🧪";
  if (type === "pest_trap") return "🪲";
  if (type === "consortium_plan") return "🗺️";
  if (type === "plant_check") return "🪴";
  if (type === "alert_received") return "📣";
  if (type === "alert_outgoing") return "📤";
  if (type === "profile") return "👤";
  return "📌";
}

function recordCrop(r) {
  if (!r) return null;
  if (r.type === "plant_check") return r.data?.crop || null;
  if (r.type === "soil_scan") return r.data?.crop || null;
  if (r.type === "pest_trap") return r.data?.crop || null;
  if (r.type === "consortium_plan") return r.data?.focus_crop || null;
  if (r.type === "alert_received") return r.data?.payload?.crop || null;
  return null;
}

function allowRecordForCrop(r, cropKey) {
  if (!cropKey) return true;
  if (r.type === "profile") return true;
  const c = recordCrop(r);
  if (!c) return false;
  return c === cropKey;
}

async function screenDiary() {
  const activeCrop = await getActiveCrop();
  const recents = await recordsListRecent(120);
  const visible = recents.filter(r => allowRecordForCrop(r, activeCrop));
  const list = el("div", { class: "d-grid gap-2" });
  for (const r of visible) {
    const btn = el("button", { class: "rq-btn-big", type: "button" }, [
      el("div", { class: "rq-btn-big__icon", text: recordIcon(r.type) }),
      el("div", { class: "flex-grow-1" }, [
        el("p", { class: "rq-btn-big__title", text: titleForRecord(r) }),
        el("p", { class: "rq-btn-big__desc", text: humanDateTime(r.created_at) })
      ])
    ]);
    btn.addEventListener("click", () => location.hash = `#/diario/${encodeURIComponent(r.id)}`);
    list.append(btn);
  }
  const body = el("div", {}, [
    el("div", { class: "rq-help mb-3", text: activeCrop ? `Mostrando só a cultura ativa: ${cropLabel(activeCrop)}.` : "Aqui fica guardado: fotos, decisões, alertas e recomendações." }),
    visible.length ? list : el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
      el("div", { class: "fw-bold", text: "Sem registros dessa cultura" }),
      el("div", { class: "mt-1", text: "Faça uma leitura (Solo/Pragas/Planta) para aparecer no Diário." })
    ])
  ]);
  return card("Diário da Roça", body, { subtitle: "Histórico visual da safra." });
}

function titleForRecord(r) {
  if (r.type === "soil_scan") return "Raio‑X do Solo";
  if (r.type === "pest_trap") return "Armadilha de Pragas";
  if (r.type === "consortium_plan") {
    const cs = Array.isArray(r.data?.crops) ? r.data.crops : [];
    if (cs.length) return `Distâncias de Plantio (${cs.map(c => cropLabel(c)).join(" + ")})`;
    return `Plano de Consórcio (${cropLabel(r.data?.focus_crop || "")})`.trim();
  }
  if (r.type === "plant_check") return `Planta Falante (${cropLabel(r.data?.crop || "")})`.trim();
  if (r.type === "alert_received") return `Alerta da comunidade: ${r.data?.kind || "aviso"}`;
  if (r.type === "alert_outgoing") return `Alerta enviado: ${r.data?.kind || "aviso"}`;
  if (r.type === "profile") return "Meu cadastro";
  return r.type;
}

function friendlyDiaryDetail(r) {
  const d = r?.data || {};
  const crop = recordCrop(r);
  const cropLine = crop ? el("div", { class: "rq-help", text: `Cultura: ${cropLabel(crop)}.` }) : el("div");

  if (r.type === "soil_scan") {
    return el("div", { class: "d-grid gap-2" }, [
      cropLine,
      el("div", { class: "alert alert-success rq-card", role: "alert" }, [
        el("div", { class: "fw-bold", text: "Recomendação" }),
        el("div", { class: "mt-1", text: String(d.message || "—") })
      ]),
      el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Leitura" }),
          el("div", { class: "rq-help", text: `pH: ${d.ph ?? "—"} • Palhada (C/N): ${d.residue_cn ?? "—"}` })
        ])
      ])
    ]);
  }

  if (r.type === "pest_trap") {
    const tr = d?.trend?.label ? `Tendência: ${d.trend.label}.` : "";
    const guess = d?.profile?.guess ? `Tipo provável: ${d.profile.guess}.` : "";
    return el("div", { class: "d-grid gap-2" }, [
      cropLine,
      el("div", { class: `alert ${Number(d.severity || 0) >= 4 ? "alert-danger" : "alert-success"} rq-card`, role: "alert" }, [
        el("div", { class: "fw-bold", text: "Resultado" }),
        el("div", { class: "mt-1", text: String(d.message || "—") })
      ]),
      el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Resumo" }),
          el("div", { class: "rq-help", text: `Insetos: ${d.count ?? "—"}. ${tr} ${guess}`.trim() })
        ])
      ])
    ]);
  }

  if (r.type === "consortium_plan") {
    const cs = Array.isArray(d.crops) ? d.crops : [];
    const spacing = (d.spacing && typeof d.spacing === "object") ? d.spacing : null;
    const unit = typeof d.unit === "string" ? d.unit : "m";
    const hasSpacing = spacing && Object.keys(spacing).length > 0;
    return el("div", { class: "d-grid gap-2" }, [
      cropLine,
      el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Distâncias de plantio" }),
          cs.length ? el("div", { class: "rq-help", text: `Culturas: ${cs.map(c => cropLabel(c)).join(" + ")}.` }) : el("div"),
          hasSpacing
            ? el("div", { class: "mt-2 d-grid gap-1" }, (cs.length ? cs : Object.keys(spacing)).map((c) => {
                const s = spacing?.[c] || null;
                const row = (typeof s?.row_m === "number") ? `${s.row_m} ${unit}` : "—";
                const plant = (typeof s?.plant_m === "number") ? `${s.plant_m} ${unit}` : "—";
                return el("div", { text: `${cropLabel(c)}: linhas ${row} • plantas ${plant}` });
              }))
            : el("div", { class: "rq-help", text: "—" })
        ])
      ])
    ]);
  }

  if (r.type === "plant_check") {
    const water = d?.water || null;
    const nutri = d?.nutrition || null;
    const decision = d?.decision || null;
    const waterLine = (water && typeof water.stress === "number")
      ? `Água: ${String(water.label || "—")} (força ${Number(water.stress).toFixed(2)}).`
      : "Água: —";
    const nutrLine = nutri?.nutrient
      ? `Nutrição: ${String(nutri.nutrient)}.`
      : (nutri?.best?.label ? `Nutrição: ${String(nutri.best.label)}.` : "Nutrição: —");
    return el("div", { class: "d-grid gap-2" }, [
      cropLine,
      decision?.title
        ? el("div", { class: `alert alert-${decision.tone || "success"} rq-card`, role: "alert" }, [
            el("div", { class: "fw-bold", text: String(decision.title) }),
            el("div", { class: "mt-1", text: String(decision.text || "") }),
            decision.help ? el("div", { class: "rq-help mt-2", text: String(decision.help) }) : el("div")
          ])
        : el("div", { class: "alert alert-success rq-card", role: "alert" }, [
            el("div", { class: "fw-bold", text: "Leitura" }),
            el("div", { class: "mt-1", text: "—" })
          ]),
      el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Resumo" }),
          el("div", { class: "rq-help", text: `${waterLine} ${nutrLine}`.trim() })
        ])
      ])
    ]);
  }

  if (r.type === "alert_received" || r.type === "alert_outgoing") {
    const msg = d?.message || d?.payload?.message || "—";
    const sev = d?.severity ?? d?.payload?.severity ?? "—";
    const kind = d?.kind || d?.payload?.kind || "aviso";
    return el("div", { class: "d-grid gap-2" }, [
      cropLine,
      el("div", { class: `alert ${Number(sev) >= 4 ? "alert-danger" : "alert-warning"} rq-card`, role: "alert" }, [
        el("div", { class: "fw-bold", text: `Alerta (${String(kind)})` }),
        el("div", { class: "mt-1", text: String(msg) }),
        el("div", { class: "rq-help mt-2", text: `Severidade: ${sev}` })
      ])
    ]);
  }

  if (r.type === "profile") {
    const crops = Array.isArray(d.crops) ? d.crops : [];
    return el("div", { class: "d-grid gap-2" }, [
      el("div", { class: "rq-card card" }, [
        el("div", { class: "card-body" }, [
          el("div", { class: "fw-bold mb-1", text: "Seu cadastro" }),
          el("div", { class: "rq-help", text: `Nome: ${String(d.first_name || "—")}` }),
          el("div", { class: "rq-help", text: `Comunidade: ${String(d.community || "—")}` }),
          crops.length ? el("div", { class: "mt-2" }, [chips(crops.map(c => cropLabel(c)))]) : el("div")
        ])
      ])
    ]);
  }

  return el("div", { class: "rq-help", text: "Sem visualização amigável para esse tipo de registro." });
}

async function screenDiaryDetail(id) {
  const activeCrop = await getActiveCrop();
  const recents = await recordsListRecent(220);
  const r = recents.find(x => x.id === id);
  if (!r) return card("Diário", el("div", { class: "alert alert-warning rq-card", text: "Não achei esse registro." }));
  if (!allowRecordForCrop(r, activeCrop)) {
    return card("Diário", el("div", { class: "d-grid gap-3" }, [
      el("div", { class: "alert alert-warning rq-card", role: "alert" }, [
        el("div", { class: "fw-bold", text: "Registro bloqueado" }),
        el("div", { class: "mt-1", text: "Esse registro é de outra cultura. Troque a cultura ativa no mapa para ver." })
      ]),
      el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Trocar cultura no mapa", onclick: () => location.hash = "#/consorcio" })
    ]));
  }
  const imgs = await imagesByRecord(r.id);
  const photo = imgs?.[0]?.blob ? imgPreviewFromBlob(imgs[0].blob) : null;
  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "rq-help", text: humanDateTime(r.created_at) }),
    photo ? photo : el("div"),
    friendlyDiaryDetail(r),
    el("button", { class: "btn btn-outline-success btn-lg w-100 fw-bold", type: "button", text: "Voltar", onclick: () => history.back() })
  ]);
  return card(titleForRecord(r), body);
}

async function screenHelp() {
  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "alert alert-success rq-card", role: "alert" }, [
      el("div", { class: "fw-bold", text: "Como usar (bem fácil)" }),
      el("div", { class: "mt-1" }, [
        el("div", { text: "• Abra o app no celular e toque em “Instalar” no navegador (quando aparecer)." }),
        el("div", { text: "• Depois ele funciona offline." }),
        el("div", { text: "• Quando pegar internet, ele sincroniza sozinho." })
      ])
    ]),
    el("div", { class: "rq-card card" }, [
      el("div", { class: "card-body" }, [
        el("div", { class: "fw-bold mb-1", text: "Dicas de foto" }),
        el("div", { class: "rq-help" }, [
          el("div", { text: "• Foto perto, com boa luz." }),
          el("div", { text: "• Segure firme (sem tremido)." }),
          el("div", { text: "• Se der, sempre no mesmo horário." })
        ])
      ])
    ]),
    el("div", { class: "rq-card card" }, [
      el("div", { class: "card-body" }, [
        el("div", { class: "fw-bold mb-1", text: "Offline de verdade" }),
        el("div", { class: "rq-help" }, [
          el("div", { text: "O celular guarda tudo. A internet só serve pra avisar a vizinhança e fazer backup." })
        ])
      ])
    ]),
    el("div", { class: "rq-card card" }, [
      el("div", { class: "card-body" }, [
        el("div", { class: "fw-bold mb-1", text: "Corrigir o app" }),
        el("div", { class: "rq-help", text: "Se estiver travando ou desatualizado, use o botão abaixo." }),
        el("button", {
          class: "btn btn-success btn-lg w-100 fw-bold mt-2",
          type: "button",
          text: "Atualizar o app (corrigir)",
          onclick: async () => {
            try {
              if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                  try { await reg.update(); } catch {}
                  try { await reg.unregister(); } catch {}
                }
              }
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            } catch {}
            const u = new URL(location.href);
            u.searchParams.set("rq_reload", String(Date.now()));
            location.href = u.toString();
          }
        }),
      ])
    ]),
  ]);
  return card("Ajuda", body, { subtitle: "Feito pra celular simples." });
}

async function render() {
  await updateTopbar();
  const profile = await userGet();
  const r = routeNow();

  if (!profile && r !== "#/cadastro" && r !== "#/ajuda") {
    location.hash = "#/cadastro";
    return;
  }

  if (r === "#/cadastro") return mount(await screenOnboarding());
  if (r === "#/home") return mount(await screenHome());
  if (r === "#/solo") return mount(await screenSoil());
  if (r === "#/pragas") return mount(await screenPests());
  if (r === "#/consorcio") return mount(await screenConsortium());
  if (r === "#/planta") return mount(await screenPlant());
  if (r === "#/diario") return mount(await screenDiary());
  if (r.startsWith("#/diario/")) {
    const id = decodeURIComponent(r.split("/").slice(2).join("/"));
    return mount(await screenDiaryDetail(id));
  }
  if (r === "#/ajuda") return mount(await screenHelp());

  location.hash = "#/home";
}

function wireNav() {
  for (const b of qsa(".rq-navbtn")) {
    b.addEventListener("click", () => {
      const r = b.getAttribute("data-route");
      if (r) location.hash = r;
    });
  }
}

function wireNetwork() {
  window.addEventListener("online", async () => {
    await updateTopbar();
    toast("Pegou internet. Vou sincronizar.");
    await ensureServerUser();
    await syncNow({ silent: true });
  });
  window.addEventListener("offline", () => {
    updateTopbar();
    toast("Ficou offline. Sem problema.");
  });
  setInterval(() => {
    if (isOnline()) ensureServerUser().then(() => syncNow({ silent: true }));
  }, 60_000);
}

function wireInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (routeNow() === "#/home") render();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    toast("Instalado. Agora funciona melhor offline.");
    if (routeNow() === "#/home") render();
  });
}

try {
  await ensureSw();
  wireNav();
  wireNetwork();
  wireInstall();
  window.addEventListener("hashchange", () => render().catch((e) => {
    captureJsError("render", e);
    mount(screenFatal(e));
  }));
  render().catch((e) => {
    captureJsError("render", e);
    mount(screenFatal(e));
  });
} catch (e) {
  captureJsError("boot", e);
  mount(screenFatal(e));
}

function screenFatal(e) {
  const info = normalizeError(e);
  const body = el("div", { class: "d-grid gap-3" }, [
    el("div", { class: "alert alert-danger rq-card", role: "alert" }, [
      el("div", { class: "fw-bold", text: "Deu erro no app" }),
      el("div", { class: "mt-1", text: info.message || "Erro" }),
      el("div", { class: "rq-help mt-2", text: "Toque em “Atualizar o app (corrigir)” na Ajuda." })
    ]),
    el("button", { class: "btn btn-success btn-lg w-100 fw-bold", type: "button", text: "Ir pra Ajuda", onclick: () => location.hash = "#/ajuda" })
  ]);
  return card("Erro", body, { subtitle: "Vamos corrigir." });
}
