import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCw, AlertCircle, ZoomIn, ZoomOut } from 'lucide-react';
import AnnotationToolbar from './AnnotationToolbar';
import AnnotationLayer from './AnnotationLayer';
import SignatureModal from './SignatureModal';
import SignatureDrawer from './SignatureDrawer';
import { renderPageImage } from '../utils/pdfOperations';
import { describeFailure } from '../utils/lazyModule';
import { unsupportedChars } from '../utils/pdfText';
import {
  loadSavedSignatures,
  deleteSavedSignature,
  measureDataUrl,
} from '../utils/signatureStore';
import {
  INK_COLORS,
  HIGHLIGHT_COLORS,
  DEFAULT_OPACITY,
  opacityOf,
  annotationSize,
  withAnnotationSize,
  withAnnotationColor,
  withAnnotationFill,
  withAnnotationOpacity,
  moveAnnotation,
  isBoxShape,
  isLineShape,
  withTextStyle,
  newAnnotationId,
  type Annotation,
  type AnnotationKind,
  type EditorTool,
  type Point,
  type TextFont,
} from '../utils/annotations';
import type { PageInfo } from '../utils/pdfRenderer';

interface PdfEditorProps {
  pages: PageInfo[];
  onRotate: (id: string) => void;
  /** `commit` false streams a live gesture without adding an undo step. */
  onAnnotationsChange: (pageId: string, annotations: Annotation[], commit: boolean) => void;
  /** Duplicate the current state onto the undo stack before a gesture starts. */
  onCheckpoint: () => void;
  /** Open on this page rather than the first (from a page's Edit button). */
  initialPageId?: string | null;
  /** Bake every page's marks into the page (the toolbar's Save button). */
  onSave: () => void;
  isSaving: boolean;
}

interface RenderedPage {
  url: string;
  width: number;
  height: number;
  pointWidth: number;
  pointHeight: number;
}

/** Render scale — sharp enough to read fine print without blowing up memory. */
const RENDER_SCALE = 2;
/** Signatures are placed at this width in points unless the user resizes. */
const SIGNATURE_WIDTH = 160;
/** Cap on `cacheRef` — each entry is a full-resolution rendered page, so a
 * long document left open all session shouldn't grow this without bound. */
const RENDER_CACHE_LIMIT = 20;

type SizedKind = 'text' | 'pencil' | 'cross' | 'check' | 'rect' | 'ellipse' | 'line' | 'arrow';

const DEFAULT_SIZES: Record<SizedKind, number> = {
  text: 14,
  pencil: 2.5,
  cross: 22,
  check: 22,
  rect: 2,
  ellipse: 2,
  line: 2.5,
  arrow: 2.5,
};

/** Zoom levels the +/- buttons step through, relative to "fit width" (1). */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const SIZED_KINDS = Object.keys(DEFAULT_SIZES) as SizedKind[];

/**
 * Desktop widths get the one-click signature tray; phones keep the signature
 * dialog, where a strip of thumbnails would be cramped. Tracks the viewport so
 * rotating a tablet or resizing the window switches flows live.
 */
const DESKTOP_QUERY = '(min-width: 769px)';
function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  );
}

