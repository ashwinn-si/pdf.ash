import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import {
  annotationBounds,
  arrowHeadPoints,
  isBoxShape,
  isLineShape,
  moveAnnotation,
  resizeAnnotation,
  resizesFreely,
  textFontCss,
  newAnnotationId,
  opacityOf,
  type Annotation,
  type BoxShapeKind,
  type LineShapeKind,
  type EditorTool,
  type Point,
  type TextFont,
} from '../utils/annotations';

interface AnnotationLayerProps {
  annotations: Annotation[];
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  textFont: TextFont;
  bold: boolean;
  italic: boolean;
  markSize: number;
  opacity: number;
  /** Interior colour for new rectangles/ellipses, or null for outline only. */
  fill: string | null;
  /** Displayed page box in PDF points — the SVG's viewBox. */
  pointWidth: number;
  pointHeight: number;
  /** Rendered size on screen. */
  widthPx: number;
  heightPx: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Add a finished annotation (one history entry). */
  onCommit: (annotation: Annotation) => void;
  /**
   * Snapshot the current state before a continuous gesture (drag, resize,
   * re-editing text) so the whole gesture collapses into a single undo step.
   */
  onBeginEdit: () => void;
  /** Replace an existing annotation live, without adding an undo step. */
  onUpdate: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
  /** The Sign tool was used at this point — the editor opens the modal. */
  onRequestSignature: (at: Point) => void;
}

type Draft =
  | { kind: 'pencil'; points: Point[] }
  | { kind: 'highlight'; origin: Point; current: Point }
  | { kind: BoxShapeKind; origin: Point; current: Point; constrain: boolean }
  | { kind: LineShapeKind; origin: Point; current: Point; constrain: boolean };

type Gesture =
  | { kind: 'drag'; id: string; origin: Point; original: Annotation }
  | { kind: 'resize'; id: string; origin: Point; original: Annotation; handle: Handle };

/** Which edge(s) a resize handle moves: compass points, like Paint's handles. */
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];
const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Minimum size, in points, a resize can shrink a mark's box to. */
const MIN_RESIZE = 6;

/** Minimum drag, in points, before a highlight is worth keeping. */
const MIN_HIGHLIGHT = 3;

/**
 * The box a shape draft covers. With Shift held it becomes a square (so a
 * rectangle is a square and an ellipse a circle), as in Paint.
 */
