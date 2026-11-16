/**
 * Annotation model for the Edit tool.
 *
 * Coordinate system: every position and size is expressed in PDF points inside
 * the page's *displayed* box — i.e. after the page's effective rotation has been
 * applied — with the origin at the TOP-LEFT and y growing downwards (screen
 * convention). That keeps the editor math trivial (screen px = points × zoom)
 * and confines the flip into PDF user space to `annotationStamp.ts`.
 */

export type AnnotationKind =
  | 'text'
  | 'highlight'
  | 'pencil'
  | 'cross'
  | 'check'
  | 'signature'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow';

/** Box shapes: drawn by dragging a box, with a border and an optional fill. */
export type BoxShapeKind = 'rect' | 'ellipse';
/** Stroke shapes: drawn by dragging from one end to the other. */
export type LineShapeKind = 'line' | 'arrow';

export function isBoxShape(kind: AnnotationKind | null): kind is BoxShapeKind {
  return kind === 'rect' || kind === 'ellipse';
}

export function isLineShape(kind: AnnotationKind | null): kind is LineShapeKind {
  return kind === 'line' || kind === 'arrow';
}

export interface Point {
  x: number;
  y: number;
}

/** The three base-14 families, available in every PDF viewer without embedding. */
export type TextFont = 'helvetica' | 'times' | 'courier';

export interface TextAnnotation {
  id: string;
  kind: 'text';
  /** Top-left of the first line. */
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  font: TextFont;
  bold: boolean;
  italic: boolean;
  opacity: number;
}

export interface HighlightAnnotation {
  id: string;
  kind: 'highlight';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
}

