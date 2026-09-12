import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import {
  annotationBounds,
  moveAnnotation,
  resizeAnnotation,
  resizesFreely,
  textFontCss,
  newAnnotationId,
  opacityOf,
  type Annotation,
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
  | { kind: 'highlight'; origin: Point; current: Point };

type Gesture =
  | { kind: 'drag'; id: string; origin: Point; original: Annotation }
  | { kind: 'resize'; id: string; origin: Point; original: Annotation };

/** Minimum drag, in points, before a highlight is worth keeping. */
const MIN_HIGHLIGHT = 3;

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
    if (gesture?.kind === 'drag') {
      onUpdate(moveAnnotation(gesture.original, p.x - gesture.origin.x, p.y - gesture.origin.y));
      return;
    }
    if (gesture?.kind === 'resize') {
      const orig = gesture.original;
      const b = annotationBounds(orig);
      const w = Math.max(6, b.w + (p.x - gesture.origin.x));
      // Only a highlight stretches; the rest keep their proportions so a cross
      // stays square and a signature is never squashed.
      const h = resizesFreely(orig)
        ? Math.max(4, b.h + (p.y - gesture.origin.y))
        : (b.h / b.w) * w;
      onUpdate(resizeAnnotation(orig, w, h));
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
            style={{
              left: (selBounds.x + selBounds.w) * scale,
              top: (selBounds.y - 2) * scale,
            }}
            onClick={() => onDelete(selected.id)}
            aria-label="Delete annotation"
          >
            <Trash2 size={12} />
          </button>
          <button
            className="annotation-handle resize"
            style={{
              left: (selBounds.x + selBounds.w) * scale,
              top: (selBounds.y + selBounds.h) * scale,
            }}
            aria-label="Resize annotation"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              onBeginEdit();
              setGesture({
                kind: 'resize',
                id: selected.id,
                origin: toPoint(e),
                original: selected,
              });
            }}
            onPointerMove={(e) =>
              handlePointerMove(e as unknown as React.PointerEvent<SVGSVGElement>)
            }
            onPointerUp={handlePointerUp}
          />
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