function draftBox(origin: Point, current: Point, constrain: boolean) {
  let dx = current.x - origin.x;
  let dy = current.y - origin.y;
  if (constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return {
    x: Math.min(origin.x, origin.x + dx),
    y: Math.min(origin.y, origin.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

/** A line's vector; with Shift held it snaps to the nearest 45°. */
function draftVector(origin: Point, current: Point, constrain: boolean) {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  if (!constrain) return { dx, dy };
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { dx: Math.cos(angle) * len, dy: Math.sin(angle) * len };
}

export default function AnnotationLayer({
  annotations,
  tool,
  color,
  strokeWidth,
  fontSize,
  textFont,
  bold,
  italic,
  markSize,
  opacity,
  fill,
  pointWidth,
  pointHeight,
  widthPx,
  heightPx,
  selectedId,
  onSelect,
  onCommit,
  onBeginEdit,
  onUpdate,
  onDelete,
  onRequestSignature,
}: AnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);

  const scale = widthPx / pointWidth;
  const editing = annotations.find((a) => a.id === editingId && a.kind === 'text') as
    | Extract<Annotation, { kind: 'text' }>
    | undefined;

  // Leaving a tool or page should never strand an open text box or a half-drawn
  // mark. Adjusting during render (rather than in an effect) avoids painting a
  // frame with the stale draft still on screen.
  const sessionKey = `${tool}:${pointWidth}x${pointHeight}`;
  const [lastSessionKey, setLastSessionKey] = useState(sessionKey);
  if (lastSessionKey !== sessionKey) {
    setLastSessionKey(sessionKey);
    setDraft(null);
    setGesture(null);
    setEditingId(null);
  }

  // Grow the editor to fit exactly what has been typed. A hidden mirror span
  // measures the widest line with the same font, which works everywhere —
  // `field-sizing: content` is Chrome-only, and without it a textarea falls
  // back to its default ~20x2 character box.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!box || !mirror || !editing) return;
    mirror.textContent = editing.text || 'Type…';
    const lines = Math.max(1, editing.text.split('\n').length);
    // The box is content-box, so these are the glyph area exactly.
    box.style.width = `${Math.ceil(mirror.offsetWidth) + 1}px`;
    box.style.height = `${Math.ceil(lines * editing.fontSize * scale * 1.2)}px`;
  });

  // Focus on the next frame, not synchronously: the pointerdown that creates a
  // text box is still mid-sequence, and the mousedown default that follows it
  // would move focus to the body — blurring the box and discarding it as empty.
  useEffect(() => {
    if (!editingId) return;
    const raf = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [editingId]);

  const toPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * pointWidth,
      y: ((e.clientY - rect.top) / rect.height) * pointHeight,
    };
  }, [pointWidth, pointHeight]);

  const finishTextEdit = useCallback(() => {
    // Always clear the id, even when the annotation has already gone: leaving it
    // set would make every later pointerdown short-circuit into another
    // "finish" and silently swallow the click.
    if (editing && !editing.text.trim()) onDelete(editing.id);
    setEditingId(null);
  }, [editing, onDelete]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Only the primary button draws; let right-click fall through to the browser.
    if (e.button !== 0) return;
    // Suppress the native text/image selection drag over the page render.
    e.preventDefault();
    if (editingId) {
      finishTextEdit();
      return;
    }
    const p = toPoint(e);

    switch (tool) {
      case 'select':
        onSelect(null);
        break;
      case 'pencil':
        svgRef.current?.setPointerCapture(e.pointerId);
        setDraft({ kind: 'pencil', points: [p] });
        break;
      case 'highlight':
        svgRef.current?.setPointerCapture(e.pointerId);
        setDraft({ kind: 'highlight', origin: p, current: p });
        break;
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow':
        svgRef.current?.setPointerCapture(e.pointerId);
        setDraft({ kind: tool, origin: p, current: p, constrain: e.shiftKey });
        break;
      case 'cross':
      case 'check':
        onCommit({ id: newAnnotationId(), kind: tool, x: p.x, y: p.y, size: markSize, color, opacity });
        break;
      case 'text': {
        const id = newAnnotationId();
        onCommit({
          id,
          kind: 'text',
          x: p.x,
          y: p.y,
          text: '',
          fontSize,
          color,
          font: textFont,
          bold,
          italic,
          opacity,
        });
        setEditingId(id);
        break;
      }
      case 'signature':
        onRequestSignature(p);
        break;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draft && !gesture) return;
    const p = toPoint(e);

    if (draft?.kind === 'pencil') {
      setDraft({ kind: 'pencil', points: [...draft.points, p] });
      return;
    }
    if (draft?.kind === 'highlight') {
      setDraft({ ...draft, current: p });
      return;
    }
    if (draft) {
      setDraft({ ...draft, current: p, constrain: e.shiftKey });
      return;
    }
    if (gesture?.kind === 'drag') {
      onUpdate(moveAnnotation(gesture.original, p.x - gesture.origin.x, p.y - gesture.origin.y));
      return;
    }
    if (gesture?.kind === 'resize') {
      const orig = gesture.original;
      const { handle } = gesture;
      const b = annotationBounds(orig);
      const dx = p.x - gesture.origin.x;
      const dy = p.y - gesture.origin.y;
      // Move only the edges this handle owns; the opposite edges stay put.
      let left = b.x;
      let top = b.y;
      let right = b.x + b.w;
      let bottom = b.y + b.h;
      if (handle.includes('w')) left = Math.min(left + dx, right - MIN_RESIZE);
      if (handle.includes('e')) right = Math.max(right + dx, left + MIN_RESIZE);
      if (handle.includes('n')) top = Math.min(top + dy, bottom - MIN_RESIZE);
      if (handle.includes('s')) bottom = Math.max(bottom + dy, top + MIN_RESIZE);
      const w = right - left;
      let h = bottom - top;
      // Shapes, highlights and lines stretch freely; text, marks and
      // signatures keep their proportions (corner handles only), driven by
      // the horizontal drag.
      if (!resizesFreely(orig)) {
        h = (b.h / b.w) * w;
        if (handle.includes('n')) top = bottom - h;
      }
      // resizeAnnotation pins the top-left of the bounds; shift it into place.
      const resized = resizeAnnotation(orig, w, h);
      const nb = annotationBounds(resized);
      onUpdate(moveAnnotation(resized, left - nb.x, top - nb.y));
    }
  };

  const handlePointerUp = () => {
    if (draft?.kind === 'pencil') {
      if (draft.points.length > 0) {
        onCommit({
          id: newAnnotationId(),
          kind: 'pencil',
          points: draft.points,
          color,
          strokeWidth,
          opacity,
        });
      }
    } else if (draft?.kind === 'highlight') {
      const x = Math.min(draft.origin.x, draft.current.x);
      const y = Math.min(draft.origin.y, draft.current.y);
      const w = Math.abs(draft.current.x - draft.origin.x);
      const h = Math.abs(draft.current.y - draft.origin.y);
      if (w >= MIN_HIGHLIGHT && h >= MIN_HIGHLIGHT) {
        onCommit({ id: newAnnotationId(), kind: 'highlight', x, y, w, h, color, opacity });
      }
    } else if (draft && isBoxShape(draft.kind)) {
      const box = draftBox(draft.origin, draft.current, draft.constrain);
      if (box.w >= MIN_HIGHLIGHT && box.h >= MIN_HIGHLIGHT) {
        onCommit({ id: newAnnotationId(), kind: draft.kind, ...box, color, fill, strokeWidth, opacity });
      }
    } else if (draft && isLineShape(draft.kind)) {
      const v = draftVector(draft.origin, draft.current, draft.constrain);
      if (Math.hypot(v.dx, v.dy) >= MIN_HIGHLIGHT) {
        onCommit({
          id: newAnnotationId(),
          kind: draft.kind,
          x: draft.origin.x,
          y: draft.origin.y,
          ...v,
          color,
          strokeWidth,
          opacity,
        });
      }
    }
    setDraft(null);
    setGesture(null);
  };

  /**
   * A mark is draggable in Select mode, and also while it is the selected one
   * in any mode — so a cross, text box or signature can be nudged into place
   * right after being dropped, without a detour through the Select tool.
   */
  const canDrag = (annotation: Annotation) =>
    tool === 'select' || annotation.id === selectedId;

  const beginDrag = (e: React.PointerEvent, annotation: Annotation) => {
    if (!canDrag(annotation) || e.button !== 0) return;
    e.stopPropagation();
    // Without this the browser starts its own text-selection or image drag,
    // which fires pointercancel and kills the gesture before it moves anything.
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    onSelect(annotation.id);
    onBeginEdit();
    setGesture({ kind: 'drag', id: annotation.id, origin: toPoint(e), original: annotation });
  };

  const renderAnnotation = (a: Annotation) => {
    const interactive = canDrag(a);
    const common = {
      onPointerDown: (e: React.PointerEvent) => beginDrag(e, a),
      onDoubleClick: () => {
        if (a.kind === 'text' && interactive) {
          onBeginEdit();
          setEditingId(a.id);
        }
      },
      style: { cursor: interactive ? 'move' : 'inherit' } as React.CSSProperties,
    };

    switch (a.kind) {
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow':
        return (
          <g key={a.id} {...common}>
            {renderShape(a)}
          </g>
        );
      case 'highlight':
        return (
          <rect
            key={a.id}
            {...common}
            x={a.x}
            y={a.y}
            width={a.w}
            height={a.h}
            fill={a.color}
            opacity={opacityOf(a)}
            style={{ ...common.style, mixBlendMode: 'multiply' }}
          />
        );
      case 'pencil':
        return (
          <polyline
            key={a.id}
            {...common}
            points={a.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            strokeOpacity={opacityOf(a)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'cross': {
        const h = a.size / 2;
        return (
          <g key={a.id} {...common} opacity={opacityOf(a)}>
            <path
              d={`M${a.x - h},${a.y - h} L${a.x + h},${a.y + h} M${a.x + h},${a.y - h} L${a.x - h},${a.y + h}`}
              stroke={a.color}
              strokeWidth={Math.max(1, a.size * 0.12)}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        );
      }
      case 'check': {
        const s = a.size;
        return (
          <g key={a.id} {...common} opacity={opacityOf(a)}>
            <path
              d={`M${a.x - 0.4 * s},${a.y + 0.02 * s} L${a.x - 0.08 * s},${a.y + 0.3 * s} L${a.x + 0.42 * s},${a.y - 0.34 * s}`}
              stroke={a.color}
              strokeWidth={Math.max(1, s * 0.13)}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        );
      }
      case 'text': {
        if (a.id === editingId) return null;
        const lines = a.text.split('\n');
        return (
          <text
            key={a.id}
            {...common}
            x={a.x}
            y={a.y + a.fontSize * 0.82}
            fill={a.color}
            fillOpacity={opacityOf(a)}
            fontSize={a.fontSize}
            fontFamily={textFontCss(a.font)}
            fontWeight={a.bold ? 'bold' : 'normal'}
            fontStyle={a.italic ? 'italic' : 'normal'}
          >
            {lines.map((line, i) => (
              <tspan key={i} x={a.x} dy={i === 0 ? 0 : a.fontSize * 1.2}>
                {line || ' '}
              </tspan>
            ))}
          </text>
        );
      }
      case 'signature':
        return (
          <image
            key={a.id}
            {...common}
            href={a.dataUrl}
            x={a.x}
            y={a.y}
            width={a.w}
            height={a.h}
            opacity={opacityOf(a)}
            preserveAspectRatio="none"
          />
        );
    }
  };

  /** Draft shape, built with the same renderer as a committed one. */
  const draftShape: Annotation | null = (() => {
    if (!draft || draft.kind === 'pencil' || draft.kind === 'highlight') return null;
    if (isBoxShape(draft.kind)) {
      const box = draftBox(draft.origin, draft.current, draft.constrain);
      return { id: 'draft', kind: draft.kind, ...box, color, fill, strokeWidth, opacity };
    }
    return {
      id: 'draft',
      kind: draft.kind,
      x: draft.origin.x,
      y: draft.origin.y,
      ...draftVector(draft.origin, draft.current, draft.constrain),
      color,
      strokeWidth,
      opacity,
    };
  })();

  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const selBounds = selected ? annotationBounds(selected) : null;

  const cursor =
    tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div
      className="annotation-layer"
      style={{ width: widthPx, height: heightPx }}
      onDragStart={(e) => e.preventDefault()}
    >
      <svg
        ref={svgRef}
        className="annotation-svg"
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${pointWidth} ${pointHeight}`}
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {annotations.map(renderAnnotation)}

        {draft?.kind === 'pencil' && draft.points.length > 1 && (
          <polyline
            points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {draftShape && <g pointerEvents="none">{renderShape(draftShape)}</g>}

        {draft?.kind === 'highlight' && (
          <rect
            x={Math.min(draft.origin.x, draft.current.x)}
            y={Math.min(draft.origin.y, draft.current.y)}
            width={Math.abs(draft.current.x - draft.origin.x)}
            height={Math.abs(draft.current.y - draft.origin.y)}
            fill={color}
            opacity={opacity}
          />
        )}

        {selBounds && (
          <rect
            className="annotation-selection"
            x={selBounds.x - 2}
            y={selBounds.y - 2}
            width={selBounds.w + 4}
            height={selBounds.h + 4}
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Selection chrome as HTML so it stays a constant size regardless of zoom. */}
      {selected && selBounds && (
        <>
          <button
            className="annotation-handle delete"
            // Just outside the top-right corner, clear of the corner handle.
            style={{
              left: (selBounds.x + selBounds.w) * scale + 18,
              top: selBounds.y * scale - 18,
            }}
            onClick={() => onDelete(selected.id)}
            aria-label="Delete annotation"
          >
            <Trash2 size={12} />
          </button>
          {(resizesFreely(selected) ? ALL_HANDLES : CORNER_HANDLES).map((handle) => {
            const hx = handle.includes('w')
              ? selBounds.x
              : handle.includes('e')
                ? selBounds.x + selBounds.w
                : selBounds.x + selBounds.w / 2;
            const hy = handle.includes('n')
              ? selBounds.y
              : handle.includes('s')
                ? selBounds.y + selBounds.h
                : selBounds.y + selBounds.h / 2;
            return (
              <button
                key={handle}
                className={`annotation-handle resize handle-${handle}`}
                style={{ left: hx * scale, top: hy * scale, cursor: HANDLE_CURSOR[handle] }}
                aria-label={`Resize annotation (${handle})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  onBeginEdit();
                  setGesture({
                    kind: 'resize',
                    id: selected.id,
                    origin: toPoint(e),
                    original: selected,
                    handle,
                  });
                }}
                onPointerMove={(e) =>
                  handlePointerMove(e as unknown as React.PointerEvent<SVGSVGElement>)
                }
                onPointerUp={handlePointerUp}
              />
            );
          })}
        </>
      )}

      {editing && (
        <>
          <span
            ref={mirrorRef}
            className="annotation-text-mirror"
            aria-hidden="true"
            style={{
              fontSize: editing.fontSize * scale,
              fontFamily: textFontCss(editing.font),
              fontWeight: editing.bold ? 'bold' : 'normal',
              fontStyle: editing.italic ? 'italic' : 'normal',
              lineHeight: 1.2,
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            className="annotation-text-input"
            value={editing.text}
            style={{
              left: editing.x * scale,
              top: editing.y * scale,
              fontSize: editing.fontSize * scale,
              fontFamily: textFontCss(editing.font),
              fontWeight: editing.bold ? 'bold' : 'normal',
              fontStyle: editing.italic ? 'italic' : 'normal',
              lineHeight: 1.2,
              color: editing.color,
              caretColor: editing.color,
            }}
            onChange={(e) => onUpdate({ ...editing, text: e.target.value })}
            onBlur={finishTextEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                finishTextEdit();
              }
              // Enter commits; Shift+Enter adds a line.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishTextEdit();
              }
              e.stopPropagation();
            }}
            placeholder="Type…"
          />
        </>
      )}
    </div>
  );
}

