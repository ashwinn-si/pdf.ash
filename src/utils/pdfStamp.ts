import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { toWinAnsi } from './pdfText';

export type WatermarkColor = 'gray' | 'red' | 'blue' | 'black';
export type WatermarkLayout = 'diagonal' | 'horizontal';
export type PageNumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';
export type PageNumberFormat = 'n' | 'page-n' | 'n-of-total';

export interface StampOptions {
  watermark: {
    enabled: boolean;
    text: string;
    /** 5–100, percent. */
    opacity: number;
    color: WatermarkColor;
    layout: WatermarkLayout;
  };
  pageNumbers: {
    enabled: boolean;
    position: PageNumberPosition;
    format: PageNumberFormat;
    startAt: number;
    skipFirstPage: boolean;
  };
}

export const DEFAULT_STAMP_OPTIONS: StampOptions = {
  watermark: { enabled: true, text: 'CONFIDENTIAL', opacity: 20, color: 'gray', layout: 'diagonal' },
  pageNumbers: {
    enabled: false,
    position: 'bottom-center',
    format: 'page-n',
    startAt: 1,
    skipFirstPage: false,
  },
};

export const WATERMARK_COLORS: Record<WatermarkColor, [number, number, number]> = {
  gray: [0.45, 0.45, 0.45],
  red: [0.85, 0.12, 0.15],
  blue: [0.1, 0.3, 0.8],
  black: [0, 0, 0],
};

const PAGE_NUMBER_MARGIN = 28;
const PAGE_NUMBER_SIZE = 10;

/** Whether `options` would change anything — lets the UI refuse an empty run. */
export function hasStampWork(options: StampOptions): boolean {
  const wm = options.watermark;
  const watermark = wm.enabled && toWinAnsi(wm.text).text.trim().length > 0;
  return watermark || options.pageNumbers.enabled;
}

/**
 * Where a point in the page *as displayed* lands in the page's own
 * (unrotated) coordinate space. A page with /Rotate 90 is shown turned
 * clockwise, so "bottom-right of what the reader sees" is not the bottom-right
 * of the underlying media box. Also returns the visible width/height and the
 * angle text must be drawn at to read upright on screen.
 */
function viewOf(page: PDFPage) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: ox, y: oy, width: W, height: H } = box;
  const visibleW = rot === 90 || rot === 270 ? H : W;
  const visibleH = rot === 90 || rot === 270 ? W : H;

  const toPage = (vx: number, vy: number) => {
    switch (rot) {
      case 90:
        return { x: ox + (W - vy), y: oy + vx };
      case 180:
        return { x: ox + (W - vx), y: oy + (H - vy) };
      case 270:
        return { x: ox + vy, y: oy + (H - vx) };
      default:
        return { x: ox + vx, y: oy + vy };
    }
  };

  return { visibleW, visibleH, rot, toPage };
}

/** Fonts used for stamps — `regular` for page numbers, `bold` for watermarks. */
export interface StampFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function embedStampFonts(doc: PDFDocument): Promise<StampFonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

let previewFonts: Promise<StampFonts> | null = null;
/** Font metrics for the live preview — same Helvetica metrics the real run uses. */
export function loadStampFonts(): Promise<StampFonts> {
  previewFonts ??= PDFDocument.create().then(embedStampFonts);
  return previewFonts;
}

/** One piece of text to stamp, positioned in the page *as displayed* (points,
 * origin bottom-left, `angle` degrees counter-clockwise about its centre). */
export interface StampMark {
  text: string;
  font: 'regular' | 'bold';
  size: number;
  cx: number;
  cy: number;
  angle: number;
  color: [number, number, number];
  opacity: number;
}

function formatPageNumber(format: PageNumberFormat, n: number, last: number): string {
  if (format === 'page-n') return `Page ${n}`;
  if (format === 'n-of-total') return `${n} of ${last}`;
  return `${n}`;
}

