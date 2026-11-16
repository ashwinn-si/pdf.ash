import { RotateCw, Trash2, Check, PenLine } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { PageInfo } from '../utils/pdfRenderer';
import type { Tool } from './Sidebar';

interface PageThumbnailProps {
  page: PageInfo;
  index: number;
  activeTool: Tool;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onMovePage: (id: string, direction: 'left' | 'right') => void;
  /** Open this page in the Edit tool. */
  onEdit?: (id: string) => void;
  onClick?: (e: React.MouseEvent) => void;
  /** When pages come from several files, tag each with its source file. */
  showFileTag?: boolean;
}


export function ThumbnailCard({
  page,
  index,
  activeTool,
  onRotate,
  onDelete,
  onToggleSelect,
  onEdit,
  style,
  isDragging,
  isOverlay,
  setNodeRef,
  attributes,
  listeners,
  onClick,
  showFileTag,
}: PageThumbnailProps & {
  style?: React.CSSProperties;
  isDragging?: boolean;
  isOverlay?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
}) {
  // Selection drives the bulk actions in the page toolbar, so every grid tool
  // offers it — not just Split.
  const showCheckbox = activeTool !== 'edit';
  const fileHue = ((page.sourceFileIndex ?? page.fileIndex) * 67) % 360;
  const unsavedMarks = page.annotations?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      className={`page-thumbnail animate-slide-up ${page.selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isOverlay ? 'overlay' : ''}`}
      style={{ ...style, ['--file-hue' as string]: fileHue }}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {showCheckbox && (
        <button
          className="page-thumbnail-checkbox"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(page.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={page.selected ? `Deselect page ${index + 1}` : `Select page ${index + 1}`}
          aria-pressed={page.selected}
        >
          {page.selected && <Check size={14} />}
        </button>
      )}

      <div className="page-thumbnail-canvas-wrap">
        <img
          src={page.thumbnail}
          alt={`Page ${index + 1}`}
          style={{
            transform: `rotate(${page.rotation}deg)`,
          }}
          draggable={false}
        />
      </div>

      {showFileTag && (
        <div className="page-thumbnail-file" title={page.fileName}>
          <span className="page-thumbnail-file-dot" />
          <span className="page-thumbnail-file-name">{page.fileName}</span>
        </div>
      )}

      <div className="page-thumbnail-footer">
        <span className="page-thumbnail-label">
          Page {index + 1}
          {unsavedMarks > 0 && onEdit && (
            <button
              className="page-thumbnail-unsaved"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(page.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="This page has marks that aren't saved into it yet. They're still included when you download — open the editor and press Save to see them here."
            >
              Unsaved edits
            </button>
          )}
        </span>
        <div className="page-thumbnail-actions">
          {onEdit && (
            <button
              className="page-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(page.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Edit this page"
              aria-label={`Edit page ${index + 1}`}
            >
              <PenLine size={14} />
            </button>
          )}
          <button
            className="page-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRotate(page.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Rotate 90°"
            aria-label={`Rotate page ${index + 1}`}
          >
            <RotateCw size={14} />
          </button>
          <button
            className="page-action-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(page.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Delete page"
            aria-label={`Delete page ${index + 1}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PageThumbnail(props: PageThumbnailProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1, // Hide the original item when dragging
  };

  return (
    <ThumbnailCard
      {...props}
      style={style}
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      attributes={attributes}
      listeners={listeners}
    />
  );
}
