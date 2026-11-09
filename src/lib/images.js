/* Photo resizing in the browser, so uploads are small and the Inventory
   photo tiles load quickly (a phone photo is ~2.5 MB; a tile needs ~40 KB). */

/* Width/height scaled down to fit within `max` px on the longest side,
   never scaled up. */
export function fitWithin(width, height, max) {
  const longest = Math.max(width, height);
  if (!longest || longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/* The small copy of a photo used on Inventory tiles sits next to it in
   storage: photos/GC-01/123.jpg -> photos/GC-01/123-thumb.jpg */
export function thumbPathOf(path) {
  if (!path) return null;
  return path.replace(/(\.[^./]+)?$/, "-thumb.jpg");
}

/* Resizes an image (File or Blob) to fit within `max` px and re-encodes it
   as JPEG. Honours the photo's orientation (phones store it as metadata).
   Browser only. */
export async function resizeImage(blob, max, quality = 0.82) {
  let source, width, height;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(blob, { imageOrientation: "from-image" });
    width = source.width; height = source.height;
  } else {
    const url = URL.createObjectURL(blob);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    width = source.naturalWidth; height = source.naturalHeight;
  }
  const size = fitWithin(width, height, max);
  const canvas = document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background rather than black
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(source, 0, 0, size.width, size.height);
  if (source.close) source.close();
  return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the photo"))), "image/jpeg", quality));
}
