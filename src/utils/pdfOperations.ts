import { PDFDocument, StandardFonts, degrees, type PDFFont } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import type { PageInfo } from './pdfRenderer';
import { pdfjsLib } from './pdfjs';
import { stampAnnotations, scaleAnnotation, type FontResolver } from './annotationStamp';
import type { TextFont } from './annotations';

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

/**
 * Convert an image file (JPG/PNG) into a single-page PDF ArrayBuffer.
 */
export async function imageToPdfBuffer(imageFile: File): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();
  const imageBytes = await imageFile.arrayBuffer();

  let image;
  const type = imageFile.type.toLowerCase();
  if (type === 'image/png') {
    image = await pdfDoc.embedPng(imageBytes);
  } else {
    // JPG/JPEG
    image = await pdfDoc.embedJpg(imageBytes);
  }

  // Create a page that matches the image dimensions
  const { width, height } = image.scale(1);
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
}

/**
 * Check if a file is a valid PDF, image, or Markdown file by MIME type or
 * extension fallback. Extension is always checked regardless of the reported
 * type — not just when it's empty — because .md files in particular get
 * reported with inconsistent or missing MIME types across browsers/OSes
 * (and on Windows, dragged files of any kind often have an empty type).
 */
export function isValidFile(file: File): boolean {
  const validMimes = ['application/pdf', 'image/png', 'image/jpeg', 'text/markdown', 'text/x-markdown'];
  const validExts = ['.pdf', '.jpg', '.jpeg', '.png', '.md', '.markdown'];
  const name = file.name.toLowerCase();
  return validMimes.includes(file.type) || validExts.some(ext => name.endsWith(ext));
}

/**
 * Check if a file should be treated as an image (not a PDF).
 */
export function isImageFile(file: File): boolean {
  const imageMimes = ['image/png', 'image/jpeg'];
  const imageExts = ['.jpg', '.jpeg', '.png'];
  const name = file.name.toLowerCase();
  return imageMimes.includes(file.type) || imageExts.some(ext => name.endsWith(ext));
}

/**
 * Check if a file should be treated as Markdown (not a PDF).
 */
export function isMarkdownFile(file: File): boolean {
  const markdownMimes = ['text/markdown', 'text/x-markdown'];
  const markdownExts = ['.md', '.markdown'];
  const name = file.name.toLowerCase();
  return markdownMimes.includes(file.type) || markdownExts.some(ext => name.endsWith(ext));
}

/**
 * Stores the original file ArrayBuffers for later operations.
 */
let fileBuffers: Map<number, ArrayBuffer> = new Map();

export function storeFileBuffer(fileIndex: number, buffer: ArrayBuffer) {
  fileBuffers.set(fileIndex, buffer);
}

export function getFileBuffer(fileIndex: number): ArrayBuffer | undefined {
  return fileBuffers.get(fileIndex);
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

  // Clone: pdfjs-dist transfers (detaches) the ArrayBuffer it is handed.
  const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
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

  doc.destroy();

  return {
    url: canvas.toDataURL('image/jpeg', 0.9),
    width: canvas.width,
    height: canvas.height,
    pointWidth: unscaled.width,
    pointHeight: unscaled.height,
  };
}

