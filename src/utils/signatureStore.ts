/**
 * Signature helpers: localStorage persistence plus the canvas work that turns a
 * photographed or drawn signature into a tight, transparent PNG.
 */

const STORAGE_KEY = 'pdfash.signatures';
const MAX_SAVED = 5;

export function loadSavedSignatures(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    // Private mode, blocked site data, or corrupt JSON — start clean.
    return [];
  }
}

function persist(list: string[]): string[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota or blocked storage: the signature still works for this session.
  }
  return list;
}

/** Prepend, de-duplicate and cap. Returns the new list. */
export function saveSignature(dataUrl: string): string[] {
  const next = [dataUrl, ...loadSavedSignatures().filter((s) => s !== dataUrl)].slice(
    0,
    MAX_SAVED
  );
  return persist(next);
}

export function deleteSavedSignature(index: number): string[] {
  return persist(loadSavedSignatures().filter((_, i) => i !== index));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * Knock the paper out of a scanned/photographed signature: pixels brighter than
 * a threshold become transparent, and the ones just below it fade out so the
 * stroke keeps a soft edge instead of turning into jagged aliasing.
 */
export async function whiteToTransparent(
  dataUrl: string,
  threshold = 200
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const soft = 60; // width of the fade band below the threshold
  for (let i = 0; i < d.length; i += 4) {
    const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (luma >= threshold) {
      d[i + 3] = 0;
    } else if (luma > threshold - soft) {
      d[i + 3] = Math.round(d[i + 3] * ((threshold - luma) / soft));
    }
  }
  ctx.putImageData(image, 0, 0);
  return trimTransparent(canvas) ?? canvas.toDataURL('image/png');
}

/**
 * Crop a canvas to its non-transparent content and return a PNG data URL,
 * or null when the canvas is entirely empty.
 */
export function trimTransparent(source: HTMLCanvasElement, padding = 6): string | null {
  const ctx = source.getContext('2d')!;
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out
    .getContext('2d')!
    .drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
