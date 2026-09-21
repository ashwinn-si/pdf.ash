import {
  degrees,
  rgb,
  LineCapStyle,
  BlendMode,
  type PDFDocument,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib';
import {
  hexToRgb01,
  opacityOf,
  type Annotation,
  type Point,
  type TextFont,
} from './annotations';
import { toWinAnsi } from './pdfText';

/**
 * Resolves a base-14 font variant on demand. Callers cache, so a document with
 * mixed styles embeds each variant once.
 */
export type FontResolver = (
  font: TextFont,
  bold: boolean,
  italic: boolean
) => Promise<PDFFont>;

/**
 * Size of the page as the reader sees it, i.e. with /Rotate applied.
 * Annotation coordinates are relative to this box, origin top-left.
 */
export function displayedSize(page: PDFPage): { dw: number; dh: number } {
  const { width, height } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r % 180 === 0 ? { dw: width, dh: height } : { dw: height, dh: width };
}

/**
 * Map a point in displayed space (origin top-left, y down) to PDF user space
 * (origin bottom-left, y up, *unrotated*).
 *
 * The four cases invert the clockwise display rotation R: for R=90 the user
 * left edge becomes the display top edge, for R=270 the user right edge does,
 * and R=180 flips both axes.
 */
export function toUserSpace(
  dx: number,
  dy: number,
  page: PDFPage
): { x: number; y: number } {
  const { width: W, height: H } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  switch (r) {
    case 90:
      return { x: dy, y: dx };
    case 180:
      return { x: W - dx, y: dy };
    case 270:
      return { x: W - dy, y: H - dx };
    default:
      return { x: dx, y: H - dy };
  }
}

/**
 * Counter-rotation to keep drawn boxes, glyphs and images upright once the
 * viewer applies the page's own clockwise rotation. pdf-lib's `rotate` is
 * counter-clockwise-positive, so rotating content by +R cancels a CW page
 * rotation of R.
 */
function uprightRotation(page: PDFPage) {
  return degrees(((page.getRotation().angle % 360) + 360) % 360);
}

function colorOf(hex: string) {
  const { r, g, b } = hexToRgb01(hex);
  return rgb(r, g, b);
}

/**
 * Drop points that are closer together than `minGap` points. Freehand strokes
 * emit a sample per pointermove, and each surviving point becomes its own
 * `drawLine` operation in the content stream — thinning keeps output size sane
 * without any visible change to the curve.
 */
export function simplifyStroke(points: Point[], minGap = 1.2): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minGap) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Uniformly scale an annotation's geometry. Needed by the raster paths, where
 * the rebuilt page is sized in render pixels rather than the original points.
 */
export function scaleAnnotation(a: Annotation, k: number): Annotation {
  if (k === 1) return a;
  switch (a.kind) {
    case 'pencil':
      return {
        ...a,
        points: a.points.map((p) => ({ x: p.x * k, y: p.y * k })),
        strokeWidth: a.strokeWidth * k,
      };
    case 'text':
      return { ...a, x: a.x * k, y: a.y * k, fontSize: a.fontSize * k };
    case 'cross':
    case 'check':
      return { ...a, x: a.x * k, y: a.y * k, size: a.size * k };
    default:
      return { ...a, x: a.x * k, y: a.y * k, w: a.w * k, h: a.h * k };
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Draw one page's annotations onto it with pdf-lib vector primitives, so the
 * original page content — including its selectable text layer — is untouched.
 */
export async function stampAnnotations(
  pdfDoc: PDFDocument,
  page: PDFPage,
  annotations: Annotation[],
  fontFor: FontResolver
): Promise<void> {
  const rotate = uprightRotation(page);

  for (const a of annotations) {
    switch (a.kind) {
      case 'highlight': {
        // Anchor is the rect's bottom-left on screen, which is its top-left
        // plus its height in display space (y grows downwards there).
        const anchor = toUserSpace(a.x, a.y + a.h, page);
        page.drawRectangle({
          x: anchor.x,
          y: anchor.y,
          width: a.w,
          height: a.h,
          rotate,
          color: colorOf(a.color),
          opacity: opacityOf(a),
          blendMode: BlendMode.Multiply,
        });
        break;
      }

      case 'pencil': {
        const pts = simplifyStroke(a.points);
        const color = colorOf(a.color);
        const opacity = opacityOf(a);
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({
            start: toUserSpace(pts[i - 1].x, pts[i - 1].y, page),
            end: toUserSpace(pts[i].x, pts[i].y, page),
            thickness: a.strokeWidth,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
        // A single tap still deserves a visible dot.
        if (pts.length === 1) {
          const p = toUserSpace(pts[0].x, pts[0].y, page);
          page.drawLine({
            start: p,
            end: p,
            thickness: a.strokeWidth,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
        break;
      }

      case 'cross': {
        const h = a.size / 2;
        const color = colorOf(a.color);
        const opacity = opacityOf(a);
        const thickness = Math.max(1, a.size * 0.12);
        page.drawLine({
          start: toUserSpace(a.x - h, a.y - h, page),
          end: toUserSpace(a.x + h, a.y + h, page),
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });
        page.drawLine({
          start: toUserSpace(a.x + h, a.y - h, page),
          end: toUserSpace(a.x - h, a.y + h, page),
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });
        break;
      }

      case 'check': {
        const s = a.size;
        const color = colorOf(a.color);
        const opacity = opacityOf(a);
        const thickness = Math.max(1, s * 0.13);
        const elbow = { x: a.x - 0.08 * s, y: a.y + 0.3 * s };
        page.drawLine({
          start: toUserSpace(a.x - 0.4 * s, a.y + 0.02 * s, page),
          end: toUserSpace(elbow.x, elbow.y, page),
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });
        page.drawLine({
          start: toUserSpace(elbow.x, elbow.y, page),
          end: toUserSpace(a.x + 0.42 * s, a.y - 0.34 * s, page),
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });
        break;
      }

      case 'text': {
        // The base-14 fonts only encode WinAnsi — ₹, →, emoji etc. otherwise
        // throw "WinAnsi cannot encode ..." and abort the whole download (#2).
        const { text: safeText } = toWinAnsi(a.text);
        const lines = safeText.split('\n');
        const lineHeight = a.fontSize * 1.2;
        const color = colorOf(a.color);
        const font = await fontFor(a.font, a.bold, a.italic);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          // drawText anchors at the baseline; sit it under the line's top edge.
          const baselineY = a.y + i * lineHeight + a.fontSize * 0.82;
          const anchor = toUserSpace(a.x, baselineY, page);
          page.drawText(line, {
            x: anchor.x,
            y: anchor.y,
            size: a.fontSize,
            font,
            color,
            opacity: opacityOf(a),
            rotate,
          });
        }
        break;
      }

      case 'signature': {
        const bytes = dataUrlToBytes(a.dataUrl);
        const image = a.dataUrl.startsWith('data:image/jpeg')
          ? await pdfDoc.embedJpg(bytes)
          : await pdfDoc.embedPng(bytes);
        const anchor = toUserSpace(a.x, a.y + a.h, page);
        page.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: a.w,
          height: a.h,
          opacity: opacityOf(a),
          rotate,
        });
        break;
      }
    }
  }
}
