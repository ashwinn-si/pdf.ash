import { pdfjsLib } from './pdfjs';
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

/**
 * Renders all pages of a PDF file as thumbnail data URLs.
 */
export async function renderPdfThumbnails(
  file: File,
  fileIndex: number,
  scale: number = 0.5,
  password?: string
): Promise<PageInfo[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;
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
  }

  return pages;
}
