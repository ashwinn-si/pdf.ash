import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage } from 'pdf-lib';
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

const WATERMARK_COLORS: Record<WatermarkColor, [number, number, number]> = {
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

/** Draw `text` with its visual centre at (cx, cy), `angle` degrees counter-clockwise. */
function drawCentered(
  page: PDFPage,
  text: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  cx: number,
  cy: number,
  angle: number,
  color: [number, number, number],
  opacity: number
) {
  const view = viewOf(page);
  const width = font.widthOfTextAtSize(text, size);
  const height = font.heightAtSize(size, { descender: false });
  const rad = (angle * Math.PI) / 180;
  // Baseline start so the text's centre sits on (cx, cy) once rotated.
  const sx = cx - (width / 2) * Math.cos(rad) + (height / 2) * Math.sin(rad);
  const sy = cy - (width / 2) * Math.sin(rad) - (height / 2) * Math.cos(rad);
  const { x, y } = view.toPage(sx, sy);
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: rgb(...color),
    opacity,
    rotate: degrees(angle + view.rot),
  });
}

function formatPageNumber(format: PageNumberFormat, n: number, last: number): string {
  if (format === 'page-n') return `Page ${n}`;
  if (format === 'n-of-total') return `${n} of ${last}`;
  return `${n}`;
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
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const wm = options.watermark;
  const watermarkText = wm.enabled ? toWinAnsi(wm.text).text.trim() : '';
  const pn = options.pageNumbers;
  const startAt = Number.isFinite(pn.startAt) ? Math.trunc(pn.startAt) : 1;
  const lastNumber = startAt + pages.length - 1;

  pages.forEach((page, i) => {
    const { visibleW, visibleH } = viewOf(page);

    if (watermarkText) {
      const diagonal = wm.layout === 'diagonal';
      const unit = helveticaBold.widthOfTextAtSize(watermarkText, 1) || 1;
      const target = diagonal
        ? Math.min(visibleW, visibleH) * 1.0 * Math.SQRT2 * 0.7
        : visibleW * 0.75;
      const size = Math.max(10, Math.min(150, target / unit));
      drawCentered(
        page,
        watermarkText,
        helveticaBold,
        size,
        visibleW / 2,
        visibleH / 2,
        diagonal ? 45 : 0,
        WATERMARK_COLORS[wm.color],
        Math.min(1, Math.max(0.05, wm.opacity / 100))
      );
    }

    if (pn.enabled && !(pn.skipFirstPage && i === 0)) {
      const label = formatPageNumber(pn.format, startAt + i, lastNumber);
      const width = helvetica.widthOfTextAtSize(label, PAGE_NUMBER_SIZE);
      const [vertical, horizontal] = pn.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
      const cx =
        horizontal === 'left'
          ? PAGE_NUMBER_MARGIN + width / 2
          : horizontal === 'right'
            ? visibleW - PAGE_NUMBER_MARGIN - width / 2
            : visibleW / 2;
      const cy = vertical === 'top' ? visibleH - PAGE_NUMBER_MARGIN : PAGE_NUMBER_MARGIN;
      drawCentered(page, label, helvetica, PAGE_NUMBER_SIZE, cx, cy, 0, [0.2, 0.2, 0.2], 1);
    }

    onProgress?.(Math.round(((i + 1) / pages.length) * 100));
  });

  return doc.save();
}
