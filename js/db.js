import { encryptData, decryptData, encryptBytes, decryptBytes } from "./crypto.js";
import { normalizeNoteShape } from "./model.js";

const DB_NAME = "notes-db";
const DB_VERSION = 3;

const META = "meta";
const ENTRIES = "entries";
const BLOBS = "blobs";
const LEGACY = "notes";

let dbPromise = null;

function ensureV3Stores(db) {
  if (!db.objectStoreNames.contains(META)) {
    db.createObjectStore(META, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(ENTRIES)) {
    db.createObjectStore(ENTRIES, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(BLOBS)) {
    db.createObjectStore(BLOBS, { keyPath: "id" });
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      if (event.oldVersion < 3) {
        if (db.objectStoreNames.contains(LEGACY)) {
          const getAllReq = tx.objectStore(LEGACY).getAll();
          getAllReq.onerror = () => {
            throw getAllReq.error;
          };
          getAllReq.onsuccess = () => {
            const legacyRows = getAllReq.result || [];
            db.deleteObjectStore(LEGACY);
            ensureV3Stores(db);
            if (legacyRows.length > 0) {
              const metaStore = tx.objectStore(META);
              metaStore.put({
                id: "legacyPending",
                json: JSON.stringify(legacyRows),
              });
            }
          };
        } else {
          ensureV3Stores(db);
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
  });
}

export function initDB() {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }
  return dbPromise;
}

export async function getMeta(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readonly");
    const store = tx.objectStore(META);
    const r = store.get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || null);
  });
}

export async function putMeta(record) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readwrite");
    const store = tx.objectStore(META);
    const r = store.put(record);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMeta(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readwrite");
    const store = tx.objectStore(META);
    const r = store.delete(id);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasSalt() {
  const row = await getMeta("salt");
  return !!(row && row.salt);
}

export async function getSalt() {
  const row = await getMeta("salt");
  if (!row || !row.salt) {
    return null;
  }
  return row.salt;
}

export async function setSalt(saltBuffer) {
  const saltCopy = new Uint8Array(saltBuffer);
  await putMeta({ id: "salt", salt: saltCopy });
}

export async function setLegacyPending(jsonString) {
  if (jsonString === null || jsonString === undefined) {
    await deleteMeta("legacyPending");
    return;
  }
  await putMeta({ id: "legacyPending", json: jsonString });
}

async function encryptNoteRecord(key, normalizedNote) {
  const packed = await encryptData(key, normalizedNote);
  return {
    id: normalizedNote.id,
    iv: packed.iv,
    ciphertext: packed.ciphertext,
  };
}

async function decryptNoteRecord(key, row) {
  const plain = await decryptData(key, row.iv, row.ciphertext);
  return normalizeNoteShape(plain);
}

export async function saveNote(key, note) {
  const normalized = normalizeNoteShape(note);
  const db = await initDB();
  const row = await encryptNoteRecord(key, normalized);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    const r = store.put(row);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve(normalized);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getNote(key, id) {
  const db = await initDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES, "readonly");
    const store = tx.objectStore(ENTRIES);
    const r = store.get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || null);
  });
  if (!row) {
    return null;
  }
  return decryptNoteRecord(key, row);
}

export async function getAllNotes(key) {
  const db = await initDB();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES, "readonly");
    const store = tx.objectStore(ENTRIES);
    const r = store.getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || []);
  });
  const notes = [];
  for (const row of rows) {
    const note = await decryptNoteRecord(key, row);
    notes.push(note);
  }
  notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return notes;
}

export async function deleteNote(key, id) {
  const existing = await getNote(key, id);
  if (!existing) {
    return;
  }
  const blobIds = collectBlobIds(existing);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ENTRIES, BLOBS], "readwrite");
    const entryStore = tx.objectStore(ENTRIES);
    entryStore.delete(id);
    const blobStore = tx.objectStore(BLOBS);
    blobIds.forEach((bid) => blobStore.delete(bid));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function collectBlobIds(note) {
  const ids = [];
  const d = note.data || {};
  if (typeof d.audioBlobId === "string") {
    ids.push(d.audioBlobId);
  }
  if (typeof d.imageBlobId === "string") {
    ids.push(d.imageBlobId);
  }
  if (typeof d.thumbBlobId === "string") {
    ids.push(d.thumbBlobId);
  }
  return ids;
}

export async function saveEncryptedBlob(key, blob) {
  const buf = await blob.arrayBuffer();
  const packed = await encryptBytes(key, buf);
  const blobId = crypto.randomUUID();
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS, "readwrite");
    const store = tx.objectStore(BLOBS);
    const record = {
      id: blobId,
      iv: packed.iv,
      ciphertext: packed.ciphertext,
    };
    const r = store.put(record);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve(blobId);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getEncryptedBlob(key, id) {
  const db = await initDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS, "readonly");
    const store = tx.objectStore(BLOBS);
    const r = store.get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || null);
  });
  if (!row) {
    return null;
  }
  const plain = await decryptBytes(key, row.iv, row.ciphertext);
  return new Blob([plain]);
}

export async function deleteEncryptedBlob(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS, "readwrite");
    const store = tx.objectStore(BLOBS);
    const r = store.delete(id);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function writeVaultVerifier(key) {
  const packed = await encryptData(key, { kind: "vault-verifier", v: 1 });
  await putMeta({
    id: "vaultVerifier",
    iv: packed.iv,
    ciphertext: packed.ciphertext,
  });
}

export async function verifyVaultKey(key) {
  const row = await getMeta("vaultVerifier");
  if (!row || !row.iv || !row.ciphertext) {
    return true;
  }
  try {
    await decryptData(key, row.iv, row.ciphertext);
    return true;
  } catch {
    return false;
  }
}