export interface PencilAnnotation {
  id: string;
  kind: 'pencil';
  points: Point[];
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface CrossAnnotation {
  id: string;
  kind: 'cross';
  /** Centre of the mark. */
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
}

export interface CheckAnnotation {
  id: string;
  kind: 'check';
  /** Centre of the mark. */
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
}

export interface SignatureAnnotation {
  id: string;
  kind: 'signature';
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG or JPEG data URL. */
  dataUrl: string;
  opacity: number;
}

export interface BoxShapeAnnotation {
  id: string;
  kind: BoxShapeKind;
  /** Top-left of the shape's box (the ellipse is inscribed in it). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Border colour. */
  color: string;
  /** Interior colour, or null for an outline-only shape. */
  fill: string | null;
  /** Border width in points; 0 means no border. */
  strokeWidth: number;
  opacity: number;
}

export interface LineShapeAnnotation {
  id: string;
  kind: LineShapeKind;
  /** Start point; an arrow's head sits at the far end, (x + dx, y + dy). */
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export type Annotation =
  | BoxShapeAnnotation
  | LineShapeAnnotation
  | TextAnnotation
  | HighlightAnnotation
  | PencilAnnotation
  | CrossAnnotation
  | CheckAnnotation
  | SignatureAnnotation;

/** Tools the editor can be in. `select` only moves/deletes existing marks. */
export type EditorTool = 'select' | AnnotationKind;

export const INK_COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a'];
export const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#fda4af'];
/** A Paint-style palette for shape borders and fills. */
export const SHAPE_COLORS = [
  '#1f2937',
  '#ffffff',
  '#dc2626',
  '#f97316',
  '#facc15',
  '#16a34a',
  '#0ea5e9',
  '#2563eb',
  '#7c3aed',
  '#db2777',
];

/**
 * Starting opacity per kind. A highlight is translucent by definition — it has
 * to let the text underneath show through — while ink and stamps start solid.
 * Every kind can be adjusted from the toolbar afterwards.
 */
export const DEFAULT_OPACITY: Record<AnnotationKind, number> = {
  highlight: 0.35,
  text: 1,
  pencil: 1,
  cross: 1,
  check: 1,
  signature: 1,
  rect: 1,
  ellipse: 1,
  line: 1,
  arrow: 1,
};

/** Tolerates annotations created before opacity existed. */
export function opacityOf(a: Annotation): number {
  return typeof a.opacity === 'number' ? a.opacity : DEFAULT_OPACITY[a.kind];
}

export function withAnnotationOpacity(a: Annotation, opacity: number): Annotation {
  return { ...a, opacity };
}

export const TEXT_FONTS: { id: TextFont; label: string; css: string }[] = [
  { id: 'helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { id: 'times', label: 'Times', css: '"Times New Roman", Times, serif' },
  { id: 'courier', label: 'Courier', css: '"Courier New", Courier, monospace' },
];

export function textFontCss(font: TextFont): string {
  return TEXT_FONTS.find((f) => f.id === font)?.css ?? TEXT_FONTS[0].css;
}

/**
 * Rough average glyph width as a fraction of the em, used only for hit boxes
 * and selection outlines — the stamped PDF uses the font's real metrics.
 */
function avgCharWidth(font: TextFont, bold: boolean): number {
  if (font === 'courier') return 0.6;
  if (font === 'times') return bold ? 0.48 : 0.45;
  return bold ? 0.54 : 0.5;
}

let idCounter = 0;
export function newAnnotationId(): string {
  idCounter += 1;
  return `a${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** `#rrggbb` → pdf-lib's 0..1 channel triple. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/** Axis-aligned bounding box, used for selection outlines and hit-testing. */
export function annotationBounds(a: Annotation): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  switch (a.kind) {
    case 'highlight':
    case 'signature':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'rect':
    case 'ellipse': {
      // The border is centred on the box edge, so half of it sits outside.
      const pad = a.strokeWidth / 2;
      return { x: a.x - pad, y: a.y - pad, w: a.w + pad * 2, h: a.h + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const pad = linePad(a);
      return {
        x: Math.min(a.x, a.x + a.dx) - pad,
        y: Math.min(a.y, a.y + a.dy) - pad,
        w: Math.abs(a.dx) + pad * 2,
        h: Math.abs(a.dy) + pad * 2,
      };
    }
    case 'cross':
    case 'check':
      return { x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size };
    case 'text': {
      const lines = a.text.split('\n');
      const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
      const em = avgCharWidth(a.font, a.bold);
      return {
        x: a.x,
        y: a.y,
        w: Math.max(longest * a.fontSize * em, a.fontSize),
        h: lines.length * a.fontSize * 1.2,
      };
    }
    case 'pencil': {
      const xs = a.points.map((p) => p.x);
      const ys = a.points.map((p) => p.y);
      const pad = a.strokeWidth / 2;
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX - pad,
        y: minY - pad,
        w: Math.max(...xs) - minX + pad * 2,
        h: Math.max(...ys) - minY + pad * 2,
      };
    }
  }
}

/** Room around a line's end points: half its width, or the arrowhead's reach. */
function linePad(a: LineShapeAnnotation): number {
  return a.kind === 'arrow' ? Math.max(a.strokeWidth / 2, arrowHeadSize(a.strokeWidth) * 0.6) : a.strokeWidth / 2;
}

/** Length of an arrowhead's barbs for a given stroke width. */
export function arrowHeadSize(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 4);
}

/**
 * The two barb end points of an arrow's head, at (x + dx, y + dy). Shared by
 * the on-screen SVG and the PDF stamp so both draw the same head.
 */
export function arrowHeadPoints(a: LineShapeAnnotation): [Point, Point] {
  const tip = { x: a.x + a.dx, y: a.y + a.dy };
  const len = Math.hypot(a.dx, a.dy) || 1;
  const ux = a.dx / len;
  const uy = a.dy / len;
  const size = Math.min(arrowHeadSize(a.strokeWidth), len * 0.6);
  const spread = Math.PI / 7;
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  return [
    { x: tip.x - size * (ux * cos - uy * sin), y: tip.y - size * (uy * cos + ux * sin) },
    { x: tip.x - size * (ux * cos + uy * sin), y: tip.y - size * (uy * cos - ux * sin) },
  ];
}

/** Translate an annotation by a delta in display points. */
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === 'pencil') {
    return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { ...a, x: a.x + dx, y: a.y + dy };
}

/**
 * Only a highlight stretches freely; everything else keeps its proportions,
 * matching how desktop PDF editors treat stamps, ink and text objects.
 */
export function resizesFreely(a: Annotation): boolean {
  return a.kind === 'highlight' || isBoxShape(a.kind) || isLineShape(a.kind);
}

/**
 * Resize to a new bounding-box size, keeping the top-left corner pinned.
 * Each kind scales the property that actually governs its size, so a cross
 * stays a cross and text stays live text rather than being stretched.
 */
export function resizeAnnotation(a: Annotation, w: number, h: number): Annotation {
  const b = annotationBounds(a);
  const kx = b.w > 0 ? w / b.w : 1;
  const ky = b.h > 0 ? h / b.h : 1;

  switch (a.kind) {
    case 'highlight':
    case 'signature':
      return { ...a, w: Math.max(4, w), h: Math.max(4, h) };
    case 'rect':
    case 'ellipse': {
      // w/h are the outer bounds, border included; keep the top-left pinned.
      const sw = a.strokeWidth;
      return {
        ...a,
        x: b.x + sw / 2,
        y: b.y + sw / 2,
        w: Math.max(4, w - sw),
        h: Math.max(4, h - sw),
      };
    }
    case 'line':
    case 'arrow': {
      // Scale the line's own extent (bounds minus padding) so its end points
      // land at the same relative spots in the new box.
      const pad = linePad(a);
      const innerW = b.w - pad * 2;
      const innerH = b.h - pad * 2;
      const sx = innerW > 0 ? Math.max(0, w - pad * 2) / innerW : 1;
      const sy = innerH > 0 ? Math.max(0, h - pad * 2) / innerH : 1;
      const left = b.x + pad;
      const top = b.y + pad;
      return {
        ...a,
        x: left + (a.x - left) * sx,
        y: top + (a.y - top) * sy,
        dx: a.dx * sx,
        dy: a.dy * sy,
      };
    }
    case 'cross':
    case 'check': {
      const size = Math.max(4, a.size * Math.min(kx, ky));
      // bounds are centred on (x, y), so re-centre to hold the top-left.
      return { ...a, size, x: b.x + size / 2, y: b.y + size / 2 };
    }
    case 'text':
      return { ...a, fontSize: Math.max(4, a.fontSize * kx) };
    case 'pencil':
      return {
        ...a,
        points: a.points.map((p) => ({
          x: b.x + (p.x - b.x) * kx,
          y: b.y + (p.y - b.y) * ky,
        })),
        strokeWidth: Math.max(0.3, a.strokeWidth * Math.min(kx, ky)),
      };
  }
}

/**
 * The one scalar the size slider drives for this kind, or null for the kinds
 * sized purely by their box (highlight, signature) — those use the handle.
 */
export function annotationSize(a: Annotation): number | null {
  switch (a.kind) {
    case 'text':
      return a.fontSize;
    case 'pencil':
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return a.strokeWidth;
    case 'cross':
    case 'check':
      return a.size;
    default:
      return null;
  }
}

export function withAnnotationSize(a: Annotation, value: number): Annotation {
  switch (a.kind) {
    case 'text':
      return { ...a, fontSize: value };
    case 'pencil':
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return { ...a, strokeWidth: value };
    case 'cross':
    case 'check':
      return { ...a, size: value };
    default:
      return a;
  }
}

/** Signatures carry their own colours; everything else has one ink colour. */
export function withAnnotationColor(a: Annotation, color: string): Annotation {
  return a.kind === 'signature' ? a : { ...a, color };
}

/** Set (or clear, with null) a box shape's interior colour. */
export function withAnnotationFill(a: Annotation, fill: string | null): Annotation {
  return isBoxShape(a.kind) ? { ...(a as BoxShapeAnnotation), fill } : a;
}

/** Apply a font family / bold / italic change to a text annotation. */
export function withTextStyle(
  a: Annotation,
  style: Partial<Pick<TextAnnotation, 'font' | 'bold' | 'italic'>>
): Annotation {
  return a.kind === 'text' ? { ...a, ...style } : a;
}
