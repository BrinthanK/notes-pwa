import { saveNote, setLegacyPending } from "./db.js";
import { normalizeNoteShape } from "./model.js";

export async function loadLegacyPendingRows() {
  const row = await getMeta("legacyPending");
  if (!row || typeof row.json !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(row.json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function migrateV1RowsToVault(key, legacyRows) {
  const created = [];
  for (const row of legacyRows) {
    const note = normalizeNoteShape({
      id: row.id,
      type: "note",
      title: row.title || "",
      content: row.body || "",
      data: {},
      createdAt: row.updatedAt || Date.now(),
      updatedAt: row.updatedAt || Date.now(),
    });
    await saveNote(key, note);
    created.push(note);
  }
  await setLegacyPending(null);
  return created;
}
