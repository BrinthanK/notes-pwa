export function debounce(fn, ms) {
  let t = null;
  function cancel() {
    if (t !== null) {
      clearTimeout(t);
      t = null;
    }
  }
  function debounced(...args) {
    cancel();
    t = setTimeout(() => {
      t = null;
      fn.apply(this, args);
    }, ms);
  }
  debounced.cancel = cancel;
  return debounced;
}

export function id() {
  return crypto.randomUUID();
}

export async function blobToThumbnailBlob(blob, maxEdge) {
  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxEdge / maxSide);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const thumb = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
    });
    bitmap.close();
    return thumb;
  } catch {
    return blob;
  }
}
