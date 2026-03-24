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
import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCw, Trash2, GripVertical } from 'lucide-react';
import PageThumbnail, { ThumbnailCard } from './PageThumbnail';
import UploadZone from './UploadZone';
import SplitPanel from './SplitPanel';
import ConvertPanel from './ConvertPanel';
import CompressPanel from './CompressPanel';
import UnlockPanel from './UnlockPanel';
import type { ConvertFormat } from './ConvertPanel';
import type { PageInfo } from '../utils/pdfRenderer';
import type { Tool } from './Sidebar';

interface WorkspaceProps {
  pages: PageInfo[];
  activeTool: Tool;
  onFilesSelected: (files: File[]) => void;
  onReorder: (event: DragEndEvent) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onMovePage: (id: string, direction: 'left' | 'right') => void;
  splitRange: string;
  onSplitRangeChange: (range: string) => void;
  splitMode: 'range' | 'individual';
  onSplitModeChange: (mode: 'range' | 'individual') => void;
  convertFormat: ConvertFormat;
  onConvertFormatChange: (format: ConvertFormat) => void;
  compressionQuality: number;
  onCompressionQualityChange: (quality: number) => void;
  acceptImages?: boolean;
  onUnlocked?: (buffer: ArrayBuffer, fileName: string) => void;
}

export default function Workspace({
  pages,
  activeTool,
  onFilesSelected,
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
}: WorkspaceProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

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
        <UploadZone onFilesSelected={onFilesSelected} />
      </div>
    );
  }

  return (
    <div className="workspace">
      {activeTool === 'split' && (
        <SplitPanel
          totalPages={pages.length}
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
                onClick={() => setPreviewPageIndex(index)}
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
        <div className="preview-modal" onClick={() => setPreviewPageIndex(null)}>
          <div className="preview-modal-backdrop" />
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <span className="preview-modal-title">
                Page {previewPageIndex! + 1} of {pages.length}
              </span>
              <div className="preview-modal-actions">
                <button
                  className="preview-btn"
                  onClick={() => onRotate(previewPage.id)}
                  title="Rotate"
                >
                  <RotateCw size={20} />
                </button>
                <button
                  className="preview-btn danger"
                  onClick={() => {
                    onDelete(previewPage.id);
                    setPreviewPageIndex(null);
                  }}
                  title="Delete"
                >
                  <Trash2 size={20} />
                </button>
                <button
                  className="preview-close"
                  onClick={() => setPreviewPageIndex(null)}
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
              >
                <ChevronLeft size={32} />
              </button>

              <div className="preview-image-container">
                <img
                  src={previewPage.thumbnail}
                  alt={`Page ${previewPageIndex! + 1}`}
                  style={{ transform: `rotate(${previewPage.rotation}deg)` }}
                />
              </div>

              <button
                className="preview-nav-btn next"
                onClick={handleNextPreview}
                disabled={previewPageIndex === pages.length - 1}
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
