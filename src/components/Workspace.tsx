import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { useState } from 'react';
import PageThumbnail, { ThumbnailCard } from './PageThumbnail';
import UploadZone from './UploadZone';
import SplitPanel from './SplitPanel';
import ConvertPanel from './ConvertPanel';
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
  acceptImages?: boolean;
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
}: WorkspaceProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
          <div className="workspace-grid">
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
    </div>
  );
}
