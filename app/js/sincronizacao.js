/*
  Sincronização (o jeito “offline primeiro” que a gente fez)

  - O app deixa salvar tudo mesmo sem internet.
  - Depois ele manda pro servidor em lotes (fila/outbox).
  - Também puxa alertas da comunidade (só da mesma região).
*/
import { outboxAdd, outboxDelete, outboxList, metaGet, metaSet, recordPut, userGet } from "./lib/banco_local.js";
import { ApiError, apiFetch } from "./lib/cliente_api.js";
import { isOnline, nowIso, toast, uuidv4 } from "./lib/utilitarios.js";

let autoSyncTimer = null;
let autoSyncRunning = false;

/*
  Regras de sincronização

  - `server_user_ok` (meta) diz se o servidor já reconheceu esse celular como cadastrado.
  - `outbox` é a fila do que ainda falta mandar (registros/alertas).
  - O app tenta sincronizar “quietinho” quando tá online, sem travar a tela.
*/

/**
 * Confere se esse celular tá cadastrado no servidor.
 * - tenta buscar o /users/me
 * - se não der, tenta cadastrar usando os dados do banco local
 */
async function ensureServerUserForSync() {
  if (!isOnline()) return false;
  const already = await metaGet("server_user_ok").catch(() => false);
  try {
    const me = await apiFetch("/users/me", { method: "GET" });
    if (me?.user?.id) {
      await metaSet("server_user_ok", true);
      return true;
    }
  } catch {
  }
  if (already === true) await metaSet("server_user_ok", false).catch(() => {});
  const profile = await userGet().catch(() => null);
  if (!profile?.first_name || !profile?.community) return false;
  try {
    const producerCode = profile?.producer_code || await metaGet("producer_code_v1").catch(() => null);
    await apiFetch("/users/register", {
      method: "POST",
      body: { first_name: profile.first_name, community: profile.community, crops: profile.crops || [], producer_code: producerCode || null }
    });
    await metaSet("server_user_ok", true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tenta mandar a fila (outbox) em lotes, sozinho.
 */
async function autoSyncFlush() {
  if (autoSyncRunning) return;
  autoSyncRunning = true;
  try {
    if (!isOnline()) return;
    const okUser = await ensureServerUserForSync();
    if (!okUser) return;
    for (let i = 0; i < 6; i++) {
      const pending = await outboxList(1);
      if (pending.length === 0) break;
      const r = await trySync({ silent: true });
      if (!r?.ok) break;
    }
  } finally {
    autoSyncRunning = false;
  }
}

/**
 * Agenda uma tentativa de sync quando:
 * - volta a ter internet
 * - entrou coisa nova na fila
 */
function scheduleAutoSync() {
  if (!isOnline()) return;
  if (autoSyncTimer) return;
  autoSyncTimer = setTimeout(async () => {
    autoSyncTimer = null;
    await autoSyncFlush();
  }, 650);
}

/**
 * Coloca um registro do Diário na fila pra mandar pro servidor depois.
 */
export async function queueRecord({ id, type, created_at, data }) {
  await outboxAdd({
    id: uuidv4(),
    created_at: nowIso(),
    op: "upsert",
    entity: "record",
    data: { id, type, created_at, data }
  });
  scheduleAutoSync();
}

/**
 * Coloca um alerta na fila pra mandar pro servidor depois.
 */
export async function queueAlert({ id, kind, severity, message, created_at, meta }) {
  await outboxAdd({
    id: uuidv4(),
    created_at: nowIso(),
    op: "upsert",
    entity: "alert",
    data: { id, kind, severity, message, created_at, meta }
  });
  scheduleAutoSync();
}

/**
 * Tenta sincronizar:
 * - envia mutações pendentes (/sync/push)
 * - remove itens confirmados (ack)
 * - grava alertas recebidos no Diário
 * - atualiza metas de status (last_sync_ok, last_sync_error, last_alert_pull)
 */
export async function trySync({ silent = true } = {}) {
  if (!isOnline()) return { ok: false, reason: "offline" };
  const batch = (await outboxList(25)).reverse();
  const mutations = batch.map(it => ({ op: it.op, entity: it.entity, data: it.data }));
  const lastPull = await metaGet("last_alert_pull");
  if (mutations.length === 0 && !lastPull) {
    if (!silent) toast("Nada pra sincronizar.");
    return { ok: true, pushed: 0, pulled: 0 };
  }

  try {
    await metaSet("last_sync_try", nowIso());
    const res = await apiFetch("/sync/push", {
      method: "POST",
      body: { mutations, last_pull: lastPull || "" }
    });

    const ackIds = new Set(res?.ack || []);
    for (const item of batch) {
      const localUuid = item?.data?.id;
      if (localUuid && ackIds.has(localUuid)) await outboxDelete(item.id);
    }

    const alerts = Array.isArray(res?.alerts) ? res.alerts : [];
    if (alerts.length) {
      for (const a of alerts) {
        await recordPut({
          id: `alert:${a.local_uuid}`,
          type: "alert_received",
          created_at: a.created_at,
          data: a
        });
      }
      await metaSet("last_alert_pull", res.server_time || nowIso());
    } else if (res?.server_time) {
      await metaSet("last_alert_pull", res.server_time);
    }

    if (res?.server_time) await metaSet("last_sync_ok", res.server_time);
    if (!silent) toast("Sincronizou com a comunidade.");
    return { ok: true, pushed: mutations.length, pulled: alerts.length };
  } catch (e) {
    const msg = e?.message || String(e);
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      await metaSet("server_user_ok", false).catch(() => {});
    }
    await metaSet("last_sync_error", { at: nowIso(), message: msg });
    if (!silent) toast(String(msg).slice(0, 140));
    return { ok: false, reason: "error", error: msg };
  }
}

/**
 * Registra Background Sync ("rq-sync") quando há pendências.
 * - Nem todos os navegadores suportam.
 */
export async function maybeRegisterBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  if (!("SyncManager" in window)) return;
  const pending = await outboxList(1);
  if (pending.length === 0) return;
  const reg = await navigator.serviceWorker.ready;
  try { await reg.sync.register("rq-sync"); } catch {}
}
