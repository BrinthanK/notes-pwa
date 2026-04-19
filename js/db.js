import { normalizeNoteShape } from "./model.js";

const DB_NAME = "notes-pwa-store";
const DB_VERSION = 1;

const NOTES = "notes";
const BLOBS = "blobs";

let dbPromise = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(NOTES)) {
        db.createObjectStore(NOTES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOBS)) {
        db.createObjectStore(BLOBS, { keyPath: "id" });
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

export async function saveNote(note) {
  const normalized = normalizeNoteShape(note);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES, "readwrite");
    const store = tx.objectStore(NOTES);
    const r = store.put(normalized);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve(normalized);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getNote(id) {
  const db = await initDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES, "readonly");
    const store = tx.objectStore(NOTES);
    const r = store.get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || null);
  });
  if (!row) {
    return null;
  }
  return normalizeNoteShape(row);
}

export async function getAllNotes() {
  const db = await initDB();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES, "readonly");
    const store = tx.objectStore(NOTES);
    const r = store.getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || []);
  });
  const notes = rows.map((row) => normalizeNoteShape(row));
  notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return notes;
}

export async function deleteNote(id) {
  const existing = await getNote(id);
  if (!existing) {
    return;
  }
  const blobIds = collectBlobIds(existing);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([NOTES, BLOBS], "readwrite");
    const entryStore = tx.objectStore(NOTES);
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

export async function saveBlob(blob) {
  const blobId = crypto.randomUUID();
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS, "readwrite");
    const store = tx.objectStore(BLOBS);
    const record = { id: blobId, blob };
    const r = store.put(record);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => resolve(blobId);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(id) {
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
  return row.blob;
}

export async function deleteBlob(id) {
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
