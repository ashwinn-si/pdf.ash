import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCw, AlertCircle } from 'lucide-react';
import AnnotationToolbar from './AnnotationToolbar';
import AnnotationLayer from './AnnotationLayer';
import SignatureModal from './SignatureModal';
import { renderPageImage } from '../utils/pdfOperations';
import {
  INK_COLORS,
  HIGHLIGHT_COLORS,
  annotationSize,
  withAnnotationSize,
  withAnnotationColor,
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

const DEFAULT_SIZES: Record<'text' | 'pencil' | 'cross' | 'check', number> = {
  text: 14,
  pencil: 2.5,
  cross: 22,
  check: 22,
};

export default function PdfEditor({
  pages,
  onRotate,
  onAnnotationsChange,
  onCheckpoint,
}: PdfEditorProps) {
  const [index, setIndex] = useState(0);
  const [tool, setTool] = useState<EditorTool>('select');
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [sizes, setSizes] = useState(DEFAULT_SIZES);
  const [textFont, setTextFont] = useState<TextFont>('helvetica');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [signatureAt, setSignatureAt] = useState<Point | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, RenderedPage>>(new Map());

  // Pages can be deleted from under us (undo, or the preview modal's delete).
  const safeIndex = Math.min(index, Math.max(0, pages.length - 1));
  const page = pages[safeIndex] as PageInfo | undefined;

  const cacheKey = page ? `${page.fileIndex}:${page.pageIndex}:${page.rotation}` : '';

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
    renderPageImage(page.fileIndex, page.pageIndex, page.rotation, RENDER_SCALE)
      .then((result) => {
        if (cancelled) return;
        cacheRef.current.set(cacheKey, result);
        setRendered(result);
      })
      .catch((err) => {
        console.error('Could not render page for editing:', err);
        if (!cancelled) setRenderError('This page could not be opened for editing.');
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, page]);

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
    const width = Math.min(maxWidth, rendered.pointWidth * 1.4);
    return { width, height: (width / rendered.pointWidth) * rendered.pointHeight };
  }, [rendered, displayWidth]);

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, handleDelete]);

  const handleSignatureConfirm = useCallback(
    (dataUrl: string, naturalWidth: number, naturalHeight: number) => {
      const at = signatureAt;
      setSignatureAt(null);
      if (!at || !rendered) return;
      const w = Math.min(SIGNATURE_WIDTH, rendered.pointWidth * 0.6);
      const h = (naturalHeight / naturalWidth) * w;
      handleCommit({
        id: newAnnotationId(),
        kind: 'signature',
        // Drop it centred on the click, so it lands where the user aimed.
        x: Math.max(0, at.x - w / 2),
        y: Math.max(0, at.y - h / 2),
        w,
        h,
        dataUrl,
      });
      setTool('select');
    },
    [signatureAt, rendered, handleCommit]
  );

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

  const sizeKeyOf = (kind: AnnotationKind | null): keyof typeof sizes | null =>
    kind === 'text' || kind === 'pencil' || kind === 'cross' || kind === 'check' ? kind : null;

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
      : editingKind
        ? inkColor
        : null;

  const selectedText = selected?.kind === 'text' ? selected : null;

  const handleSizeChange = (value: number) => {
    if (selected && annotationSize(selected) !== null) {
      handleUpdate(withAnnotationSize(selected, value));
    }
    if (toolbarSizeKey) setSizes((prev) => ({ ...prev, [toolbarSizeKey]: value }));
  };

  const handleColorChange = (value: string) => {
    if (selected) handleUpdate(withAnnotationColor(selected, value));
    if (editingKind === 'highlight') setHighlightColor(value);
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

  const activeColor = tool === 'highlight' ? highlightColor : inkColor;

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
        size={toolbarSize}
        onSizeChange={handleSizeChange}
        onEditStart={onCheckpoint}
        textFont={selectedText?.font ?? textFont}
        bold={selectedText?.bold ?? bold}
        italic={selectedText?.italic ?? italic}
        onTextStyleChange={handleTextStyleChange}
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
          </div>

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
              <AnnotationLayer
                annotations={annotations}
                tool={tool}
                color={activeColor}
                strokeWidth={sizes.pencil}
                fontSize={sizes.text}
                textFont={textFont}
                bold={bold}
                italic={italic}
                markSize={tool === 'check' ? sizes.check : sizes.cross}
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
                onRequestSignature={setSignatureAt}
              />
            </div>
          )}

          <p className="pdf-editor-hint">
            {tool === 'select'
              ? 'Click a mark to select it — drag to move, Delete to remove, double-click text to edit.'
              : 'Your marks are stamped into the PDF when you hit Download.'}
          </p>
        </div>
      </div>

      <SignatureModal
        isOpen={signatureAt !== null}
        onClose={() => setSignatureAt(null)}
        onConfirm={handleSignatureConfirm}
      />
    </div>
  );
}
