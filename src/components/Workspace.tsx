import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCw, Trash2, GripVertical } from 'lucide-react';
import PageThumbnail, { ThumbnailCard } from './PageThumbnail';
import UploadZone from './UploadZone';
import SplitPanel, { type SplitMode } from './SplitPanel';
import ConvertPanel from './ConvertPanel';
import CompressPanel from './CompressPanel';
import UnlockPanel from './UnlockPanel';
import PdfEditor from './PdfEditor';
import VerifyPanel from './VerifyPanel';
import type { ConvertFormat } from './ConvertPanel';
import type { PageInfo } from '../utils/pdfRenderer';
import type { Annotation } from '../utils/annotations';
import type { Tool } from './Sidebar';
import { renderPageImage } from '../utils/pdfOperations';

/**
 * The grid thumbnail is rendered small (see pdfRenderer's default scale) so
 * hundreds of them stay cheap to keep in memory. Showing that same image in
 * the full-screen preview left it tiny and centred in a lot of empty space.
 * Re-render the page at a much higher scale for the preview instead — the
 * thumbnail is shown immediately as a fallback while the sharper version
 * loads, so opening the preview never looks blank.
 */
const PREVIEW_RENDER_SCALE = 3;

interface WorkspaceProps {
  pages: PageInfo[];
  activeTool: Tool;
  onFilesSelected: (files: File[]) => void;
  onFilesRejected?: (names: string[]) => void;
  onReorder: (event: DragEndEvent) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onMovePage: (id: string, direction: 'left' | 'right') => void;
  splitRange: string;
  onSplitRangeChange: (range: string) => void;
  splitMode: SplitMode;
  onSplitModeChange: (mode: SplitMode) => void;
  convertFormat: ConvertFormat;
  onConvertFormatChange: (format: ConvertFormat) => void;
  compressionQuality: number;
  onCompressionQualityChange: (quality: number) => void;
  acceptImages?: boolean;
  onUnlocked?: (buffer: ArrayBuffer, fileName: string) => void;
  onAnnotationsChange: (pageId: string, annotations: Annotation[], commit: boolean) => void;
  onCheckpoint: () => void;
}

