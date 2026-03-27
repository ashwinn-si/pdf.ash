import { PDFDocument, degrees } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import type { PageInfo } from './pdfRenderer';

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
  return pdfBytes.buffer as ArrayBuffer;
}

/**
 * Stores the original file ArrayBuffers for later operations.
 */
let fileBuffers: Map<number, ArrayBuffer> = new Map();

export function storeFileBuffer(fileIndex: number, buffer: ArrayBuffer) {
  fileBuffers.set(fileIndex, buffer);
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
      copiedPage.setRotation(degrees(page.rotation));
    }

    outputPdf.addPage(copiedPage);

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

    for (const pageIdx of range) {
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const sourcePdf = loadedPdfs.get(page.fileIndex)!;
      const [copiedPage] = await splitPdf.copyPages(sourcePdf, [page.pageIndex]);
      if (page.rotation !== 0) {
        copiedPage.setRotation(degrees(page.rotation));
      }
      splitPdf.addPage(copiedPage);
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
  const pdfjsLib = await import('pdfjs-dist');
  const outputPdf = await PDFDocument.create();

  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
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
    const viewport = pdfPage.getViewport({ scale, rotation: pageInfo.rotation });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    // White background for JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pdfPage.render({ canvasContext: ctx, viewport, canvas } as any).promise;

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
  }, 250);
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
  }, 250);
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
  const pdfjsLib = await import('pdfjs-dist');

  // Load each unique file
  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
      loadedPdfs.set(page.fileIndex, doc);
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const pageInfo = pages[i];
    const pdfDoc = loadedPdfs.get(pageInfo.fileIndex);
    if (!pdfDoc) continue;

    const pdfPage = await pdfDoc.getPage(pageInfo.pageIndex + 1);
    const scale = 2.0; // High resolution
    const viewport = pdfPage.getViewport({ scale, rotation: pageInfo.rotation });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    // White background for JPG (no transparency)
    if (format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await pdfPage.render({ canvasContext: ctx, viewport, canvas } as any).promise;

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
  const pdfjsLib = await import('pdfjs-dist');

  const loadedPdfs: Map<number, any> = new Map();
  for (const page of pages) {
    const buffer = fileBuffers.get(page.fileIndex);
    if (buffer && !loadedPdfs.has(page.fileIndex)) {
      const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
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
