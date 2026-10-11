import {
  CheckSquare,
  Square,
  RotateCw,
  Copy,
  Trash2,
  FilePlus2,
  ArrowDownUp,
} from 'lucide-react';

interface PageToolbarProps {
  totalPages: number;
  selectedCount: number;
  onSelectAll: (select: boolean) => void;
  onRotateSelected: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onInsertBlank: () => void;
  onReverse: () => void;
}

/**
 * Bulk page actions that sit above the page grid. Per-page buttons on each
 * thumbnail are fine for one page but tedious for forty, so everything here
 * acts on the whole selection (or the whole document, for reverse/insert).
 */
export default function PageToolbar({
  totalPages,
  selectedCount,
  onSelectAll,
  onRotateSelected,
  onDuplicateSelected,
  onDeleteSelected,
  onInsertBlank,
  onReverse,
}: PageToolbarProps) {
  const allSelected = totalPages > 0 && selectedCount === totalPages;
  const hasSelection = selectedCount > 0;

  return (
    <div className="page-toolbar" role="toolbar" aria-label="Page actions">
      <button
        type="button"
        className="page-toolbar-btn"
        onClick={() => onSelectAll(!allSelected)}
        title={allSelected ? 'Deselect all pages' : 'Select all pages (Ctrl/⌘+A)'}
      >
        {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
        <span>{allSelected ? 'Clear' : 'Select all'}</span>
      </button>

      <span className={`page-toolbar-count ${hasSelection ? '' : 'idle'}`} aria-live="polite">
        {hasSelection ? `${selectedCount} selected` : 'Click ✓ on a page to select it'}
      </span>

      <div className="page-toolbar-spacer" />

      <button
        type="button"
        className="page-toolbar-btn"
        onClick={onRotateSelected}
        disabled={!hasSelection}
        title="Rotate selected pages 90°"
      >
        <RotateCw size={16} />
        <span>Rotate</span>
      </button>
      <button
        type="button"
        className="page-toolbar-btn"
        onClick={onDuplicateSelected}
        disabled={!hasSelection}
        title="Duplicate selected pages"
      >
        <Copy size={16} />
        <span>Duplicate</span>
      </button>
      <button
        type="button"
        className="page-toolbar-btn danger"
        onClick={onDeleteSelected}
        disabled={!hasSelection}
        title="Delete selected pages (Delete)"
      >
        <Trash2 size={16} />
        <span>Delete</span>
      </button>

      <div className="page-toolbar-divider" />

      <button
        type="button"
        className="page-toolbar-btn"
        onClick={onInsertBlank}
        title={hasSelection ? 'Insert a blank page after the selection' : 'Add a blank page at the end'}
      >
        <FilePlus2 size={16} />
        <span>Blank page</span>
      </button>
      <button
        type="button"
        className="page-toolbar-btn"
        onClick={onReverse}
        disabled={totalPages < 2}
        title="Reverse the page order"
      >
        <ArrowDownUp size={16} />
        <span>Reverse</span>
      </button>
    </div>
  );
}
