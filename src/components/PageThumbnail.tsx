import { RotateCw, Trash2, Check } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
}


export function ThumbnailCard({
  page,
  index,
  activeTool,
  onRotate,
  onDelete,
  onToggleSelect,
  style,
  isDragging,
  isOverlay,
  setNodeRef,
  attributes,
  listeners,
}: PageThumbnailProps & {
  style?: React.CSSProperties;
  isDragging?: boolean;
  isOverlay?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  attributes?: any;
  listeners?: any;
}) {
  const showCheckbox = activeTool === 'split';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`page-thumbnail animate-slide-up ${page.selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isOverlay ? 'overlay' : ''}`}
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

      <div className="page-thumbnail-footer">
        <span className="page-thumbnail-label">
          Page {index + 1}
        </span>
        <div className="page-thumbnail-actions">
          <button
            className="page-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRotate(page.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Rotate 90°"
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

  const showMobileDragControls = props.activeTool === 'rearrange';

  return (
    <ThumbnailCard
      {...props}
      style={style}
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      attributes={showMobileDragControls ? undefined : attributes}
      listeners={showMobileDragControls ? undefined : listeners}
    />
  );
}