export default function Workspace({
  pages,
  activeTool,
  onFilesSelected,
  onFilesRejected,
  onReorder,
  onRotate,
  onDelete,
  onToggleSelect,
  onMovePage,
  splitRange,
  onSplitRangeChange,
  splitMode,
  onSplitModeChange,
  convertFormat,
  onConvertFormatChange,
  compressionQuality,
  onCompressionQualityChange,
  onUnlocked,
  onAnnotationsChange,
  onCheckpoint,
}: WorkspaceProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState<number | null>(null);
  // Keyed rather than a bare url: lets the render below tell "no hi-res yet
  // for this page" apart from "stale hi-res from the page we just left"
  // without resetting state synchronously inside the effect (react-hooks/
  // set-state-in-effect) every time the previewed page changes.
  const [previewHiRes, setPreviewHiRes] = useState<{ key: string; url: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const openPreview = (index: number) => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setPreviewPageIndex(index);
  };

  const closePreview = () => {
    setPreviewPageIndex(null);
    lastFocusedRef.current?.focus?.();
  };

  // Esc closes the preview modal — user control and freedom (never trap the
  // user in an overlay with no visible or keyboard way out). Arrow keys page
  // through, matching the visible prev/next controls.
  useEffect(() => {
    if (previewPageIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
      } else if (e.key === 'ArrowLeft') {
        setPreviewPageIndex((i) => (i !== null && i > 0 ? i - 1 : i));
      } else if (e.key === 'ArrowRight') {
        setPreviewPageIndex((i) => (i !== null && i < pages.length - 1 ? i + 1 : i));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewPageIndex, pages.length]);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    onChange(mql);
    mql.addEventListener('change', onChange as (e: MediaQueryListEvent) => void);
    return () => mql.removeEventListener('change', onChange as (e: MediaQueryListEvent) => void);
  }, []);

  const canDrag = !isMobile || activeTool === 'rearrange';

  const allSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const noSensors = useSensors();
  const sensors = canDrag ? allSensors : noSensors;

  const previewPage = previewPageIndex !== null ? pages[previewPageIndex] : null;

  const previewKey = previewPage
    ? `${previewPage.fileIndex}:${previewPage.pageIndex}:${previewPage.rotation}`
    : null;

  // Re-render the current preview page at full resolution. `cancelled` stops
  // a slow render for a page the user has already paged past from landing
  // late and overwriting what's now on screen.
  useEffect(() => {
    if (!previewPage || !previewKey) return;
    let cancelled = false;
    renderPageImage(previewPage.fileIndex, previewPage.pageIndex, previewPage.rotation, PREVIEW_RENDER_SCALE)
      .then(({ url }) => {
        if (!cancelled) setPreviewHiRes({ key: previewKey, url });
      })
      .catch(() => {
        // Fall back silently to the grid thumbnail already on screen.
      });
    return () => {
      cancelled = true;
    };
  }, [previewKey, previewPage]);

  const handlePrevPreview = () => {
    if (previewPageIndex !== null && previewPageIndex > 0) {
      setPreviewPageIndex(previewPageIndex - 1);
    }
  };

  const handleNextPreview = () => {
    if (previewPageIndex !== null && previewPageIndex < pages.length - 1) {
      setPreviewPageIndex(previewPageIndex + 1);
    }
  };

  // Verification is about one specific file, not the loaded page set.
  if (activeTool === 'verify') {
    return (
      <div className="workspace">
        <VerifyPanel />
      </div>
    );
  }

  // Unlock tool renders its own dedicated UI
  if (activeTool === 'unlock') {
    return (
      <div className="workspace">
        <UnlockPanel onUnlocked={onUnlocked || (() => { })} />
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="workspace">
        <UploadZone onFilesSelected={onFilesSelected} onFilesRejected={onFilesRejected} />
      </div>
    );
  }

  // The Edit tool needs a full-size page to draw on, so it replaces the grid.
  if (activeTool === 'edit') {
    return (
      <div className="workspace workspace-editor">
        <PdfEditor
          pages={pages}
          onRotate={onRotate}
          onAnnotationsChange={onAnnotationsChange}
          onCheckpoint={onCheckpoint}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      {activeTool === 'split' && (
        <SplitPanel
          totalPages={pages.length}
          selectedCount={pages.filter((p) => p.selected).length}
          splitRange={splitRange}
          onSplitRangeChange={onSplitRangeChange}
          splitMode={splitMode}
          onSplitModeChange={onSplitModeChange}
        />
      )}

      {activeTool === 'convert' && (
        <ConvertPanel
          convertFormat={convertFormat}
          onFormatChange={onConvertFormatChange}
          totalPages={pages.length}
        />
      )}

      {activeTool === 'compress' && (
        <CompressPanel
          compressionQuality={compressionQuality}
          onQualityChange={onCompressionQualityChange}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => {
          setActiveId(e.active.id as string);
        }}
        onDragEnd={(e: DragEndEvent) => {
          setActiveId(null);
          onReorder(e);
        }}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext
          items={pages.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          {isMobile && activeTool === 'rearrange' && (
            <div className="mobile-rearrange-hint">
              <GripVertical size={16} />
              <span>Press &amp; hold to drag pages into new positions</span>
            </div>
          )}
          <div className={`workspace-grid ${isMobile && activeTool === 'rearrange' ? 'rearrange-active' : ''}`}>
            {pages.map((page, index) => (
              <PageThumbnail
                key={page.id}
                page={page}
                index={index}
                activeTool={activeTool}
                onRotate={onRotate}
                onDelete={onDelete}
                onToggleSelect={onToggleSelect}
                onMovePage={onMovePage}
                onClick={() => openPreview(index)}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay zIndex={1000}>
          {activeId ? (() => {
            const activePage = pages.find((p) => p.id === activeId);
            if (!activePage) return null;
            const index = pages.findIndex((p) => p.id === activeId);
            return (
              <ThumbnailCard
                page={activePage}
                index={index}
                activeTool={activeTool}
                onRotate={onRotate}
                onDelete={onDelete}
                onToggleSelect={onToggleSelect}
                onMovePage={onMovePage}
                isOverlay={true}
                style={{ cursor: 'grabbing', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', transform: 'scale(1.05)', rotate: '2deg' }}
              />
            );
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* Preview Modal */}
      {previewPage && (
        <div className="preview-modal" onClick={closePreview}>
          <div className="preview-modal-backdrop" />
          <div
            className="preview-modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
          >
            <div className="preview-modal-header">
              <span className="preview-modal-title" id="preview-modal-title">
                Page {previewPageIndex! + 1} of {pages.length}
              </span>
              <div className="preview-modal-actions">
                <button
                  className="preview-btn"
                  onClick={() => onRotate(previewPage.id)}
                  title="Rotate"
                  aria-label={`Rotate page ${previewPageIndex! + 1}`}
                >
                  <RotateCw size={20} />
                </button>
                <button
                  className="preview-btn danger"
                  onClick={() => {
                    onDelete(previewPage.id);
                    closePreview();
                  }}
                  title="Delete"
                  aria-label={`Delete page ${previewPageIndex! + 1}`}
                >
                  <Trash2 size={20} />
                </button>
                <button
                  className="preview-close"
                  onClick={closePreview}
                  aria-label="Close preview"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="preview-modal-body">
              <button
                className="preview-nav-btn prev"
                onClick={handlePrevPreview}
                disabled={previewPageIndex === 0}
                aria-label="Previous page"
              >
                <ChevronLeft size={32} />
              </button>

              <div className="preview-image-container">
                {/* The grid thumbnail isn't rotated (rotation is a CSS
                    transform in the grid); renderPageImage bakes rotation
                    into the canvas, so only the fallback needs the transform. */}
                {(() => {
                  const hiResUrl = previewHiRes?.key === previewKey ? previewHiRes.url : null;
                  return (
                    <>
                      <img
                        src={hiResUrl ?? previewPage.thumbnail}
                        alt={`Page ${previewPageIndex! + 1}`}
                        style={hiResUrl ? undefined : { transform: `rotate(${previewPage.rotation}deg)` }}
                      />
                      {!hiResUrl && (
                        <div className="preview-image-loading" role="status" aria-live="polite">
                          <span className="preview-image-loading-spinner" />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <button
                className="preview-nav-btn next"
                onClick={handleNextPreview}
                disabled={previewPageIndex === pages.length - 1}
                aria-label="Next page"
              >
                <ChevronRight size={32} />
              </button>
            </div>

            <div className="preview-modal-footer">
              <span className="preview-filename">{previewPage.fileName}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
