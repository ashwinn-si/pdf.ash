import {
  PDFDocument,
  StandardFonts,
  degrees,
  EncryptedPDFError,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { zipSync, type Zippable } from 'fflate';
import type { PageInfo } from './pdfRenderer';
import { openPdf } from './pdfjs';
import { stampAnnotations, type FontResolver } from './annotationStamp';
import type { TextFont } from './annotations';
import { readJpegOrientation } from './exifOrientation';
import { decryptPdfBytes, repairPdfBytes, encryptPdfBytes, QpdfError } from './qpdf';
import { isChunkLoadError, CHUNK_LOAD_MESSAGE } from './lazyModule';

const STANDARD_FONTS: Record<TextFont, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // [regular, bold, italic, bold-italic]
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

/**
 * One resolver per output document, embedding each base-14 variant at most
 * once however many annotations ask for it.
 */
function makeFontResolver(doc: PDFDocument): FontResolver {
  const cache = new Map<string, PDFFont>();
  return async (font, bold, italic) => {
    const key = `${font}:${bold ? 'b' : ''}${italic ? 'i' : ''}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const variants = STANDARD_FONTS[font] ?? STANDARD_FONTS.helvetica;
    const embedded = await doc.embedFont(variants[(bold ? 1 : 0) + (italic ? 2 : 0)]);
    cache.set(key, embedded);
    return embedded;
  };
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

/**
 * Identify a file by its actual bytes rather than its name or MIME type.
 * Both are unreliable: a PNG saved with a `.jpg` extension (common with
 * "save image as" from a browser) reports as JPEG by name, and Windows drags
 * often report an empty `type` altogether (#3, #4).
 */
export async function sniffFileKind(file: Blob): Promise<'pdf' | 'png' | 'jpeg' | 'webp' | 'unknown'> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());

  // "%PDF-" is conventionally at offset 0, but some tools prepend a few
  // junk/whitespace bytes, so search the whole header instead of anchoring.
  const pdfMarker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  search: for (let i = 0; i <= head.length - pdfMarker.length; i++) {
    for (let j = 0; j < pdfMarker.length; j++) {
      if (head[i + j] !== pdfMarker[j]) continue search;
    }
    return 'pdf';
  }

  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'png';
  }

  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'jpeg';
  }

  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 && // "RIFF"
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50 // "WEBP"
  ) {
    return 'webp';
  }

  return 'unknown';
}

/** Extensions this app accepts for upload, shared by the file-type checks
 * below and the `<input accept>`/drop-zone hint text. */
export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.pjpeg',
  '.pjp',
  '.png',
  '.webp',
  '.md',
  '.markdown',
];

/** For an `<input type="file" accept="...">` attribute. */
export const ACCEPT_ATTRIBUTE = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/markdown',
  ...ACCEPTED_EXTENSIONS,
].join(',');

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp', '.png', '.webp'];
const MARKDOWN_MIMES = ['text/markdown', 'text/x-markdown'];
const MARKDOWN_EXTS = ['.md', '.markdown'];

/**
 * Check if a file is a valid PDF, image, or Markdown file by MIME type or
 * extension fallback. Extension is always checked regardless of the reported
 * type — not just when it's empty — because .md files in particular get
 * reported with inconsistent or missing MIME types across browsers/OSes
 * (and on Windows, dragged files of any kind often have an empty type).
 */
export function isValidFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    isPdfFile(file) ||
    IMAGE_MIMES.includes(file.type) ||
    MARKDOWN_MIMES.includes(file.type) ||
    ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

/**
 * Check if a file should be treated as an image (not a PDF).
 */
export function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return IMAGE_MIMES.includes(file.type) || IMAGE_EXTS.some((ext) => name.endsWith(ext));
}

/**
 * Check if a file should be treated as Markdown (not a PDF).
 */
export function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return MARKDOWN_MIMES.includes(file.type) || MARKDOWN_EXTS.some((ext) => name.endsWith(ext));
}

/** Check if a file is (or claims to be) a PDF, by MIME or extension. */
export function isPdfFile(file: File): boolean {
  return file.type.toLowerCase() === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// ---------------------------------------------------------------------------
// Image → PDF
// ---------------------------------------------------------------------------

/**
 * Decode `file` through the browser and re-encode it as a PNG. Used for
 * anything pdf-lib can't embed directly (WebP, an unrecognised format) and
 * for mirrored JPEG orientations, which — unlike a plain rotation — can't be
 * expressed as a page `/Rotate` and have to be baked into the pixels.
 */
async function embedReencoded(pdfDoc: PDFDocument, file: Blob): Promise<PDFImage> {
  // 'from-image' applies the source's own EXIF orientation (if any) during
  // decode, so the canvas — and therefore the re-encoded PNG — comes out
  // upright with no separate /Rotate needed afterwards.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not re-encode image as PNG');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    return pdfDoc.embedPng(pngBytes);
  } finally {
    bitmap.close();
  }
}

/** EXIF orientation values that mirror the image; these can't be undone with
 * a page `/Rotate` alone and need a re-encode through canvas instead. */
const MIRRORED_ORIENTATIONS = new Set([2, 4, 5, 7]);

/**
 * Convert an image file into a single-page PDF ArrayBuffer.
 *
 * The embedder is chosen from the file's actual bytes (`sniffFileKind`), not
 * its name or MIME type, so a PNG saved with a `.jpg` extension still embeds
 * correctly instead of throwing "SOI not found in JPEG" (#3). A JPEG's EXIF
 * orientation is read and applied — a plain rotation (3/6/8) is expressed
 * losslessly as the page's `/Rotate`, matching how the rest of the app
 * already treats rotation (see `effectiveRotation`); a mirrored orientation
 * (2/4/5/7) has to be baked in via canvas since PDF pages have no mirror
 * transform (#11).
 */
export async function imageToPdfBuffer(imageFile: File): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();
  const kind = await sniffFileKind(imageFile);
  const imageBytes = new Uint8Array(await imageFile.arrayBuffer());

  let image: PDFImage;
  let rotationDegrees = 0;

  if (kind === 'png') {
    image = await pdfDoc.embedPng(imageBytes);
  } else if (kind === 'jpeg') {
    const orientation = readJpegOrientation(imageBytes);
    if (MIRRORED_ORIENTATIONS.has(orientation)) {
      image = await embedReencoded(pdfDoc, imageFile);
    } else {
      image = await pdfDoc.embedJpg(imageBytes);
      rotationDegrees = orientation === 3 ? 180 : orientation === 6 ? 90 : orientation === 8 ? 270 : 0;
    }
  } else {
    // WEBP or anything unrecognised: pdf-lib has no embedder for it, so
    // decode through the browser and re-encode as PNG.
    image = await embedReencoded(pdfDoc, imageFile);
  }

  // The page's MediaBox is always the image's own natural pixel size — a
  // `/Rotate` turns how the box is *displayed*, it doesn't resize the box
  // itself (see `displayedSize` in annotationStamp.ts for the same rule
  // applied on the read side).
  const { width, height } = image.scale(1);
  const page = pdfDoc.addPage([width, height]);
  if (rotationDegrees) page.setRotation(degrees(rotationDegrees));
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// File buffer store
// ---------------------------------------------------------------------------

/**
 * Stores the original file ArrayBuffers for later operations.
 */
const fileBuffers: Map<number, ArrayBuffer> = new Map();

export function storeFileBuffer(fileIndex: number, buffer: ArrayBuffer) {
  fileBuffers.set(fileIndex, buffer);
}

export function getFileBuffer(fileIndex: number): ArrayBuffer | undefined {
  return fileBuffers.get(fileIndex);
}

export function clearFileBuffers() {
  fileBuffers.clear();
}

/**
 * A page's on-screen rotation: the user's rotations stack on top of whatever
 * /Rotate the source page already carried (which is also how the thumbnails
 * render it — pdfjs honours /Rotate, then we CSS-rotate by `page.rotation`).
 */
export function effectiveRotation(intrinsic: number, userRotation: number): number {
  return (((intrinsic + userRotation) % 360) + 360) % 360;
}

/**
 * Load a stored buffer as an editable pdf-lib document, healing the two
 * failure modes pdf-lib refuses outright: an encrypted document — including
 * an owner-password-only "restricted" PDF that has no user password at all,
 * which pdf-lib still calls encrypted — and anything with a structurally
 * broken xref/object table. qpdf can fix both; the fixed bytes replace the
 * stored buffer so later operations on the same file (Compress, Convert, a
 * second Merge...) don't pay the repair cost again. One retry only — a
 * second failure means the file is genuinely unopenable and should propagate
 * (#8, #15 safety net).
 */
export async function loadForEdit(fileIndex: number): Promise<PDFDocument> {
  const buffer = fileBuffers.get(fileIndex);
  if (!buffer) throw new Error(`No buffer stored for file ${fileIndex}`);

  try {
    return await PDFDocument.load(buffer);
  } catch (err) {
    const fixed =
      err instanceof EncryptedPDFError
        ? await decryptPdfBytes(new Uint8Array(buffer), '')
        : await repairPdfBytes(new Uint8Array(buffer));
    const fixedBuffer = fixed.buffer.slice(
      fixed.byteOffset,
      fixed.byteOffset + fixed.byteLength
    ) as ArrayBuffer;
    storeFileBuffer(fileIndex, fixedBuffer);
    return await PDFDocument.load(fixedBuffer);
  }
}

/**
 * Render one stored page at `scale` with its rotation applied.
 * Returns the image plus the displayed page box in PDF points, which is the
 * coordinate space annotations are stored in.
 */
export async function renderPageImage(
  fileIndex: number,
  pageIndex: number,
  userRotation: number,
  scale: number = 1.5
): Promise<{ url: string; width: number; height: number; pointWidth: number; pointHeight: number }> {
  const buffer = fileBuffers.get(fileIndex);
  if (!buffer) throw new Error(`No buffer stored for file ${fileIndex}`);

  // Clone: pdf.js transfers (detaches) the ArrayBuffer it is handed.
  const doc = await openPdf(buffer.slice(0)).promise;
  try {
    const pdfPage = await doc.getPage(pageIndex + 1);

    const rotation = effectiveRotation(pdfPage.rotate, userRotation);
    const viewport = pdfPage.getViewport({ scale, rotation });
    const unscaled = pdfPage.getViewport({ scale: 1, rotation });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

    return {
      url: canvas.toDataURL('image/jpeg', 0.9),
      width: canvas.width,
      height: canvas.height,
      pointWidth: unscaled.width,
      pointHeight: unscaled.height,
    };
  } finally {
    doc.destroy();
  }
}

/**
 * Load every unique pdf.js document referenced by `pages`, keyed by
 * fileIndex. Shared by the raster-based operations (compress, convert),
 * which may draw several pages from the same source file.
 */
async function loadPdfJsDocsForPages(pages: PageInfo[]): Promise<Map<number, PDFDocumentProxy>> {
  const docs = new Map<number, PDFDocumentProxy>();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !docs.has(page.fileIndex)) {
      // Clone the buffer: pdf.js transfers (detaches) the ArrayBuffer it's
      // given to its worker, which would otherwise permanently zero out the
      // buffer kept in fileBuffers for later operations (merge/split/
      // compress/convert again).
      const doc = await openPdf(buffer.slice(0)).promise;
      docs.set(page.fileIndex, doc);
    }
  }
  return docs;
}

function destroyAll(docs: Map<number, PDFDocumentProxy>) {
  for (const doc of docs.values()) doc.destroy();
}

/**
 * Merge/rearrange/rotate/delete pages into a single PDF.
 * Uses the pages array in its current order, applying rotations.
 */
export async function buildPdf(
  pages: PageInfo[],
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const outputPdf = await PDFDocument.create();
  const loadedPdfs: Map<number, PDFDocument> = new Map();
  let fontFor: FontResolver | undefined;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!fileBuffers.has(page.fileIndex)) continue;

    if (!loadedPdfs.has(page.fileIndex)) {
      loadedPdfs.set(page.fileIndex, await loadForEdit(page.fileIndex));
    }

    const sourcePdf = loadedPdfs.get(page.fileIndex)!;
    const [copiedPage] = await outputPdf.copyPages(sourcePdf, [page.pageIndex]);

    if (page.rotation !== 0) {
      // Stack on the source page's own /Rotate, matching what the thumbnails show.
      copiedPage.setRotation(
        degrees(effectiveRotation(copiedPage.getRotation().angle, page.rotation))
      );
    }

    outputPdf.addPage(copiedPage);

    if (page.annotations && page.annotations.length > 0) {
      if (!fontFor) fontFor = makeFontResolver(outputPdf);
      await stampAnnotations(outputPdf, copiedPage, page.annotations, fontFor);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }
  }

  return outputPdf.save();
}

/**
 * Build one PDF containing exactly `pages`, in the given order, with
 * rotations and annotations applied — i.e. "Extract selected pages" is just
 * a merge/rearrange over whatever subset the caller passes in, so it reuses
 * `buildPdf` outright rather than duplicating its page-copying loop.
 */
export async function extractPages(
  pages: PageInfo[],
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  return buildPdf(pages, onProgress);
}

/**
 * Split a PDF into multiple PDFs based on page ranges.
 * Returns array of { name, data } objects.
 */
export async function splitPdf(
  pages: PageInfo[],
  ranges: number[][],
  onProgress?: (progress: number) => void
): Promise<{ name: string; data: Uint8Array }[]> {
  const results: { name: string; data: Uint8Array }[] = [];
  const loadedPdfs: Map<number, PDFDocument> = new Map();

  // Pre-load all needed PDFs
  for (const page of pages) {
    if (fileBuffers.has(page.fileIndex) && !loadedPdfs.has(page.fileIndex)) {
      loadedPdfs.set(page.fileIndex, await loadForEdit(page.fileIndex));
    }
  }

  let completed = 0;
  const totalOps = ranges.length;

  for (let r = 0; r < ranges.length; r++) {
    const range = ranges[r];
    const outputPdf = await PDFDocument.create();
    let fontFor: FontResolver | undefined;

    for (const pageIdx of range) {
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const sourcePdf = loadedPdfs.get(page.fileIndex);
      if (!sourcePdf) continue;

      const [copiedPage] = await outputPdf.copyPages(sourcePdf, [page.pageIndex]);
      if (page.rotation !== 0) {
        copiedPage.setRotation(
          degrees(effectiveRotation(copiedPage.getRotation().angle, page.rotation))
        );
      }
      outputPdf.addPage(copiedPage);

      if (page.annotations && page.annotations.length > 0) {
        if (!fontFor) fontFor = makeFontResolver(outputPdf);
        await stampAnnotations(outputPdf, copiedPage, page.annotations, fontFor);
      }
    }

    const data = await outputPdf.save();
    results.push({
      name: `split_${r + 1}.pdf`,
      data,
    });

    completed++;
    if (onProgress) {
      onProgress(Math.round((completed / totalOps) * 100));
    }
  }

  return results;
}

/**
 * Rasterize each page to a JPEG and rebuild a PDF around the raster images —
 * the actual "compress" transform. Split out from `compressPdf` so the
 * latter can compare this against the lossless `buildPdf` output and pick
 * whichever is actually smaller.
 */
async function rasterizeToJpegPdf(
  pages: PageInfo[],
  quality: number,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const outputPdf = await PDFDocument.create();
  let fontFor: FontResolver | undefined;
  const loadedPdfs = await loadPdfJsDocsForPages(pages);

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageInfo = pages[i];
      const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
      if (!pdfDoc) continue;

      const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);

      // Scale 1.5 sets the raster resolution (a quality/size tradeoff); the
      // output PAGE must still be sized in points, not raster pixels, or it
      // comes out 1.5x too big in both dimensions (#6) — dividing back by
      // `scale` recovers the true point size the source page had.
      const scale = 1.5;
      const rotation = effectiveRotation(pdfPage.rotate, pageInfo.rotation);
      const viewport = pdfPage.getViewport({ scale, rotation });
      const pointWidth = viewport.width / scale;
      const pointHeight = viewport.height / scale;

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      // White background for JPEG
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });

      if (blob) {
        const imageBytes = await blob.arrayBuffer();
        const compressedImage = await outputPdf.embedJpg(imageBytes);

        const outputPage = outputPdf.addPage([pointWidth, pointHeight]);
        outputPage.drawImage(compressedImage, { x: 0, y: 0, width: pointWidth, height: pointHeight });

        if (pageInfo.annotations && pageInfo.annotations.length > 0) {
          if (!fontFor) fontFor = makeFontResolver(outputPdf);
          // The raster already has rotation baked in, and the page is now
          // sized in the same points the annotations were recorded in, so —
          // unlike before this fix — no scaling is needed.
          await stampAnnotations(outputPdf, outputPage, pageInfo.annotations, fontFor);
        }
      }

      if (onProgress) {
        onProgress(Math.round(((i + 1) / pages.length) * 100));
      }
    }
  } finally {
    destroyAll(loadedPdfs);
  }

  return outputPdf.save();
}

/**
 * Compress a PDF by re-encoding pages as compressed JPEGs. Some inputs —
 * already-compressed scans, or PDFs with little more than text — come out
 * *larger* after rasterizing, so the result is compared against the
 * lossless `buildPdf` output and the smaller of the two wins; `alreadyOptimal`
 * tells the caller which happened, so the UI can say so instead of silently
 * handing back a "compressed" file that's actually the untouched original.
 */
export async function compressPdf(
  pages: PageInfo[],
  quality: number,
  onProgress?: (progress: number) => void
): Promise<{ data: Uint8Array; alreadyOptimal: boolean }> {
  const rasterized = await rasterizeToJpegPdf(pages, quality, onProgress);
  const lossless = await buildPdf(pages);

  if (rasterized.length >= lossless.length) {
    return { data: lossless, alreadyOptimal: true };
  }
  return { data: rasterized, alreadyOptimal: false };
}

/**
 * Parse range strings like "1-3, 5, 7-9" into arrays of page indices (0-based).
 */
export function parseRanges(rangeStr: string, totalPages: number): number[][] {
  const result: number[][] = [];
  const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    const range: number[] = [];
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = Math.max(1, parseInt(startStr, 10));
      const end = Math.min(totalPages, parseInt(endStr, 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          range.push(i - 1); // Convert to 0-based
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) {
        range.push(num - 1);
      }
    }
    if (range.length > 0) {
      result.push(range);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/**
 * Download a Blob with a given filename.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 10000);
}

/**
 * Download a file to the user's computer.
 */
export function downloadFile(data: Uint8Array, filename: string) {
  downloadBlob(new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename);
}

/**
 * Zip a set of output files into one Blob. Level 0 (store, no compression)
 * because every caller's payload — PDFs, PNGs, JPGs — is already compressed;
 * spending CPU to re-compress it back would only save a few bytes.
 */
export function zipFiles(files: { name: string; data: Uint8Array }[]): Blob {
  const zippable: Zippable = {};
  const usedNames = new Set<string>();

  for (const file of files) {
    let name = file.name;
    let suffix = 2;
    while (usedNames.has(name)) {
      const dot = file.name.lastIndexOf('.');
      name =
        dot === -1
          ? `${file.name} (${suffix})`
          : `${file.name.slice(0, dot)} (${suffix})${file.name.slice(dot)}`;
      suffix++;
    }
    usedNames.add(name);
    zippable[name] = [file.data, { level: 0 }];
  }

  return new Blob([zipSync(zippable) as unknown as BlobPart], { type: 'application/zip' });
}

/**
 * Download one file directly, or several as a single ZIP. Firing N separate
 * downloads makes Chrome show its "this site is trying to download multiple
 * files" prompt, which silently blocks every download after the first — a
 * single ZIP sidesteps that entirely (#13).
 */
export async function downloadFilesOrZip(
  files: { name: string; data: Uint8Array }[],
  zipName: string
): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    downloadBlob(new Blob([files[0].data as unknown as BlobPart]), files[0].name);
    return;
  }
  downloadBlob(zipFiles(files), zipName);
}

/**
 * Convert PDF pages to images (PNG or JPG) and download them — a single
 * output downloads directly, more than one downloads as a ZIP (#13).
 */
export async function convertPdfToImages(
  pages: PageInfo[],
  format: 'png' | 'jpg',
  customFilename?: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const loadedPdfs = await loadPdfJsDocsForPages(pages);
  const outputs: { name: string; data: Uint8Array }[] = [];

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageInfo = pages[i];
      const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
      if (!pdfDoc) continue;

      const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);
      const scale = 2.0; // High resolution
      const viewport = pdfPage.getViewport({
        scale,
        rotation: effectiveRotation(pdfPage.rotate, pageInfo.rotation),
      });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      // White background for JPG (no transparency)
      if (format === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const quality = format === 'jpg' ? 0.92 : undefined;

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), mimeType, quality);
      });

      const prefix = customFilename?.trim() || 'page';
      outputs.push({
        name: `${prefix}_${i + 1}.${format}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });

      if (onProgress) {
        onProgress(Math.round(((i + 1) / pages.length) * 100));
      }
    }
  } finally {
    destroyAll(loadedPdfs);
  }

  const zipName = customFilename?.trim() ? `${customFilename.trim()}.zip` : 'images.zip';
  await downloadFilesOrZip(outputs, zipName);
}