export function clearFileBuffers() {
  fileBuffers.clear();
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
    const buffer = fileBuffers.get(page.fileIndex);
    if (!buffer) continue;

    if (!loadedPdfs.has(page.fileIndex)) {
      const doc = await PDFDocument.load(buffer);
      loadedPdfs.set(page.fileIndex, doc);
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
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      const doc = await PDFDocument.load(buffer);
      loadedPdfs.set(page.fileIndex, doc);
    }
  }

  let completed = 0;
  const totalOps = ranges.length;

  for (let r = 0; r < ranges.length; r++) {
    const range = ranges[r];
    const splitPdf = await PDFDocument.create();
    let fontFor: FontResolver | undefined;

    for (const pageIdx of range) {
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const sourcePdf = loadedPdfs.get(page.fileIndex)!;
      const [copiedPage] = await splitPdf.copyPages(sourcePdf, [page.pageIndex]);
      if (page.rotation !== 0) {
        copiedPage.setRotation(
          degrees(effectiveRotation(copiedPage.getRotation().angle, page.rotation))
        );
      }
      splitPdf.addPage(copiedPage);

      if (page.annotations && page.annotations.length > 0) {
        if (!fontFor) fontFor = makeFontResolver(splitPdf);
        await stampAnnotations(splitPdf, copiedPage, page.annotations, fontFor);
      }
    }

    const data = await splitPdf.save();
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
 * Compress a PDF by re-encoding pages as compressed JPEGs to significantly reduce file size.
 */
export async function compressPdf(
  pages: PageInfo[],
  quality: number,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const outputPdf = await PDFDocument.create();
  let fontFor: FontResolver | undefined;

  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      // Clone the buffer: pdfjs-dist transfers (detaches) the ArrayBuffer it's given
      // to its worker, which would otherwise permanently zero out the buffer we
      // keep in fileBuffers for later operations (merge/split/compress/convert again).
      const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      loadedPdfs.set(page.fileIndex, doc);
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const pageInfo = pages[i];
    const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
    if (!pdfDoc) continue;

    const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);
    
    // Scale 1.5 offers a balance between maintaining readability and reducing size
    const scale = 1.5;
    const viewport = pdfPage.getViewport({
      scale,
      rotation: effectiveRotation(pdfPage.rotate, pageInfo.rotation),
    });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    // White background for JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

    // Compress to JPEG with user-specified quality
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    if (blob) {
      const imageBytes = await blob.arrayBuffer();
      const compressedImage = await outputPdf.embedJpg(imageBytes);
      
      const { width, height } = compressedImage.scale(1);
      const outputPage = outputPdf.addPage([width, height]);
      outputPage.drawImage(compressedImage, { x: 0, y: 0, width, height });

      if (pageInfo.annotations && pageInfo.annotations.length > 0) {
        if (!fontFor) fontFor = makeFontResolver(outputPdf);
        // The rasterized page is already rotation-baked, so annotation
        // coordinates just need scaling from points to this page's pixel size.
        const k = width / (viewport.width / scale);
        outputPage.setRotation(degrees(0));
        await stampAnnotations(
          outputPdf,
          outputPage,
          pageInfo.annotations.map((a) => scaleAnnotation(a, k)),
          fontFor
        );
      }
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }
  }

  return outputPdf.save();
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

/**
 * Download a file to the user's computer.
 */
export function downloadFile(data: Uint8Array, filename: string) {
  const blob = new Blob([data as unknown as BlobPart], { type: 'application/pdf' });
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
 * Download multiple files as individual downloads.
 */
export async function downloadMultipleFiles(files: { name: string; data: Uint8Array }[]) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    downloadFile(file.data, file.name);
    
    // Small delay to avoid browser throttling multiple downloads
    if (i < files.length - 1) {
      await new Promise((r) => setTimeout(r, 500)); // Increased to 500ms for safety in Firefox
    }
  }
}

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
 * Convert PDF pages to images (PNG or JPG).
 * Renders each page at high resolution and triggers downloads.
 */
export async function convertPdfToImages(
  pages: PageInfo[],
  format: 'png' | 'jpg',
  customFilename?: string,
  onProgress?: (progress: number) => void
): Promise<void> {

  // Load each unique file
  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      // Clone the buffer: pdfjs-dist transfers (detaches) the ArrayBuffer it's given
      // to its worker, which would otherwise permanently zero out the buffer we
      // keep in fileBuffers for later operations (merge/split/compress/convert again).
      const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      loadedPdfs.set(page.fileIndex, doc);
    }
  }

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
    downloadBlob(blob, `${prefix}_${i + 1}.${format}`);

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }

    // Small delay to avoid browser throttling multiple downloads
    if (i < pages.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Extract text from all PDF pages and download as a .txt file.
 */
export async function convertPdfToText(
  pages: PageInfo[],
  filename: string = 'extracted_text.txt',
  onProgress?: (progress: number) => void
): Promise<void> {

  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      // Clone the buffer: pdfjs-dist transfers (detaches) the ArrayBuffer it's given
      // to its worker, which would otherwise permanently zero out the buffer we
      // keep in fileBuffers for later operations (merge/split/compress/convert again).
      const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      loadedPdfs.set(page.fileIndex, doc);
    }
  }

  let fullText = '';

  for (let i = 0; i < pages.length; i++) {
    const pageInfo = pages[i];
    const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
    if (!pdfDoc) continue;

    const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);
    const textContent = await pdfPage.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');

    fullText += `--- Page ${i + 1} ---\n${pageText}\n\n`;

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }
  }

  const blob = new Blob([fullText], { type: 'text/plain' });
  downloadBlob(blob, filename);
}

/**
 * Encrypt a PDF Uint8Array with a password.
 */
export async function lockPdfBytes(
  pdfBytes: Uint8Array,
  password: string
): Promise<Uint8Array> {
  return await encryptPDF(pdfBytes, password);
}