/**
 * SVG for a rectangle, ellipse, line or arrow. An unfilled box still gets a
 * transparent fill so it can be grabbed anywhere inside, and a line gets a
 * wide invisible stroke beneath it so a hairline is easy to hit.
 */
function renderShape(a: Annotation) {
  const op = opacityOf(a);
  if (a.kind === 'rect' || a.kind === 'ellipse') {
    const paint = {
      fill: a.fill ?? 'transparent',
      fillOpacity: a.fill ? op : 0,
      stroke: a.strokeWidth > 0 ? a.color : 'none',
      strokeOpacity: op,
      strokeWidth: a.strokeWidth,
    };
    return a.kind === 'rect' ? (
      <rect x={a.x} y={a.y} width={a.w} height={a.h} {...paint} />
    ) : (
      <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} {...paint} />
    );
  }
  if (a.kind === 'line' || a.kind === 'arrow') {
    const end = { x: a.x + a.dx, y: a.y + a.dy };
    let d = `M${a.x},${a.y} L${end.x},${end.y}`;
    if (a.kind === 'arrow') {
      const [b1, b2] = arrowHeadPoints(a);
      d += ` M${b1.x},${b1.y} L${end.x},${end.y} L${b2.x},${b2.y}`;
    }
    return (
      <>
        <path d={d} stroke="transparent" strokeWidth={Math.max(10, a.strokeWidth + 8)} fill="none" />
        <path
          d={d}
          stroke={a.color}
          strokeOpacity={op}
          strokeWidth={a.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </>
    );
  }
  return null;
}