/** The subset of a pdf.js text-content item this file actually reads. Plain
 * `TextItem`s have `str`/`hasEOL`; marked-content items don't and are
 * skipped, matching what the old `item.str` access implicitly assumed. */
interface PdfTextRun {
  str: string;
  hasEOL: boolean;
}

function isTextRun(item: unknown): item is PdfTextRun {
  return typeof item === 'object' && item !== null && 'str' in item;
}

/**
 * Extract text from all PDF pages and download as a .txt file.
 */
export async function convertPdfToText(
  pages: PageInfo[],
  filename: string = 'extracted_text.txt',
  onProgress?: (progress: number) => void
): Promise<void> {
  const loadedPdfs = await loadPdfJsDocsForPages(pages);
  let fullText = '';

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageInfo = pages[i];
      const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
      if (!pdfDoc) continue;

      const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);
      const textContent = await pdfPage.getTextContent();

      // Concatenate runs directly and break the line wherever pdf.js marks
      // one (`hasEOL`), instead of joining every run with a single space —
      // that used to flatten a page's entire line structure into one line (#18).
      let pageText = '';
      for (const item of textContent.items) {
        if (!isTextRun(item)) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
      }

      fullText += `--- Page ${i + 1} ---\n${pageText}\n\n`;

      if (onProgress) {
        onProgress(Math.round(((i + 1) / pages.length) * 100));
      }
    }
  } finally {
    destroyAll(loadedPdfs);
  }

  const blob = new Blob([fullText], { type: 'text/plain' });
  downloadBlob(blob, filename);
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a PDF with a password, AES-256 via qpdf (replacing the previous
 * RC4-128 implementation — see `utils/qpdf.ts` for the encrypt syntax and
 * the qpdf version this was verified against) (#17).
 */
export async function lockPdfBytes(pdfBytes: Uint8Array, password: string): Promise<Uint8Array> {
  return encryptPdfBytes(pdfBytes, password);
}

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

/**
 * Matches a TypeError message that names a missing method/property on (or a
 * missing global reference to) a JS *built-in* — e.g. `Map.prototype.
 * getOrInsert is not a function`, `Promise.withResolvers is not a function`,
 * `Uint8Array.fromBase64 is not a function`, or a bare `structuredClone is
 * not defined`. Only these indicate the runtime itself is missing a feature
 * (a genuinely out-of-date browser). A TypeError naming some other object
 * (e.g. `qpdf.FS.analyzePath is not a function`, from a bug in our own code
 * or a third-party library) must NOT match, so the built-in names are
 * enumerated explicitly rather than matched by a generic `<name> is not a
 * function` pattern.
 */
const MISSING_BUILTIN_FEATURE = new RegExp(
  '\\b(?:' +
    [
      'Array',
      'Object',
      'Map',
      'WeakMap',
      'WeakSet',
      'Set',
      'Promise',
      'Math',
      'JSON',
      'String',
      'Number',
      'BigInt',
      'Uint8Array',
      'Int8Array',
      'Uint16Array',
      'Int16Array',
      'Uint32Array',
      'Int32Array',
      'Float32Array',
      'Float64Array',
      'BigInt64Array',
      'BigUint64Array',
      'ArrayBuffer',
      'SharedArrayBuffer',
      'DataView',
      'URL',
      'URLSearchParams',
      'Intl',
      'Reflect',
      'Symbol',
      'RegExp',
      'Date',
      'Proxy',
      'structuredClone',
      'fetch',
      'crypto',
    ].join('|') +
    ')(?:\\.[A-Za-z0-9_]+)* is not (?:a function|defined)\\b'
);

/**
 * Turn any failure from loading, converting, or decrypting a file into a
 * short, plain-language reason. The UI prefixes this with the file name, so
 * these stay lowercase sentence fragments rather than full sentences.
 */
export function describeLoadError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'InvalidPDFException') return "isn't a valid PDF or is damaged";

  if (err instanceof TypeError && MISSING_BUILTIN_FEATURE.test(message)) {
    return 'your browser is out of date — update Chrome and try again';
  }

  if (isChunkLoadError(err)) return CHUNK_LOAD_MESSAGE;

  if (/SOI not found|PNG|image/i.test(message)) return "the image couldn't be read";

  if (err instanceof QpdfError) {
    return err.isPasswordError ? 'the password is incorrect' : "it couldn't be decrypted";
  }

  return "it couldn't be opened";
}
