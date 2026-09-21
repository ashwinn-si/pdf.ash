export type SplitMode = 'range' | 'individual' | 'selected';

interface SplitPanelProps {
  totalPages: number;
  /** How many pages are currently selected — the "Extract selected" option
   * only makes sense, and only shows, once there's something selected. */
  selectedCount: number;
  splitRange: string;
  onSplitRangeChange: (range: string) => void;
  splitMode: SplitMode;
  onSplitModeChange: (mode: SplitMode) => void;
}

export default function SplitPanel({
  totalPages,
  selectedCount,
  splitRange,
  onSplitRangeChange,
  splitMode,
  onSplitModeChange,
}: SplitPanelProps) {
  return (
    <div className="split-panel">
      <h3>Split PDF Options</h3>
      <div className="split-panel-options">
        <div
          className={`split-option ${splitMode === 'range' ? 'active' : ''}`}
          onClick={() => onSplitModeChange('range')}
        >
          <input
            type="radio"
            id="split-mode-range"
            name="splitMode"
            checked={splitMode === 'range'}
            onChange={() => onSplitModeChange('range')}
          />
          <label htmlFor="split-mode-range">Split by page ranges</label>
        </div>

        {splitMode === 'range' && (
          <input
            className="split-range-input"
            type="text"
            placeholder={`e.g. 1-3, 4-${totalPages} (total: ${totalPages} pages)`}
            aria-label="Page ranges to split"
            value={splitRange}
            onChange={(e) => onSplitRangeChange(e.target.value)}
          />
        )}

        <div
          className={`split-option ${splitMode === 'individual' ? 'active' : ''}`}
          onClick={() => onSplitModeChange('individual')}
        >
          <input
            type="radio"
            id="split-mode-individual"
            name="splitMode"
            checked={splitMode === 'individual'}
            onChange={() => onSplitModeChange('individual')}
          />
          <label htmlFor="split-mode-individual">Split into individual pages ({totalPages} files)</label>
        </div>

        {selectedCount > 0 && (
          <div
            className={`split-option ${splitMode === 'selected' ? 'active' : ''}`}
            onClick={() => onSplitModeChange('selected')}
          >
            <input
              type="radio"
              id="split-mode-selected"
              name="splitMode"
              checked={splitMode === 'selected'}
              onChange={() => onSplitModeChange('selected')}
            />
            <label htmlFor="split-mode-selected">Extract selected pages ({selectedCount})</label>
          </div>
        )}
      </div>
    </div>
  );
}
