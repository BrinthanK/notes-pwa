import { mountEditor, renderModeButtons } from "./editors.js";
import { previewTitle, typeGlyph } from "./model.js";

function formatTime(ts) {
  if (!ts) {
    return "";
  }
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

export function createAppUi(els) {
  const {
    noteList,
    editorEmpty,
    editorForm,
    editorRoot,
    noteTitle,
    saveStatus,
    btnNew,
    btnDelete,
    btnLock,
    modeBar,
    app,
  } = els;

  const titleInput = noteTitle;
  const listEl = noteList;
  const emptyEl = editorEmpty;
  const formEl = editorForm;
  const statusEl = saveStatus;
  const rootEl = editorRoot;

  let editorApi = { collect: () => ({}) };
  let lastEditorKey = { id: null, nonce: -1 };

  function setSaveStatus(text) {
    statusEl.textContent = text || "";
  }

  function getTitleValue() {
    return titleInput.value;
  }

  function collectEditor() {
    if (typeof editorApi.collect === "function") {
      return editorApi.collect();
    }
    return {};
  }

  function buildEditorKey(snap, note) {
    if (!note) {
      return "∅";
    }
    return `${note.id}|${snap.editorNonce}`;
  }

  function shouldRemount(snap, note) {
    if (!note) {
      return true;
    }
    const k = buildEditorKey(snap, note);
    const prev = `${lastEditorKey.id}|${lastEditorKey.nonce}`;
    if (k === prev) {
      return false;
    }
    return true;
  }

  function remountEditor(snap) {
    const note = snap.notes.find((n) => n.id === snap.selectedId) || null;
    if (!note) {
      rootEl.replaceChildren();
      editorApi = { collect: () => ({}) };
      return;
    }
    if (!shouldRemount(snap, note)) {
      return;
    }
    const bridge = {
      scheduleSave: app.scheduleSave,
      onAudioStart: app.onAudioStart,
      onAudioStop: app.onAudioStop,
      attachAudioElement: app.attachAudioElement,
      onImagePicked: app.onImagePicked,
      onImageCamera: app.onImageCamera,
      attachImageThumbnail: app.attachImageThumbnail,
      onImageLoadFull: app.onImageLoadFull,
    };
    editorApi = mountEditor(rootEl, note, bridge);
    lastEditorKey = { id: note.id, nonce: snap.editorNonce };
  }

  function paintModes() {
    renderModeButtons(modeBar, app.getCreationMode(), (m) => app.pickCreationMode(m));
  }

  function fillTitle(note) {
    if (!note) {
      titleInput.value = "";
      return;
    }
    titleInput.value = note.title || "";
  }

  function showEmpty() {
    emptyEl.hidden = false;
    formEl.hidden = true;
    btnDelete.disabled = true;
    titleInput.value = "";
    rootEl.replaceChildren();
    editorApi = { collect: () => ({}) };
    setSaveStatus("");
  }

  function showForm() {
    emptyEl.hidden = true;
    formEl.hidden = false;
    btnDelete.disabled = false;
  }

  function renderList(snap) {
    listEl.replaceChildren();
    app.revokeObjectUrls();
    snap.notes.forEach((note) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "note-list__item";
      if (note.id === snap.selectedId) {
        row.classList.add("note-list__item--active");
      }
      row.setAttribute("role", "listitem");
      row.dataset.id = note.id;
      const top = document.createElement("div");
      top.className = "note-list__row";
      if (note.type === "image" && note.data && note.data.thumbBlobId) {
        const thumb = document.createElement("img");
        thumb.className = "note-list__thumb";
        thumb.alt = "";
        thumb.loading = "lazy";
        top.appendChild(thumb);
        app.loadListThumb(note.data.thumbBlobId).then((url) => {
          if (url) {
            thumb.src = url;
          }
        });
      } else {
        const glyph = document.createElement("span");
        glyph.className = "note-list__glyph";
        glyph.textContent = typeGlyph(note.type);
        top.appendChild(glyph);
      }
      const textCol = document.createElement("div");
      textCol.className = "note-list__text";
      const title = document.createElement("div");
      title.className = "note-list__item-title";
      title.textContent = previewTitle(note);
      const meta = document.createElement("div");
      meta.className = "note-list__item-meta";
      meta.textContent = formatTime(note.updatedAt);
      textCol.appendChild(title);
      textCol.appendChild(meta);
      top.appendChild(textCol);
      row.appendChild(top);
      listEl.appendChild(row);
    });
  }

  function sync(snap) {
    renderList(snap);
    const note = snap.notes.find((n) => n.id === snap.selectedId) || null;
    if (!note) {
      lastEditorKey = { id: null, nonce: snap.editorNonce };
      showEmpty();
      paintModes();
      return;
    }
    showForm();
    fillTitle(note);
    remountEditor(snap);
    paintModes();
    setSaveStatus("");
  }

  titleInput.addEventListener("input", () => {
    setSaveStatus("Editing…");
    app.scheduleSave();
  });

  btnNew.addEventListener("click", () => app.onNewNote());

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".note-list__item");
    if (!btn || !btn.dataset.id) {
      return;
    }
    app.onSelectNote(btn.dataset.id);
  });

  btnDelete.addEventListener("click", () => app.onDeleteNote());
  if (btnLock) {
    btnLock.addEventListener("click", () => app.onLock());
  }

  return {
    sync,
    setSaveStatus,
    getTitleValue,
    collectEditor,
    resizeBody: () => {},
    refreshModes: paintModes,
  };
}
