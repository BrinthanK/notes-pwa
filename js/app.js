import {
  initDB,
  getAllNotes,
  saveNote,
  deleteNote,
  saveBlob,
  getBlob,
  deleteBlob,
} from "./db.js";
import { createEmptyNote, normalizeNoteShape } from "./model.js";
import {
  subscribe,
  getSnapshot,
  setNotes,
  upsertNoteInState,
  removeNoteFromState,
  selectNote,
  bumpEditorNonce,
  getSelectedNote,
} from "./state.js";
import { createAppUi } from "./ui.js";
import { debounce, id, blobToThumbnailBlob } from "./utils.js";

const SAVE_DEBOUNCE_MS = 420;

let creationMode = "note";
let ui = null;
let scheduleSave = null;

function createObjectUrlRegistry() {
  const set = new Set();
  return {
    add(url) {
      set.add(url);
      return url;
    },
    revokeAll() {
      set.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      });
      set.clear();
    },
  };
}

const objectUrls = createObjectUrlRegistry();

let mediaRecorder = null;
let mediaChunks = [];
let mediaStream = null;

function mergePayload(current, partial, titleText) {
  const title = typeof titleText === "string" ? titleText : current.title || "";
  const mergedData = {
    ...(current.data || {}),
    ...((partial && partial.data) || {}),
  };
  let content = current.content || "";
  if (partial && Object.prototype.hasOwnProperty.call(partial, "content")) {
    content = partial.content;
  }
  return normalizeNoteShape({
    ...current,
    title,
    content,
    data: mergedData,
    updatedAt: Date.now(),
  });
}

