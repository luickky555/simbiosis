/*
  Cliente da API (parte do app que conversa com o servidor)

  O que a gente faz aqui:
  - Monta a URL base da API (vem do `inicio.php` via `window.__RQ__`).
  - Envia sempre o `X-Device-Id` pra identificar o celular.
  - Se der erro, transforma em `ApiError` pra UI mostrar direitinho.
*/

import { getDeviceId } from "./dispositivo.js";

/**
 * Pega o caminho base da API (normalmente "api").
 */
function base() {
  return window.__RQ__?.apiBase || "api";
}

/**
 * Erro que a gente usa pra tratar resposta ruim da API.
 */
export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Faz uma chamada pra API e tenta ler JSON.
 * Se der erro, joga ApiError.
 */
export async function apiFetch(path, { method = "GET", body = null, headers = {} } = {}) {
  const deviceId = await getDeviceId();
  const baseUrl = String(base() || "api").replace(/\/+$/, "");
  const relPath = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  const [routePath, queryString] = relPath.split("?");
  const opts = {
    method,
    headers: {
      "Accept": "application/json",
      "X-Device-Id": deviceId,
      ...headers,
    }
  };
  if (body !== null) {
    opts.headers["Content-Type"] = "application/json; charset=utf-8";
    opts.body = JSON.stringify(body);
  }

  let url = `${baseUrl}${relPath}`;
  if (baseUrl.includes(".php")) {
    const r = encodeURIComponent(routePath);
    url = `${baseUrl}?r=${r}${queryString ? `&${queryString}` : ""}`;
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const baseMsg = data?.error?.message || data?.message || `Erro HTTP ${res.status}`;
    const detailMsg = data?.error?.details?.message ? String(data.error.details.message) : "";
    const msg = detailMsg ? `${baseMsg} (${detailMsg.slice(0, 180)})` : baseMsg;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
