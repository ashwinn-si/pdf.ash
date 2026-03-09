import { Image, FileText } from 'lucide-react';

export type ConvertFormat = 'png' | 'jpg' | 'txt';

interface ConvertPanelProps {
  convertFormat: ConvertFormat;
  onFormatChange: (format: ConvertFormat) => void;
  totalPages: number;
}

const formats: { id: ConvertFormat; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'png', label: 'PNG Images', description: 'High quality, transparent background', icon: <Image size={18} /> },
  { id: 'jpg', label: 'JPG Images', description: 'Smaller file size, great for sharing', icon: <Image size={18} /> },
  { id: 'txt', label: 'Plain Text', description: 'Extract all text content', icon: <FileText size={18} /> },
];

export default function ConvertPanel({ convertFormat, onFormatChange, totalPages }: ConvertPanelProps) {
  return (
    <div className="split-panel">
      <h3>Convert PDF to...</h3>
      <div className="convert-format-grid">
        {formats.map((fmt) => (
          <button
            key={fmt.id}
            className={`convert-format-card ${convertFormat === fmt.id ? 'active' : ''}`}
            onClick={() => onFormatChange(fmt.id)}
          >
            <div className="convert-format-icon">{fmt.icon}</div>
            <div className="convert-format-info">
              <span className="convert-format-label">{fmt.label}</span>
              <span className="convert-format-desc">{fmt.description}</span>
            </div>
          </button>
        ))}
      </div>
      <p className="convert-hint">
        {convertFormat === 'txt'
          ? `Will extract text from all ${totalPages} page${totalPages !== 1 ? 's' : ''} into a single .txt file`
          : `Will generate ${totalPages} ${convertFormat.toUpperCase()} image${totalPages !== 1 ? 's' : ''} (one per page)`
        }
      </p>
    </div>
  );
}