async function bootstrap() {
  await initDB();

  const run = {};

  const appApi = {
    scheduleSave: () => {
      if (scheduleSave) {
        scheduleSave();
      }
    },
    getCreationMode: () => creationMode,
    pickCreationMode: (m) => {
      creationMode = m;
      if (ui) {
        ui.refreshModes();
      }
    },
    onNewNote: () => run.onNewNote(),
    onSelectNote: (noteId) => run.onSelectNote(noteId),
    onDeleteNote: () => run.onDeleteNote(),
    revokeObjectUrls: () => objectUrls.revokeAll(),
    loadListThumb: (blobId) => run.loadListThumb(blobId),
    attachAudioElement: (wrap, blobId) => run.attachAudioElement(wrap, blobId),
    onAudioStart: () => run.onAudioStart(),
    onAudioStop: () => run.onAudioStop(),
    onImagePicked: (files) => run.onImagePicked(files),
    onImageCamera: () => run.onImageCamera(),
    attachImageThumbnail: (container, blobId) =>
      run.attachImageThumbnail(container, blobId),
    onImageLoadFull: (host, note) => run.onImageLoadFull(host, note),
  };

  ui = createAppUi({
    noteList: document.getElementById("note-list"),
    editorEmpty: document.getElementById("editor-empty"),
    editorForm: document.getElementById("editor-form"),
    editorRoot: document.getElementById("editor-root"),
    noteTitle: document.getElementById("note-title"),
    saveStatus: document.getElementById("save-status"),
    btnNew: document.getElementById("btn-new"),
    btnDelete: document.getElementById("btn-delete"),
    btnLock: null,
    modeBar: document.getElementById("creation-modes"),
    app: appApi,
  });

  async function persistCurrent() {
    const current = getSelectedNote();
    if (!current || !ui) {
      return;
    }
    const partial = ui.collectEditor();
    const merged = mergePayload(current, partial, ui.getTitleValue());
    try {
      await saveNote(merged);
      upsertNoteInState(merged);
      ui.setSaveStatus("Saved");
    } catch (e) {
      ui.setSaveStatus("Save failed");
      console.error(e);
    }
  }

  scheduleSave = debounce(() => {
    persistCurrent().catch((err) => console.error(err));
  }, SAVE_DEBOUNCE_MS);

  async function flushSave() {
    scheduleSave.cancel();
    await persistCurrent();
  }

  async function onNewNote() {
    await flushSave();
    const note = createEmptyNote(creationMode, id);
    await saveNote(note);
    upsertNoteInState(note);
    selectNote(note.id);
  }

  async function onSelectNote(noteId) {
    await flushSave();
    selectNote(noteId);
  }

  async function onDeleteNote() {
    const current = getSelectedNote();
    if (!current) {
      return;
    }
    const ok = window.confirm("Delete this entry?");
    if (!ok) {
      return;
    }
    try {
      scheduleSave.cancel();
      await deleteNote(current.id);
      removeNoteFromState(current.id);
      const snap = getSnapshot();
      if (snap.notes.length > 0) {
        selectNote(snap.notes[0].id);
      } else {
        selectNote(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function attachAudioElement(wrap, blobId) {
    getBlob(blobId).then((blob) => {
      if (!blob) {
        return;
      }
      const url = objectUrls.add(URL.createObjectURL(blob));
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      audio.className = "audio-element";
      wrap.replaceChildren(audio);
    });
  }

  async function finalizeAudio(blob) {
    const cur = getSelectedNote();
    if (!cur || cur.type !== "audio") {
      return;
    }
    const bid = await saveBlob(blob);
    const prevId = cur.data && cur.data.audioBlobId;
    const merged = mergePayload(
      cur,
      { data: { audioBlobId: bid } },
      ui.getTitleValue()
    );
    await saveNote(merged);
    upsertNoteInState(merged);
    if (prevId && prevId !== bid) {
      await deleteBlob(prevId).catch(() => {});
    }
    bumpEditorNonce();
  }

  async function onAudioStart() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          mediaChunks.push(e.data);
        }
      };
      mediaRecorder.onstop = async () => {
        try {
          if (mediaStream) {
            mediaStream.getTracks().forEach((t) => t.stop());
          }
          mediaStream = null;
          mediaRecorder = null;
          const blob = new Blob(mediaChunks, {
            type: mediaChunks[0] ? mediaChunks[0].type : "audio/webm",
          });
          mediaChunks = [];
          await finalizeAudio(blob);
        } catch (err) {
          console.error(err);
        }
      };
      mediaRecorder.start();
    } catch (err) {
      console.error(err);
      alert("Microphone permission is required for recording.");
    }
  }

  function onAudioStop() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }

  async function finalizeImage(blob) {
    const cur = getSelectedNote();
    if (!cur || cur.type !== "image") {
      return;
    }
    const thumbBlob =
      (await blobToThumbnailBlob(blob, 160).catch(() => blob)) || blob;
    const imgId = await saveBlob(blob);
    const thumbId = await saveBlob(thumbBlob);
    const prev = cur.data || {};
    const prevImg = prev.imageBlobId;
    const prevThumb = prev.thumbBlobId;
    const merged = mergePayload(
      cur,
      { data: { imageBlobId: imgId, thumbBlobId: thumbId } },
      ui.getTitleValue()
    );
    await saveNote(merged);
    upsertNoteInState(merged);
    if (prevImg && prevImg !== imgId) {
      await deleteBlob(prevImg).catch(() => {});
    }
    if (prevThumb && prevThumb !== thumbId) {
      await deleteBlob(prevThumb).catch(() => {});
    }
    bumpEditorNonce();
  }

  async function onImagePicked(files) {
    const f = files && files[0];
    if (!f) {
      return;
    }
    await finalizeImage(f);
  }

  async function onImageCamera() {
    const video = document.getElementById("camera-video");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.hidden = false;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        throw new Error("Camera not ready");
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.hidden = true;
      const imageBlob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
      );
      if (imageBlob) {
        await finalizeImage(imageBlob);
      }
    } catch (err) {
      console.error(err);
      alert("Camera permission or hardware is unavailable.");
    }
  }

  function attachImageThumbnail(container, blobId) {
    getBlob(blobId).then((blob) => {
      if (!blob) {
        return;
      }
      const url = objectUrls.add(URL.createObjectURL(blob));
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Preview";
      img.className = "image-thumb";
      container.replaceChildren(img);
    });
  }

  function onImageLoadFull(host, note) {
    const blobId = note.data && note.data.imageBlobId;
    if (!blobId) {
      return;
    }
    getBlob(blobId).then((blob) => {
      if (!blob) {
        return;
      }
      const url = objectUrls.add(URL.createObjectURL(blob));
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Full image";
      img.className = "image-full";
      host.replaceChildren(img);
    });
  }

  async function loadListThumb(blobId) {
    if (!blobId) {
      return null;
    }
    const blob = await getBlob(blobId);
    if (!blob) {
      return null;
    }
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }

  Object.assign(run, {
    onNewNote,
    onSelectNote,
    onDeleteNote,
    attachAudioElement,
    onAudioStart,
    onAudioStop,
    onImagePicked,
    onImageCamera,
    attachImageThumbnail,
    onImageLoadFull,
    loadListThumb,
  });

  const rows = await getAllNotes();
  setNotes(rows);
  if (rows.length > 0) {
    selectNote(rows[0].id);
  } else {
    selectNote(null);
  }

  subscribe((snap) => ui.sync(snap));
  ui.sync(getSnapshot());
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

bootstrap().catch((e) => {
  console.error(e);
});

registerServiceWorker();
