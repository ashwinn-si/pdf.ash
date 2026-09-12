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
  | 'signature';

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

export type Annotation =
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
  return a.kind === 'highlight';
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

/** Apply a font family / bold / italic change to a text annotation. */
export function withTextStyle(
  a: Annotation,
  style: Partial<Pick<TextAnnotation, 'font' | 'bold' | 'italic'>>
): Annotation {
  return a.kind === 'text' ? { ...a, ...style } : a;
}