/**
 * Where everything goes on one page. This is the single source of truth for
 * both the real stamping (`applyStamps`) and the on-screen preview, so what
 * the preview shows is what the download contains.
 */
export function layoutStamps(
  visibleW: number,
  visibleH: number,
  index: number,
  count: number,
  options: StampOptions,
  fonts: StampFonts
): StampMark[] {
  const marks: StampMark[] = [];

  const wm = options.watermark;
  const watermarkText = wm.enabled ? toWinAnsi(wm.text).text.trim() : '';
  if (watermarkText) {
    const diagonal = wm.layout === 'diagonal';
    const unit = fonts.bold.widthOfTextAtSize(watermarkText, 1) || 1;
    const target = diagonal
      ? Math.min(visibleW, visibleH) * Math.SQRT2 * 0.7
      : visibleW * 0.75;
    marks.push({
      text: watermarkText,
      font: 'bold',
      size: Math.max(10, Math.min(150, target / unit)),
      cx: visibleW / 2,
      cy: visibleH / 2,
      angle: diagonal ? 45 : 0,
      color: WATERMARK_COLORS[wm.color],
      opacity: Math.min(1, Math.max(0.05, wm.opacity / 100)),
    });
  }

  const pn = options.pageNumbers;
  if (pn.enabled && !(pn.skipFirstPage && index === 0)) {
    const startAt = Number.isFinite(pn.startAt) ? Math.trunc(pn.startAt) : 1;
    const label = formatPageNumber(pn.format, startAt + index, startAt + count - 1);
    const width = fonts.regular.widthOfTextAtSize(label, PAGE_NUMBER_SIZE);
    const [vertical, horizontal] = pn.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
    marks.push({
      text: label,
      font: 'regular',
      size: PAGE_NUMBER_SIZE,
      cx:
        horizontal === 'left'
          ? PAGE_NUMBER_MARGIN + width / 2
          : horizontal === 'right'
            ? visibleW - PAGE_NUMBER_MARGIN - width / 2
            : visibleW / 2,
      cy: vertical === 'top' ? visibleH - PAGE_NUMBER_MARGIN : PAGE_NUMBER_MARGIN,
      angle: 0,
      color: [0.2, 0.2, 0.2],
      opacity: 1,
    });
  }

  return marks;
}

/** Baseline start point (displayed coordinates) that puts the mark's visual
 * centre on (cx, cy) once rotated by its angle. */
export function stampStart(mark: StampMark, fonts: StampFonts): { x: number; y: number } {
  const font = fonts[mark.font];
  const width = font.widthOfTextAtSize(mark.text, mark.size);
  const height = font.heightAtSize(mark.size, { descender: false });
  const rad = (mark.angle * Math.PI) / 180;
  return {
    x: mark.cx - (width / 2) * Math.cos(rad) + (height / 2) * Math.sin(rad),
    y: mark.cy - (width / 2) * Math.sin(rad) - (height / 2) * Math.cos(rad),
  };
}

/**
 * Stamp a text watermark and/or page numbers onto every page of an
 * already-built PDF. Runs on the output bytes (not per source page) so it sees
 * the final page order, rotation and count.
 */
export async function applyStamps(
  data: Uint8Array,
  options: StampOptions,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data);
  const pages = doc.getPages();
  const fonts = await embedStampFonts(doc);

  pages.forEach((page, i) => {
    const view = viewOf(page);
    for (const mark of layoutStamps(view.visibleW, view.visibleH, i, pages.length, options, fonts)) {
      const start = stampStart(mark, fonts);
      const { x, y } = view.toPage(start.x, start.y);
      page.drawText(mark.text, {
        x,
        y,
        size: mark.size,
        font: fonts[mark.font],
        color: rgb(...mark.color),
        opacity: mark.opacity,
        rotate: degrees(mark.angle + view.rot),
      });
    }
    onProgress?.(Math.round(((i + 1) / pages.length) * 100));
  });

  return doc.save();
}
