const listeners = new Set();

let notes = [];
let selectedId = null;
let editorNonce = 0;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((fn) => fn(getSnapshot()));
}

export function getSnapshot() {
  return {
    notes,
    selectedId,
    editorNonce,
  };
}

export function setNotes(nextNotes) {
  notes = Array.isArray(nextNotes) ? nextNotes.slice() : [];
  notify();
}

export function upsertNoteInState(note) {
  const idx = notes.findIndex((n) => n.id === note.id);
  const copy = notes.slice();
  if (idx >= 0) {
    copy[idx] = note;
  } else {
    copy.unshift(note);
  }
  copy.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  notes = copy;
  notify();
}

export function removeNoteFromState(id) {
  notes = notes.filter((n) => n.id !== id);
  if (selectedId === id) {
    selectedId = null;
  }
  notify();
}

export function selectNote(id) {
  selectedId = id;
  notify();
}

export function getSelectedNote() {
  if (!selectedId) {
    return null;
  }
  return notes.find((n) => n.id === selectedId) || null;
}

export function bumpEditorNonce() {
  editorNonce += 1;
  notify();
}
