import {
  Upload,
  Undo2,
  Redo2,
  Sun,
  Moon,
} from 'lucide-react';

interface TopBarProps {
  onAddFiles: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pageCount: number;
  selectedCount: number;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  hasPages: boolean;
}

export default function TopBar({
  onAddFiles,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  pageCount,
  selectedCount,
  isDarkMode,
  onToggleTheme,
  hasPages,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {hasPages && (
          <>
            <button className="topbar-btn primary" onClick={onAddFiles}>
              <Upload size={16} />
              Add Files
            </button>
            <div className="topbar-divider" />
            <button
              className="topbar-btn"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="topbar-btn"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo"
            >
              <Redo2 size={16} />
            </button>
          </>
        )}
      </div>

      <div className="topbar-right">
        {hasPages && (
          <span className="topbar-page-count">
            <strong>{pageCount}</strong> page{pageCount !== 1 ? 's' : ''}
            {selectedCount > 0 && (
              <> · <strong>{selectedCount}</strong> selected</>
            )}
          </span>
        )}
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
