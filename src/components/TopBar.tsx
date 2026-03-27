import { useState, useEffect } from 'react';
import {
  Upload,
  Undo2,
  Redo2,
  Sun,
  Moon,
  Info,
  X,
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
  customFilename: string;
  onFilenameChange: (name: string) => void;
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
  customFilename,
  onFilenameChange,
}: TopBarProps) {
  const [showToaster, setShowToaster] = useState(false);

  useEffect(() => {
    if (hasPages && !showToaster) {
      // Show toaster when files are first added
      setShowToaster(true);
      const timer = setTimeout(() => setShowToaster(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [hasPages]);

  return (
    <>
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

        {hasPages && (
          <div className="topbar-center">
            <div className="topbar-filename-wrap">
              <input
                type="text"
                className="topbar-filename-input"
                placeholder="Name your file (optional)..."
                value={customFilename}
                onChange={(e) => onFilenameChange(e.target.value)}
              />
            </div>
          </div>
        )}

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

      {/* Notification Toaster */}
      {showToaster && hasPages && (
        <div className="name-notification-toaster">
          <div className="toaster-content">
            <div className="toaster-icon">
              <Info size={18} />
            </div>
            <div className="toaster-text">
              <p>You can <span className="highlight-primary">change the name of your file</span> here see the Navbar</p>
            </div>
            <button className="toaster-close" onClick={() => setShowToaster(false)}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
