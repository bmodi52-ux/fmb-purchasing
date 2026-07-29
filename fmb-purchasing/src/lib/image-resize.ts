/**
 * Shrinks receipt photos in the browser before they are uploaded.
 *
 * A phone camera produces 3-5MB at 4000px wide. That exceeds the Server
 * Action body limit outright, and even under it, sending the full image
 * across the Pacific is slow for no benefit: the receipt is read by an OCR
 * model that gains nothing from more than about 2000px on the long edge.
 *
 * Resizing here rather than raising the limit means the common case stays
 * far below any ceiling, on whatever the host allows.
 */

/** Long edge, in pixels, kept after resizing. Comfortably legible for OCR. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

/** Below this, resizing costs more than it saves. */
const SKIP_BELOW_BYTES = 600 * 1024;

export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Returns a smaller JPEG for large images, or the original file untouched for
 * PDFs, small images, and anything that fails to decode — never throws, since
 * a failure here should fall back to trying the upload rather than blocking it.
 */
export async function shrinkImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    // Already small enough in dimensions; re-encoding would only lose quality
    if (scale === 1 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
