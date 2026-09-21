import { openPdf } from './pdfjs';
import type { Annotation } from './annotations';

export interface PageInfo {
  id: string;
  fileIndex: number;
  fileName: string;
  pageIndex: number; // 0-based index in original PDF
  totalPagesInFile: number;
  rotation: number;
  thumbnail: string;
  selected: boolean;
  /** Marks added with the Edit tool, stamped in at download time. */
  annotations?: Annotation[];
}

/** Info about an EXIF/metadata field pdf.js exposes as `Object`, not a typed
 * interface — only the one property this app reads is named here. */
interface PdfInfo {
  EncryptFilterName?: string | null;
}

/**
 * Renders all pages of a PDF file as thumbnail data URLs.
 *
 * Returns `encrypted` alongside the pages so the caller can tell a PDF that
 * only opened because a password was supplied (or an owner-only "restricted"
 * PDF that opens with none) from a plain unprotected one — pdf.js will
 * happily render either, but pdf-lib operations on the same stored buffer
 * later need decrypting first (#8).
 */
export async function renderPdfThumbnails(
  file: File,
  fileIndex: number,
  scale: number = 0.5,
  password?: string,
  onPage?: (done: number, total: number) => void
): Promise<{ pages: PageInfo[]; encrypted: boolean }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await openPdf(arrayBuffer, password).promise;

  try {
    const pages: PageInfo[] = [];

    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      pages.push({
        id: `${fileIndex}-${i}-${Date.now()}`,
        fileIndex,
        fileName: file.name,
        pageIndex: i,
        totalPagesInFile: pdf.numPages,
        rotation: 0,
        thumbnail: canvas.toDataURL('image/jpeg', 0.7),
        selected: false,
      });

      onPage?.(i + 1, pdf.numPages);
    }

    const info = (await pdf.getMetadata()).info as PdfInfo;
    const encrypted = !!info.EncryptFilterName;

    return { pages, encrypted };
  } finally {
    pdf.destroy();
  }
}
