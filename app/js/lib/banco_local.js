/*
  Banco local (IndexedDB)

  A ideia é o app funcionar offline, então a gente guarda tudo aqui:
  - meta: coisinhas pequenas (ex.: status da sync)
  - user: cadastro
  - records: Diário
  - images: fotos (Blob) ligadas ao record
  - outbox: fila do que falta mandar pro servidor
*/
const DB_NAME = "rq_db";
const DB_VERSION = 2;

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cursorToList(req, limit = Infinity) {
  return new Promise((resolve, reject) => {
    const list = [];
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || list.length >= limit) return resolve(list);
      list.push(cursor.value);
      cursor.continue();
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Abre o banco local (IndexedDB) e cria as “tabelas” quando precisa.
 */
export async function openDb() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (ev) => {
    const db = req.result;
    const tx = req.transaction;
    const old = ev.oldVersion || 0;

    if (old < 1) {
      const meta = db.createObjectStore("meta", { keyPath: "key" });
      meta.createIndex("key", "key", { unique: true });

      db.createObjectStore("user", { keyPath: "id" });

      const records = db.createObjectStore("records", { keyPath: "id" });
      records.createIndex("type", "type", { unique: false });
      records.createIndex("created_at", "created_at", { unique: false });

      const images = db.createObjectStore("images", { keyPath: "id" });
      images.createIndex("record_id", "record_id", { unique: false });
      images.createIndex("created_at", "created_at", { unique: false });

      const outbox = db.createObjectStore("outbox", { keyPath: "id" });
      outbox.createIndex("created_at", "created_at", { unique: false });
    }

    if (old < 2) {
      const records = tx.objectStore("records");
      if (!records.indexNames.contains("type_created_at")) {
        records.createIndex("type_created_at", ["type", "created_at"], { unique: false });
      }
    }
  };
  return reqToPromise(req);
}

/**
 * Pega uma informação pequena do `meta`.
 */
export async function metaGet(key) {
  const db = await openDb();
  const tx = db.transaction(["meta"], "readonly");
  const v = await reqToPromise(tx.objectStore("meta").get(key));
  await txDone(tx);
  return v?.value ?? null;
}

/**
 * Salva uma informação pequena no `meta`.
 */
export async function metaSet(key, value) {
  const db = await openDb();
  const tx = db.transaction(["meta"], "readwrite");
  tx.objectStore("meta").put({ key, value });
  await txDone(tx);
}

/**
 * Pega o cadastro salvo no celular (ou null).
 */
export async function userGet() {
  const db = await openDb();
  const tx = db.transaction(["user"], "readonly");
  const all = await reqToPromise(tx.objectStore("user").getAll());
  await txDone(tx);
  return all?.[0] ?? null;
}

/**
 * Salva o cadastro no celular (substitui o anterior).
 */
export async function userPut(profile) {
  const db = await openDb();
  const tx = db.transaction(["user"], "readwrite");
  tx.objectStore("user").clear();
  tx.objectStore("user").put(profile);
  await txDone(tx);
}

/**
 * Insere/atualiza um registro do Diário.
 */
export async function recordPut(rec) {
  const db = await openDb();
  const tx = db.transaction(["records"], "readwrite");
  tx.objectStore("records").put(rec);
  await txDone(tx);
}

/**
 * Busca um registro do Diário por id.
 */
export async function recordGet(id) {
  const db = await openDb();
  const tx = db.transaction(["records"], "readonly");
  const res = await reqToPromise(tx.objectStore("records").get(id));
  await txDone(tx);
  return res ?? null;
}

/**
 * Lista registros do Diário de um tipo (mais recentes primeiro).
 */
export async function recordsListByType(type, limit = 50) {
  const db = await openDb();
  const tx = db.transaction(["records"], "readonly");
  const store = tx.objectStore("records");
  if (store.indexNames.contains("type_created_at")) {
    const idx = store.index("type_created_at");
    const range = IDBKeyRange.bound([type, ""], [type, "\uffff"]);
    const list = await cursorToList(idx.openCursor(range, "prev"), limit);
    await txDone(tx);
    return list;
  }

  const idx = store.index("type");
  const list = await cursorToList(idx.openCursor(type, "prev"), limit);
  await txDone(tx);
  return list;
}

/**
 * Lista registros do Diário por data (mais recentes primeiro).
 */
export async function recordsListRecent(limit = 80) {
  const db = await openDb();
  const tx = db.transaction(["records"], "readonly");
  const idx = tx.objectStore("records").index("created_at");
  const list = await cursorToList(idx.openCursor(null, "prev"), limit);
  await txDone(tx);
  return list;
}

/**
 * Salva uma imagem (Blob) ligada a um record.
 */
export async function imagePut(img) {
  const db = await openDb();
  const tx = db.transaction(["images"], "readwrite");
  tx.objectStore("images").put(img);
  await txDone(tx);
}

/**
 * Lista imagens associadas a um record (mais recentes primeiro).
 */
export async function imagesByRecord(recordId) {
  const db = await openDb();
  const tx = db.transaction(["images"], "readonly");
  const idx = tx.objectStore("images").index("record_id");
  const list = await cursorToList(idx.openCursor(recordId, "prev"), Infinity);
  await txDone(tx);
  return list;
}

/**
 * Adiciona uma mutação na fila de sincronização (outbox).
 */
export async function outboxAdd(item) {
  const db = await openDb();
  const tx = db.transaction(["outbox"], "readwrite");
  tx.objectStore("outbox").put(item);
  await txDone(tx);
}

/**
 * Lista mutações pendentes (mais recentes primeiro).
 */
export async function outboxList(limit = 50) {
  const db = await openDb();
  const tx = db.transaction(["outbox"], "readonly");
  const idx = tx.objectStore("outbox").index("created_at");
  const list = await cursorToList(idx.openCursor(null, "prev"), limit);
  await txDone(tx);
  return list;
}

/**
 * Conta quantas mutações estão pendentes.
 */
export async function outboxCount() {
  const db = await openDb();
  const tx = db.transaction(["outbox"], "readonly");
  const n = await reqToPromise(tx.objectStore("outbox").count());
  await txDone(tx);
  return n || 0;
}

/**
 * Remove uma mutação já confirmada pelo servidor.
 */
export async function outboxDelete(id) {
  const db = await openDb();
  const tx = db.transaction(["outbox"], "readwrite");
  tx.objectStore("outbox").delete(id);
  await txDone(tx);
}
