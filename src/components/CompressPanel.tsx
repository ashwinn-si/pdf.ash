// React is not needed since Vite handles JSX automatically

interface CompressPanelProps {
  compressionQuality: number;
  onQualityChange: (quality: number) => void;
}

export default function CompressPanel({
  compressionQuality,
  onQualityChange,
}: CompressPanelProps) {
  const getQualityText = (q: number) => {
    if (q >= 85) return 'Max Quality';
    if (q >= 60) return 'Balanced';
    if (q >= 40) return 'Medium';
    return 'Small File';
  };

  return (
    <div className="split-panel">
      <h3>Compression Quality</h3>
      
      <div className="range-container">
        <div className="range-labels">
          <div className="range-label-item">
            <span className="range-label-title">Small File</span>
            <span className="range-label-desc">Best for web</span>
          </div>
          <div className="range-label-item" style={{ textAlign: 'right' }}>
            <span className="range-label-title">High Quality</span>
            <span className="range-label-desc">Best for print</span>
          </div>
        </div>

        <div className="custom-range-wrapper">
          <input
            type="range"
            min="10"
            max="95" // 100% usually doesn't compress much, 95% is a better max
            step="5"
            className="custom-range"
            value={compressionQuality}
            onChange={(e) => onQualityChange(parseInt(e.target.value, 10))}
          />
        </div>

        <div className="range-value-display">
          <div className="quality-badge">
            <div className="quality-number">{compressionQuality}%</div>
            <div className="quality-text">{getQualityText(compressionQuality)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
