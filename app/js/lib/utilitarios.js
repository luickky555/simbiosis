/*
  Coisinhas úteis do app

  Aqui fica um monte de função pequena que a gente usa em várias telas:
  - achar/criar elementos no HTML
  - datas, números, sleep
  - ver se tá online / se tá instalado
  - toast e compartilhar
*/

/**
 * Atalho pra pegar um elemento do HTML (querySelector).
 */
export function qs(sel, root = document) {
  return root.querySelector(sel);
}

/**
 * Atalho pra pegar vários elementos do HTML (querySelectorAll) e virar lista.
 */
export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Cria um elemento DOM com atributos e filhos.
 * - `class` e `text` recebem tratamento especial.
 * - Atributos `on*` viram eventos.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

/**
 * Gera um ID único (UUID v4). Quando dá, usa o do navegador.
 */
export function uuidv4() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Data/hora em formato ISO (padrão) em UTC.
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Limita um número ao intervalo [min, max].
 */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Dá uma pausinha (sleep) usando Promise.
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Formata ISO para string pt-BR curta.
 */
export function humanDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/**
 * Se o navegador tá dizendo que tem internet ou não.
 */
export function isOnline() {
  return navigator.onLine === true;
}

/**
 * Faz SHA-256 de um texto e devolve em base64url.
 */
export async function sha256Base64Url(inputUtf8) {
  const data = new TextEncoder().encode(inputUtf8);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Mensagem rápida na tela (toast).
 */
export function toast(msg, tone = "dark") {
  const wrap = document.getElementById("rqToasts");
  if (!wrap) return;
  const t = el("div", { class: "rq-toast", "data-tone": tone, text: msg });
  wrap.append(t);
  setTimeout(() => t.remove(), 3200);
}

/**
 * Atualiza o texto de status (online/offline e pendências) lá em cima.
 */
export function setNetBadge({ pending = null, syncing = false } = {}) {
  const node = document.getElementById("rqNetStatus");
  if (!node) return;
  const parts = [];
  parts.push(isOnline() ? "Online" : "Offline");
  if (syncing) parts.push("Sync…");
  if (typeof pending === "number" && pending > 0) parts.push(`${pending} pend.`);
  node.textContent = parts.join(" • ");
}

/**
 * Diz se o app está “instalado” (modo tela cheia / atalho do celular).
 */
export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || window.navigator?.standalone === true;
}

/**
 * Tenta detectar iPhone/iPad (Safari).
 */
export function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

/**
 * Tenta compartilhar (quando o celular deixa). Se não der, copia o texto pra área de transferência.
 */
export async function shareOrCopy({ title = "", text = "" }) {
  const payload = { title, text };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return { ok: true, mode: "share" };
    } catch {
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copiei pra você colar no WhatsApp.");
      return { ok: true, mode: "clipboard" };
    } catch {
    }
  }
  toast(text);
  return { ok: false, mode: "toast" };
}
