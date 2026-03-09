interface ProgressOverlayProps {
  progress: number;
  message?: string;
}

export default function ProgressOverlay({
  progress,
  message = 'Processing your PDF...',
}: ProgressOverlayProps) {
  return (
    <div className="progress-overlay">
      <div className="progress-card">
        <div className="spinner-container">
          <div className="custom-spinner"></div>
        </div>
        <h3>Processing</h3>
        <p>{message}</p>
        <div className="progress-bar-container">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="progress-percentage">{progress}%</div>
      </div>
    </div>
  );
}
