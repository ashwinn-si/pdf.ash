interface SplitPanelProps {
  totalPages: number;
  splitRange: string;
  onSplitRangeChange: (range: string) => void;
  splitMode: 'range' | 'individual';
  onSplitModeChange: (mode: 'range' | 'individual') => void;
}

export default function SplitPanel({
  totalPages,
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
            name="splitMode"
            checked={splitMode === 'range'}
            onChange={() => onSplitModeChange('range')}
          />
          <label>Split by page ranges</label>
        </div>

        {splitMode === 'range' && (
          <input
            className="split-range-input"
            type="text"
            placeholder={`e.g. 1-3, 4-${totalPages} (total: ${totalPages} pages)`}
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
            name="splitMode"
            checked={splitMode === 'individual'}
            onChange={() => onSplitModeChange('individual')}
          />
          <label>Split into individual pages ({totalPages} files)</label>
        </div>
      </div>
    </div>
  );
}
