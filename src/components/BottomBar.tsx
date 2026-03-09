import { Download, Loader2 } from 'lucide-react';
import type { Tool } from './Sidebar';

interface BottomBarProps {
  pageCount: number;
  selectedCount: number;
  activeTool: Tool;
  onProcess: () => void;
  isProcessing: boolean;
  hasPages: boolean;
}

function getActionLabel(tool: Tool, selectedCount: number): string {
  switch (tool) {
    case 'merge':
    case 'rearrange':
      return 'Download PDF';
    case 'split':
      return 'Split & Download';
    case 'compress':
      return 'Compress & Download';
    case 'rotate':
      return selectedCount > 0 ? `Rotate ${selectedCount} Page${selectedCount !== 1 ? 's' : ''}` : 'Select pages to rotate';
    case 'delete':
      return selectedCount > 0 ? `Delete ${selectedCount} Page${selectedCount !== 1 ? 's' : ''}` : 'Select pages to delete';
    case 'convert':
      return 'Convert & Download';
    case 'imageToPdf':
      return 'Download as PDF';
    default:
      return 'Process & Download';
  }
}

export default function BottomBar({
  pageCount,
  selectedCount,
  activeTool,
  onProcess,
  isProcessing,
  hasPages,
}: BottomBarProps) {
  if (!hasPages) return null;

  const isDisabled =
    isProcessing ||
    pageCount === 0 ||
    ((activeTool === 'delete') && selectedCount === 0);

  return (
    <div className="bottombar">
      <div className="bottombar-info">
        <span className="bottombar-stat">
          <strong>{pageCount}</strong> total page{pageCount !== 1 ? 's' : ''}
        </span>
        {selectedCount > 0 && (
          <span className="bottombar-stat">
            <strong>{selectedCount}</strong> selected
          </span>
        )}
      </div>

      <div className="bottombar-actions">
        <button
          className="process-btn"
          onClick={onProcess}
          disabled={isDisabled}
        >
          {isProcessing ? (
            <>
              <Loader2 size={18} className="spinning" />
              Processing...
            </>
          ) : (
            <>
              <Download size={18} />
              {getActionLabel(activeTool, selectedCount)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