export default function PdfEditor({
  pages,
  onRotate,
  onAnnotationsChange,
  onCheckpoint,
  initialPageId = null,
  onSave,
  isSaving,
}: PdfEditorProps) {
  const [index, setIndex] = useState(() =>
    Math.max(0, initialPageId ? pages.findIndex((p) => p.id === initialPageId) : 0)
  );
  const [tool, setTool] = useState<EditorTool>('select');
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [shapeColor, setShapeColor] = useState('#2563eb');
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [sizes, setSizes] = useState(DEFAULT_SIZES);
  const [opacities, setOpacities] = useState(DEFAULT_OPACITY);
  const [textFont, setTextFont] = useState<TextFont>('helvetica');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [signatureAt, setSignatureAt] = useState<Point | null>(null);
  // Desktop tray: the dialog can also be opened from the tray's "New" button,
  // with no page position yet — it then just adds to the tray.
  const [addingSignature, setAddingSignature] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<string[]>(loadSavedSignatures);
  const [pickedSignature, setPickedSignature] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const [displayWidth, setDisplayWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(
    () => setZoom((z) => ZOOM_STEPS.find((s) => s > z + 1e-6) ?? z),
    []
  );
  const zoomOut = useCallback(
    () => setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? z),
    []
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, RenderedPage>>(new Map());

  // Pages can be deleted from under us (undo, or the preview modal's delete).
  const safeIndex = Math.min(index, Math.max(0, pages.length - 1));
  const page = pages[safeIndex] as PageInfo | undefined;

  // Zoomed in past 125% the 2× render goes soft, so switch to a sharper one.
  // Two tiers only, so zooming doesn't re-render the page at every step.
  const renderScale = zoom > 1.25 ? RENDER_SCALE * 2 : RENDER_SCALE;
  const cacheKey = page
    ? `${page.fileIndex}:${page.pageIndex}:${page.rotation}@${renderScale}`
    : '';

  useEffect(() => {
    if (!page) return;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setRendered(cached);
      setRenderError('');
      return;
    }

    let cancelled = false;
    setIsRendering(true);
    setRenderError('');
    renderPageImage(page.fileIndex, page.pageIndex, page.rotation, renderScale)
      .then((result) => {
        if (cancelled) return;
        const cache = cacheRef.current;
        if (cache.size >= RENDER_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(cacheKey, result);
        setRendered(result);
      })
      .catch((err) => {
        console.error('Could not render page for editing:', err);
        if (!cancelled) {
          setRenderError(
            describeFailure(err, 'This page could not be opened for editing.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, page, renderScale]);

  // Fit the page to the available width, never upscaling past 1 CSS px per point.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setDisplayWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setDisplayWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!rendered || displayWidth === 0) return null;
    const maxWidth = Math.max(240, displayWidth - 48);
    const width = Math.min(maxWidth, rendered.pointWidth * 1.4) * zoom;
    return { width, height: (width / rendered.pointWidth) * rendered.pointHeight };
  }, [rendered, displayWidth, zoom]);

  const unsavedPages = pages.filter((p) => p.annotations && p.annotations.length > 0).length;
  const handleSave = useCallback(() => {
    setSelectedId(null);
    onSave();
  }, [onSave]);

  // Ctrl/Cmd+S saves the marks into the pages instead of the browser's "Save page".
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (unsavedPages > 0 && !isSaving) handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [unsavedPages, isSaving, handleSave]);

  // Ctrl/Cmd + scroll, and trackpad pinch (which browsers report as a
  // ctrl+wheel), zoom the page. Deltas are pooled so a pinch, which sends a
  // stream of tiny deltas, steps one zoom level at a time.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let pooled = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      pooled += e.deltaY;
      if (Math.abs(pooled) < 40) return;
      if (pooled < 0) zoomIn();
      else zoomOut();
      pooled = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut]);

  // Ctrl/Cmd + '+', '-' and '0' zoom the page instead of the whole browser tab.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomIn, zoomOut]);

  // Memoised so the empty-page fallback doesn't produce a fresh array each
  // render and invalidate every callback below.
  const annotations = useMemo(() => page?.annotations ?? [], [page?.annotations]);

  const change = useCallback(
    (next: Annotation[], commit: boolean) => {
      if (page) onAnnotationsChange(page.id, next, commit);
    },
    [page, onAnnotationsChange]
  );

  const handleCommit = useCallback(
    (a: Annotation) => {
      change([...annotations, a], true);
      setSelectedId(a.id);
    },
    [annotations, change]
  );

  const handleUpdate = useCallback(
    (a: Annotation) => {
      change(
        annotations.map((existing) => (existing.id === a.id ? a : existing)),
        false
      );
    },
    [annotations, change]
  );

  const handleDelete = useCallback(
    (id: string) => {
      change(
        annotations.filter((a) => a.id !== id),
        true
      );
      setSelectedId((current) => (current === id ? null : current));
    },
    [annotations, change]
  );

  // Delete/Backspace removes the selected mark, unless the user is typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDelete(selectedId);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.key.startsWith('Arrow')) {
        // Arrow keys nudge the selected mark 1pt (Shift: 10pt). A held key
        // repeats, but only the first press snapshots for undo.
        const mark = annotations.find((a) => a.id === selectedId);
        if (!mark) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!e.repeat) onCheckpoint();
        handleUpdate(moveAnnotation(mark, dx, dy));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, handleDelete, annotations, handleUpdate, onCheckpoint]);

  /** Drop a signature, centred on `at`. The Sign tool (and its drawer, and the
   * chosen signature) deliberately stay active so several can be placed in a
   * row; the new mark is selected, so it can be dragged or resized right away. */
  const placeSignature = useCallback(
    (at: Point, dataUrl: string, naturalWidth: number, naturalHeight: number) => {
      if (!rendered) return;
      const w = Math.min(SIGNATURE_WIDTH, rendered.pointWidth * 0.6);
      const h = (naturalHeight / naturalWidth) * w;
      handleCommit({
        id: newAnnotationId(),
        kind: 'signature',
        opacity: opacities.signature,
        x: Math.max(0, at.x - w / 2),
        y: Math.max(0, at.y - h / 2),
        w,
        h,
        dataUrl,
      });
    },
    [rendered, handleCommit, opacities.signature]
  );

  // The signature a click on the page will place: the one picked from the tray,
  // else the most recently saved. Derived, so deleting it falls back cleanly.
  const activeSignature =
    pickedSignature && savedSignatures.includes(pickedSignature)
      ? pickedSignature
      : (savedSignatures[0] ?? null);

  const handleRequestSignature = useCallback(
    (at: Point) => {
      if (isDesktop && activeSignature) {
        measureDataUrl(activeSignature)
          .then(({ width, height }) => placeSignature(at, activeSignature, width, height))
          .catch(() => setSignatureAt(at)); // unreadable image — fall back to the dialog
        return;
      }
      setSignatureAt(at);
    },
    [isDesktop, activeSignature, placeSignature]
  );

  const handleSignatureConfirm = useCallback(
    (dataUrl: string, naturalWidth: number, naturalHeight: number) => {
      const at = signatureAt;
      setSignatureAt(null);
      setAddingSignature(false);
      // The dialog may have saved it; pick up the new list and make it the one
      // the next click places.
      setSavedSignatures(loadSavedSignatures());
      setPickedSignature(dataUrl);
      if (at) placeSignature(at, dataUrl, naturalWidth, naturalHeight);
    },
    [signatureAt, placeSignature]
  );

  const handleDeleteSavedSignature = useCallback((i: number) => {
    setSavedSignatures(deleteSavedSignature(i));
  }, []);

  const selected = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId]
  );

  /**
   * The toolbar's options row follows the *selection* when there is one and
   * the active tool otherwise — so selecting a mark reveals its own colour,
   * size and text style, and changing them edits that mark in place. This is
   * how desktop PDF editors behave, and without it a placed mark could only be
   * resized by deleting and re-adding it.
   */
  const editingKind: AnnotationKind | null = selected
    ? selected.kind
    : tool === 'select'
      ? null
      : tool;

  const sizeKeyOf = (kind: AnnotationKind | null): SizedKind | null =>
    SIZED_KINDS.includes(kind as SizedKind) ? (kind as SizedKind) : null;
  const isShapeKind = (kind: AnnotationKind | null) => isBoxShape(kind) || isLineShape(kind);

  const toolbarSizeKey = sizeKeyOf(editingKind);
  const toolbarSize = selected
    ? annotationSize(selected)
    : toolbarSizeKey
      ? sizes[toolbarSizeKey]
      : null;

  const toolbarColor = selected
    ? selected.kind === 'signature'
      ? null
      : selected.color
    : editingKind === 'highlight'
      ? highlightColor
      : isShapeKind(editingKind)
        ? shapeColor
        : editingKind
          ? inkColor
          : null;

  const toolbarFill =
    selected && isBoxShape(selected.kind) && 'fill' in selected ? selected.fill : fillColor;

  const handleFillChange = (value: string | null) => {
    if (selected) handleUpdate(withAnnotationFill(selected, value));
    setFillColor(value);
  };

  const selectedText = selected?.kind === 'text' ? selected : null;
  // Characters the selected (or being-typed) text mark has that the base-14
  // fonts can't draw — warned about here so a download doesn't silently
  // substitute them as the first sign anything changed.
  const unsupportedTextChars = selectedText ? unsupportedChars(selectedText.text) : [];

  // Opacity applies to every kind, so unlike size it has no per-kind gating.
  const toolbarOpacity = selected
    ? opacityOf(selected)
    : editingKind
      ? opacities[editingKind]
      : null;

  const handleOpacityChange = (value: number) => {
    if (selected) handleUpdate(withAnnotationOpacity(selected, value));
    const kind = selected?.kind ?? editingKind;
    if (kind) setOpacities((prev) => ({ ...prev, [kind]: value }));
  };

  const handleSizeChange = (value: number) => {
    if (selected && annotationSize(selected) !== null) {
      handleUpdate(withAnnotationSize(selected, value));
    }
    if (toolbarSizeKey) setSizes((prev) => ({ ...prev, [toolbarSizeKey]: value }));
  };

  const handleColorChange = (value: string) => {
    if (selected) handleUpdate(withAnnotationColor(selected, value));
    if (editingKind === 'highlight') setHighlightColor(value);
    else if (isShapeKind(editingKind)) setShapeColor(value);
    else setInkColor(value);
  };

  const handleTextStyleChange = (style: {
    font?: TextFont;
    bold?: boolean;
    italic?: boolean;
  }) => {
    if (selectedText) handleUpdate(withTextStyle(selectedText, style));
    if (style.font !== undefined) setTextFont(style.font);
    if (style.bold !== undefined) setBold(style.bold);
    if (style.italic !== undefined) setItalic(style.italic);
  };

  if (pages.length === 0 || !page) return null;

  const activeColor =
    tool === 'highlight' ? highlightColor : isShapeKind(tool === 'select' ? null : tool) ? shapeColor : inkColor;
  const activeSizeKey = sizeKeyOf(tool === 'select' ? null : tool);

  return (
    <div className="pdf-editor">
      <AnnotationToolbar
        tool={tool}
        onToolChange={(next) => {
          setTool(next);
          setSelectedId(null);
        }}
        editingKind={editingKind}
        hasSelection={selected !== null}
        color={toolbarColor}
        onColorChange={handleColorChange}
        fill={toolbarFill}
        onFillChange={handleFillChange}
        size={toolbarSize}
        onSizeChange={handleSizeChange}
        opacity={toolbarOpacity}
        onOpacityChange={handleOpacityChange}
        onEditStart={onCheckpoint}
        textFont={selectedText?.font ?? textFont}
        bold={selectedText?.bold ?? bold}
        italic={selectedText?.italic ?? italic}
        onTextStyleChange={handleTextStyleChange}
        hasSignatureDrawer={isDesktop}
        unsavedPages={unsavedPages}
        isSaving={isSaving}
        onSave={handleSave}
      />

      <div className="pdf-editor-body">
        <div className="pdf-editor-rail" role="tablist" aria-label="Pages">
          {pages.map((p, i) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={i === safeIndex}
              className={`pdf-editor-rail-item ${i === safeIndex ? 'active' : ''}`}
              onClick={() => setIndex(i)}
            >
              <img src={p.thumbnail} alt="" style={{ transform: `rotate(${p.rotation}deg)` }} />
              <span>{i + 1}</span>
              {p.annotations && p.annotations.length > 0 && (
                <em className="pdf-editor-rail-badge" aria-label="Has annotations" />
              )}
            </button>
          ))}
        </div>

        <div className="pdf-editor-stage" ref={stageRef}>

          {renderError && (
            <div className="pdf-editor-message error">
              <AlertCircle size={18} />
              {renderError}
            </div>
          )}

          {isRendering && !rendered && (
            <div className="pdf-editor-message">
              <Loader2 size={18} className="spinning" />
              Rendering page…
            </div>
          )}

          {rendered && layout && (
            <div className="pdf-editor-page" style={{ width: layout.width }}>
              <img
                src={rendered.url}
                alt={`Page ${safeIndex + 1}`}
                width={layout.width}
                height={layout.height}
                draggable={false}
              />
              {isRendering && (
                <div className="pdf-editor-page-loading" role="status">
                  <span>
                    <Loader2 size={16} className="spinning" />
                    Rendering page {safeIndex + 1}…
                  </span>
                </div>
              )}
              <AnnotationLayer
                annotations={annotations}
                tool={tool}
                color={activeColor}
                strokeWidth={
                  activeSizeKey && activeSizeKey !== 'pencil' && isShapeKind(activeSizeKey)
                    ? sizes[activeSizeKey]
                    : sizes.pencil
                }
                fill={fillColor}
                fontSize={sizes.text}
                textFont={textFont}
                bold={bold}
                italic={italic}
                markSize={tool === 'check' ? sizes.check : sizes.cross}
                opacity={tool === 'select' ? 1 : opacities[tool]}
                pointWidth={rendered.pointWidth}
                pointHeight={rendered.pointHeight}
                widthPx={layout.width}
                heightPx={layout.height}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCommit={handleCommit}
                onBeginEdit={onCheckpoint}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onRequestSignature={handleRequestSignature}
              />
            </div>
          )}

          <div className="pdf-editor-pagebar">
            <button
              className="pdf-editor-navbtn"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={safeIndex === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="pdf-editor-pagelabel">
              Page {safeIndex + 1} of {pages.length}
            </span>
            <button
              className="pdf-editor-navbtn"
              onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
              disabled={safeIndex === pages.length - 1}
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
            <button
              className="pdf-editor-navbtn"
              onClick={() => onRotate(page.id)}
              title="Rotate page"
              aria-label="Rotate page"
            >
              <RotateCw size={18} />
            </button>
            <span className="pdf-editor-pagebar-divider" aria-hidden="true" />
            <button
              className="pdf-editor-navbtn"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_STEPS[0]}
              title="Zoom out (Ctrl −)"
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <button
              className="pdf-editor-zoomlabel"
              onClick={() => setZoom(1)}
              title="Fit to width (Ctrl 0)"
              aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to fit`}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="pdf-editor-navbtn"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              title="Zoom in (Ctrl +)"
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          {unsupportedTextChars.length > 0 && (
            <p className="pdf-editor-unicode-hint">
              {unsupportedTextChars.slice(0, 5).join(', ')} will be replaced — the built-in PDF
              fonts can't draw them.
            </p>
          )}

          <p className="pdf-editor-hint">
            {tool === 'select'
              ? 'Click a mark to select it — drag to move, Delete to remove, double-click text to edit.'
              : 'Your marks are stamped into the PDF when you hit Download.'}
          </p>
        </div>

        {isDesktop && (
          <SignatureDrawer
            isOpen={tool === 'signature'}
            signatures={savedSignatures}
            activeSignature={activeSignature}
            onPick={setPickedSignature}
            onAdd={() => setAddingSignature(true)}
            onDelete={handleDeleteSavedSignature}
            onClose={() => setTool('select')}
          />
        )}
      </div>

      <SignatureModal
        isOpen={signatureAt !== null || addingSignature}
        onClose={() => {
          setSignatureAt(null);
          setAddingSignature(false);
        }}
        onConfirm={handleSignatureConfirm}
        rememberByDefault={isDesktop}
      />
    </div>
  );
}
