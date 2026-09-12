/**
 * Whether a receipt photo is sharp enough to read (#49), checked in the
 * browser before it is uploaded, so a shaky photo can be taken again while
 * the receipt is still in hand.
 *
 * The measure is the variance of the Laplacian — how strongly brightness
 * changes from one pixel to the next — in the sharpest tenth of the photo.
 * Only the sharpest part counts, because a receipt photo is mostly blank
 * paper and table: the print is what has to be in focus.
 */

/** Below this, a photo is called blurry. Deliberately low: a false alarm costs a tap, a miss costs a misread total. */
export const BLURRY_BELOW = 40;

/** The longest side the photo is scaled to before measuring, so every camera is judged alike. */
export const MEASURE_SIDE = 1000;

const GRID = 8;

/** Sharpness of a greyscale image (one byte per pixel, row by row). */
export function sharpnessScore(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const tileW = Math.max(3, Math.floor(width / GRID));
  const tileH = Math.max(3, Math.floor(height / GRID));
  const variances: number[] = [];

  for (let ty = 0; ty < height; ty += tileH) {
    for (let tx = 0; tx < width; tx += tileW) {
      let n = 0;
      let sum = 0;
      let sumSq = 0;
      const yEnd = Math.min(height - 1, ty + tileH);
      const xEnd = Math.min(width - 1, tx + tileW);
      for (let y = Math.max(1, ty); y < yEnd; y++) {
        const row = y * width;
        for (let x = Math.max(1, tx); x < xEnd; x++) {
          const i = row + x;
          const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
          sum += lap;
          sumSq += lap * lap;
          n++;
        }
      }
      if (n > 0) {
        const mean = sum / n;
        variances.push(sumSq / n - mean * mean);
      }
    }
  }
  if (variances.length === 0) return 0;
  variances.sort((a, b) => a - b);
  return variances[Math.min(variances.length - 1, Math.floor(variances.length * 0.9))];
}

/**
 * How sharp a photo is, or null when it isn't an image this browser can draw
 * (a PDF, an email) — those are never called blurry.
 */
export async function measureSharpness(file: Blob): Promise<number | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MEASURE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(3, Math.round(bitmap.width * scale));
    const height = Math.max(3, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return sharpnessScore(gray, width, height);
  } catch {
    return null;
  }
}
