// React is not needed since Vite handles JSX automatically

interface CompressPanelProps {
  compressionQuality: number;
  onQualityChange: (quality: number) => void;
}

export default function CompressPanel({
  compressionQuality,
  onQualityChange,
}: CompressPanelProps) {
  return (
    <div className="split-panel">
      <h3>Compression Quality</h3>
      <div className="split-panel-options" style={{ padding: '0 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span>Lower Quality (Smaller File)</span>
          <span>Higher Quality (Larger File)</span>
        </div>
        <input
          type="range"
          min="10"
          max="100"
          step="5"
          value={compressionQuality}
          onChange={(e) => onQualityChange(parseInt(e.target.value, 10))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div style={{ textAlign: 'center', marginTop: '0.5rem', fontWeight: 500 }}>
          {compressionQuality}% Quality
        </div>
      </div>
    </div>
  );
}
