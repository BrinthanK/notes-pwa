import { NOTE_TYPES } from "./model.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined && text !== null) {
    node.textContent = text;
  }
  return node;
}

export function renderModeButtons(container, activeType, onPick) {
  container.replaceChildren();
  const bar = el("div", "mode-bar");
  NOTE_TYPES.forEach((t) => {
    const btn = el("button", "mode-bar__btn", t);
    btn.type = "button";
    btn.dataset.mode = t;
    if (t === activeType) {
      btn.classList.add("mode-bar__btn--active");
    }
    btn.addEventListener("click", () => onPick(t));
    bar.appendChild(btn);
  });
  container.appendChild(bar);
}

export function mountEditor(root, note, bridge) {
  root.replaceChildren();
  if (!note) {
    return { collect: () => ({}) };
  }
  if (note.type === "note") {
    return mountNote(root, note, bridge);
  }
  if (note.type === "todo") {
    return mountTodo(root, note, bridge);
  }
  if (note.type === "audio") {
    return mountAudio(root, note, bridge);
  }
  if (note.type === "image") {
    return mountImage(root, note, bridge);
  }
  return { collect: () => ({}) };
}

function mountNote(root, note, bridge) {
  const ta = el("textarea", "editor__body");
  ta.value = note.content || "";
  ta.placeholder = "Start typing…";
  ta.addEventListener("input", () => {
    bridge.scheduleSave();
  });
  root.appendChild(ta);
  requestAnimationFrame(() => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(200, ta.scrollHeight)}px`;
  });
  return {
    collect: () => ({ content: ta.value }),
  };
}

function mountTodo(root, note, bridge) {
  const wrap = el("div", "todo-editor");
  const list = el("div", "todo-list");
  let items = Array.isArray(note.data.items)
    ? note.data.items.map((it) => ({ text: it.text || "", done: !!it.done }))
    : [];

  function renderItems() {
    list.replaceChildren();
    items.forEach((item, index) => {
      const row = el("div", "todo-row");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.done;
      cb.addEventListener("change", () => {
        items[index] = { ...items[index], done: cb.checked };
        bridge.scheduleSave();
      });
      const inp = el("input", "todo-row__text");
      inp.type = "text";
      inp.value = item.text || "";
      inp.placeholder = "Task";
      inp.addEventListener("input", () => {
        items[index] = { ...items[index], text: inp.value };
        bridge.scheduleSave();
      });
      const rm = el("button", "btn btn--small", "×");
      rm.type = "button";
      rm.addEventListener("click", () => {
        items = items.filter((_, i) => i !== index);
        bridge.scheduleSave();
        renderItems();
      });
      row.appendChild(cb);
      row.appendChild(inp);
      row.appendChild(rm);
      list.appendChild(row);
    });
  }

  renderItems();

  const addBtn = el("button", "btn btn--primary", "Add item");
  addBtn.type = "button";
  addBtn.addEventListener("click", () => {
    items = items.concat([{ text: "", done: false }]);
    bridge.scheduleSave();
    renderItems();
  });

  wrap.appendChild(list);
  wrap.appendChild(addBtn);
  root.appendChild(wrap);

  return {
    collect: () => ({
      data: { items: items.map((x) => ({ text: x.text, done: x.done })) },
      content: "",
    }),
  };
}

function mountAudio(root, note, bridge) {
  const wrap = el("div", "media-editor");
  const hint = el(
    "p",
    "media-editor__hint",
    "Recording uses your microphone (use the buttons below — required on iOS)."
  );
  const controls = el("div", "media-editor__controls");
  const btnStart = el("button", "btn btn--primary", "Record");
  btnStart.type = "button";
  const btnStop = el("button", "btn", "Stop");
  btnStop.type = "button";
  btnStop.disabled = true;
  btnStart.addEventListener("click", () => {
    bridge.onAudioStart();
    btnStop.disabled = false;
    btnStart.disabled = true;
  });
  btnStop.addEventListener("click", () => {
    bridge.onAudioStop();
    btnStop.disabled = true;
    btnStart.disabled = false;
  });
  controls.appendChild(btnStart);
  controls.appendChild(btnStop);

  const audioWrap = el("div", "audio-wrap");
  if (!note.data || !note.data.audioBlobId) {
    audioWrap.appendChild(el("p", "muted", "No audio stored yet."));
  } else {
    bridge.attachAudioElement(audioWrap, note.data.audioBlobId);
  }

  wrap.appendChild(hint);
  wrap.appendChild(controls);
  wrap.appendChild(audioWrap);
  root.appendChild(wrap);

  return {
    collect: () => ({}),
  };
}

function mountImage(root, note, bridge) {
  const wrap = el("div", "media-editor");
  const hint = el(
    "p",
    "media-editor__hint",
    "Camera and photo library require a direct tap (especially on iPhone)."
  );
  const controls = el("div", "media-editor__controls");
  const btnCam = el("button", "btn btn--primary", "Use camera");
  btnCam.type = "button";
  const fileLabel = el("label", "btn");
  fileLabel.textContent = "Choose / take photo";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.setAttribute("capture", "environment");
  file.className = "visually-hidden";
  file.addEventListener("change", () => {
    bridge.onImagePicked(file.files);
    file.value = "";
  });
  fileLabel.appendChild(file);
  btnCam.addEventListener("click", () => {
    bridge.onImageCamera();
  });
  controls.appendChild(btnCam);
  controls.appendChild(fileLabel);

  const preview = el("div", "image-preview");
  if (!note.data || !note.data.imageBlobId) {
    preview.appendChild(el("p", "muted", "No image yet."));
  } else {
    bridge.attachImageThumbnail(preview, note.data.thumbBlobId || note.data.imageBlobId);
  }

  const fullHost = el("div", "image-full-host");
  fullHost.appendChild(el("p", "muted", "Large images load on demand."));
  if (note.data && note.data.imageBlobId) {
    const btnShow = el("button", "btn", "Load full image");
    btnShow.type = "button";
    btnShow.addEventListener("click", () => {
      bridge.onImageLoadFull(fullHost, note);
    });
    fullHost.appendChild(btnShow);
  }

  wrap.appendChild(hint);
  wrap.appendChild(controls);
  wrap.appendChild(preview);
  wrap.appendChild(fullHost);
  root.appendChild(wrap);

  return {
    collect: () => ({}),
  };
}
