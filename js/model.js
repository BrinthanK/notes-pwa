export const NOTE_TYPES = ["note", "todo", "audio", "image"];

export function createEmptyNote(type, idFactory) {
  const now = Date.now();
  const base = {
    id: idFactory(),
    type,
    title: "",
    content: "",
    data: {},
    createdAt: now,
    updatedAt: now,
  };
  if (type === "todo") {
    base.data = { items: [{ text: "New task", done: false }] };
  }
  if (type === "audio" || type === "image") {
    base.data = {};
  }
  return base;
}

export function previewTitle(note) {
  const t = (note.title || "").trim();
  if (t.length > 0) {
    return t;
  }
  if (note.type === "note") {
    const b = (note.content || "").trim().split(/\r?\n/)[0];
    if (b && b.length > 0) {
      return b.slice(0, 80);
    }
  }
  if (note.type === "todo" && note.data && Array.isArray(note.data.items)) {
    const first = note.data.items.find((it) => (it.text || "").trim().length > 0);
    if (first) {
      return first.text.trim().slice(0, 80);
    }
  }
  if (note.type === "audio") {
    return "Audio note";
  }
  if (note.type === "image") {
    return "Image note";
  }
  return "Untitled";
}

export function typeGlyph(type) {
  if (type === "todo") {
    return "☑";
  }
  if (type === "audio") {
    return "◉";
  }
  if (type === "image") {
    return "▣";
  }
  return "◆";
}

export function normalizeNoteShape(row) {
  const n = { ...row };
  n.title = typeof n.title === "string" ? n.title : "";
  n.content = typeof n.content === "string" ? n.content : "";
  n.data = n.data && typeof n.data === "object" ? n.data : {};
  if (n.type === "todo") {
    if (!Array.isArray(n.data.items)) {
      n.data.items = [];
    }
  }
  return n;
}
