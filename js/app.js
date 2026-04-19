import { deriveKey } from "./crypto.js";
import {
  initDB,
  hasSalt,
  getSalt,
  setSalt,
  getAllNotes,
  saveNote,
  deleteNote,
  saveEncryptedBlob,
  getEncryptedBlob,
  deleteEncryptedBlob,
  writeVaultVerifier,
  verifyVaultKey,
} from "./db.js";
import { migrateV1RowsToVault, loadLegacyPendingRows } from "./migrate.js";
import { createEmptyNote, normalizeNoteShape } from "./model.js";
import {
  subscribe,
  getSnapshot,
  setNotes,
  upsertNoteInState,
  removeNoteFromState,
  selectNote,
  bumpEditorNonce,
} from "./state.js";
import { setSessionKey, clearSessionKey, getSessionKey } from "./session.js";
import { createAuthUi, createAppUi } from "./ui.js";
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
  const salted = await hasSalt();

  const run = {};
  let vaultUnsub = null;

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
    onLock: () => run.onLock(),
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

  if (!ui) {
    ui = createAppUi({
      noteList: document.getElementById("note-list"),
      editorEmpty: document.getElementById("editor-empty"),
      editorForm: document.getElementById("editor-form"),
      editorRoot: document.getElementById("editor-root"),
      noteTitle: document.getElementById("note-title"),
      saveStatus: document.getElementById("save-status"),
      btnNew: document.getElementById("btn-new"),
      btnDelete: document.getElementById("btn-delete"),
      btnLock: document.getElementById("btn-lock"),
      modeBar: document.getElementById("creation-modes"),
      app: appApi,
    });
  }

  const auth = createAuthUi({
    screen: document.getElementById("auth-screen"),
    setup: document.getElementById("auth-setup"),
    unlock: document.getElementById("auth-unlock"),
    err: document.getElementById("auth-error"),
    pass: document.getElementById("setup-pass"),
    pass2: document.getElementById("setup-pass2"),
    setupBtn: document.getElementById("setup-btn"),
    unlockBtn: document.getElementById("unlock-btn"),
    saltExists: salted,
  });

  auth.show();

  document.getElementById("setup-btn").addEventListener("click", async () => {
    auth.setError("");
    const p = document.getElementById("setup-pass").value;
    const p2 = document.getElementById("setup-pass2").value;
    if (!p || p.length < 8) {
      auth.setError("Use at least 8 characters.");
      return;
    }
    if (p !== p2) {
      auth.setError("Passwords do not match.");
      return;
    }
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await setSalt(salt);
      const key = await deriveKey(p, salt);
      await writeVaultVerifier(key);
      document.getElementById("setup-pass").value = "";
      document.getElementById("setup-pass2").value = "";
      auth.hide();
      await startVault(key);
    } catch (e) {
      auth.setError("Could not create vault.");
      console.error(e);
    }
  });

  document.getElementById("unlock-btn").addEventListener("click", async () => {
    auth.setError("");
    const pass = document.getElementById("unlock-pass").value;
    if (!pass) {
      auth.setError("Enter your password.");
      return;
    }
    try {
      const salt = await getSalt();
      if (!salt) {
        auth.setError("Missing salt.");
        return;
      }
      const key = await deriveKey(pass, salt);
      const okVerify = await verifyVaultKey(key);
      if (!okVerify) {
        auth.setError("Wrong password.");
        return;
      }
      await getAllNotes(key);
      document.getElementById("unlock-pass").value = "";
      auth.hide();
      await startVault(key);
    } catch (e) {
      auth.setError("Wrong password or corrupted data.");
      console.warn(e);
    }
  });

  async function startVault(key) {
    setSessionKey(key);

    const legacyRows = await loadLegacyPendingRows();
    if (legacyRows.length > 0) {
      await migrateV1RowsToVault(key, legacyRows);
    }

    const rows = await getAllNotes(key);
    setNotes(rows);
    if (rows.length > 0) {
      selectNote(rows[0].id);
    } else {
      selectNote(null);
    }

    document.getElementById("workspace").hidden = false;

    async function persistCurrent() {
      const sessionKey = getSessionKey();
      const current = getSelectedNote();
      if (!sessionKey || !current || !ui) {
        return;
      }
      const partial = ui.collectEditor();
      const merged = mergePayload(current, partial, ui.getTitleValue());
      try {
        await saveNote(sessionKey, merged);
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
      const sessionKey = getSessionKey();
      const note = createEmptyNote(creationMode, id);
      await saveNote(sessionKey, note);
      upsertNoteInState(note);
      selectNote(note.id);
    }

    async function onSelectNote(noteId) {
      await flushSave();
      selectNote(noteId);
    }

    async function onDeleteNote() {
      const sessionKey = getSessionKey();
      const current = getSelectedNote();
      if (!sessionKey || !current) {
        return;
      }
      const ok = window.confirm("Delete this entry?");
      if (!ok) {
        return;
      }
      try {
        scheduleSave.cancel();
        await deleteNote(sessionKey, current.id);
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

    function onLock() {
      scheduleSave.cancel();
      clearSessionKey();
      if (vaultUnsub) {
        vaultUnsub();
        vaultUnsub = null;
      }
      document.getElementById("workspace").hidden = true;
      auth.show();
      setNotes([]);
      selectNote(null);
      objectUrls.revokeAll();
    }

    function attachAudioElement(wrap, blobId) {
      const sessionKey = getSessionKey();
      if (!sessionKey) {
        return;
      }
      getEncryptedBlob(sessionKey, blobId).then((blob) => {
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
      const sessionKey = getSessionKey();
      const cur = getSelectedNote();
      if (!sessionKey || !cur || cur.type !== "audio") {
        return;
      }
      const bid = await saveEncryptedBlob(sessionKey, blob);
      const prevId = cur.data && cur.data.audioBlobId;
      const merged = mergePayload(
        cur,
        { data: { audioBlobId: bid } },
        ui.getTitleValue()
      );
      await saveNote(sessionKey, merged);
      upsertNoteInState(merged);
      if (prevId && prevId !== bid) {
        await deleteEncryptedBlob(prevId).catch(() => {});
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
      const sessionKey = getSessionKey();
      const cur = getSelectedNote();
      if (!sessionKey || !cur || cur.type !== "image") {
        return;
      }
      const thumbBlob =
        (await blobToThumbnailBlob(blob, 160).catch(() => blob)) || blob;
      const imgId = await saveEncryptedBlob(sessionKey, blob);
      const thumbId = await saveEncryptedBlob(sessionKey, thumbBlob);
      const prev = cur.data || {};
      const prevImg = prev.imageBlobId;
      const prevThumb = prev.thumbBlobId;
      const merged = mergePayload(
        cur,
        { data: { imageBlobId: imgId, thumbBlobId: thumbId } },
        ui.getTitleValue()
      );
      await saveNote(sessionKey, merged);
      upsertNoteInState(merged);
      if (prevImg && prevImg !== imgId) {
        await deleteEncryptedBlob(prevImg).catch(() => {});
      }
      if (prevThumb && prevThumb !== thumbId) {
        await deleteEncryptedBlob(prevThumb).catch(() => {});
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
        const blob = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
        );
        if (blob) {
          await finalizeImage(blob);
        }
      } catch (err) {
        console.error(err);
        alert("Camera permission or hardware is unavailable.");
      }
    }

    function attachImageThumbnail(container, blobId) {
      const sessionKey = getSessionKey();
      if (!sessionKey) {
        return;
      }
      getEncryptedBlob(sessionKey, blobId).then((blob) => {
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
      const sessionKey = getSessionKey();
      const blobId = note.data && note.data.imageBlobId;
      if (!sessionKey || !blobId) {
        return;
      }
      getEncryptedBlob(sessionKey, blobId).then((blob) => {
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
      const sessionKey = getSessionKey();
      if (!sessionKey || !blobId) {
        return null;
      }
      const blob = await getEncryptedBlob(sessionKey, blobId);
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
      onLock,
      attachAudioElement,
      onAudioStart,
      onAudioStop,
      onImagePicked,
      onImageCamera,
      attachImageThumbnail,
      onImageLoadFull,
      loadListThumb,
    });

    if (vaultUnsub) {
      vaultUnsub();
      vaultUnsub = null;
    }
    vaultUnsub = subscribe((snap) => ui.sync(snap));
    ui.sync(getSnapshot());
  }
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
