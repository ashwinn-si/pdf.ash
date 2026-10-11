import { Droplets, Hash } from 'lucide-react';
import {
  type StampOptions,
  type PageNumberPosition,
  type PageNumberFormat,
  type WatermarkColor,
  type WatermarkLayout,
} from '../utils/pdfStamp';
import { unsupportedChars } from '../utils/pdfText';

interface StampPanelProps {
  options: StampOptions;
  onChange: (options: StampOptions) => void;
  totalPages: number;
}

const COLORS: { id: WatermarkColor; label: string; swatch: string }[] = [
  { id: 'gray', label: 'Gray', swatch: '#737373' },
  { id: 'red', label: 'Red', swatch: '#d91f26' },
  { id: 'blue', label: 'Blue', swatch: '#1a4dcc' },
  { id: 'black', label: 'Black', swatch: '#000000' },
];

const POSITIONS: PageNumberPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const FORMATS: { id: PageNumberFormat; label: (n: number, total: number) => string }[] = [
  { id: 'n', label: (n) => `${n}` },
  { id: 'page-n', label: (n) => `Page ${n}` },
  { id: 'n-of-total', label: (n, total) => `${n} of ${total}` },
];

const LAYOUTS: { id: WatermarkLayout; label: string }[] = [
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'horizontal', label: 'Horizontal' },
];

/** Little page diagram showing where the page number will land. */
function PositionPicker({
  value,
  onChange,
}: {
  value: PageNumberPosition;
  onChange: (p: PageNumberPosition) => void;
}) {
  return (
    <div className="stamp-position-grid" role="radiogroup" aria-label="Page number position">
      {POSITIONS.map((position) => (
        <button
          key={position}
          type="button"
          role="radio"
          aria-checked={value === position}
          aria-label={position.replace('-', ' ')}
          title={position.replace('-', ' ')}
          className={`stamp-position-cell ${position} ${value === position ? 'active' : ''}`}
          onClick={() => onChange(position)}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`stamp-switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="stamp-switch-thumb" />
    </button>
  );
}

export default function StampPanel({ options, onChange, totalPages }: StampPanelProps) {
  const { watermark, pageNumbers } = options;
  const patchWatermark = (patch: Partial<StampOptions['watermark']>) =>
    onChange({ ...options, watermark: { ...watermark, ...patch } });
  const patchNumbers = (patch: Partial<StampOptions['pageNumbers']>) =>
    onChange({ ...options, pageNumbers: { ...pageNumbers, ...patch } });

  const replaced = unsupportedChars(watermark.text);

  return (
    <div className="stamp-panel">
      <section className={`stamp-card ${watermark.enabled ? 'enabled' : ''}`}>
        <header className="stamp-card-header">
          <span className="stamp-card-icon">
            <Droplets size={18} />
          </span>
          <div className="stamp-card-heading">
            <h3>Text watermark</h3>
            <p>Stamp a faint label across every page</p>
          </div>
          <Toggle
            checked={watermark.enabled}
            onChange={(enabled) => patchWatermark({ enabled })}
            label="Add watermark"
          />
        </header>

        {watermark.enabled && (
          <div className="stamp-card-body">
            <label className="stamp-field">
              <span className="stamp-field-label">Text</span>
              <input
                className="split-range-input"
                type="text"
                maxLength={60}
                value={watermark.text}
                placeholder="e.g. DRAFT, CONFIDENTIAL"
                onChange={(e) => patchWatermark({ text: e.target.value })}
              />
              {replaced.length > 0 && (
                <span className="stamp-hint warning">
                  {replaced.join(' ')} can’t be drawn in the PDF font and will be replaced.
                </span>
              )}
            </label>

            <div className="stamp-row">
              <div className="stamp-field">
                <span className="stamp-field-label">Layout</span>
                <div className="stamp-segmented" role="radiogroup" aria-label="Watermark layout">
                  {LAYOUTS.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      role="radio"
                      aria-checked={watermark.layout === layout.id}
                      className={watermark.layout === layout.id ? 'active' : ''}
                      onClick={() => patchWatermark({ layout: layout.id })}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="stamp-field">
                <span className="stamp-field-label">Colour</span>
                <div className="stamp-swatches" role="radiogroup" aria-label="Watermark colour">
                  {COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      role="radio"
                      aria-checked={watermark.color === color.id}
                      aria-label={color.label}
                      title={color.label}
                      className={`stamp-swatch ${watermark.color === color.id ? 'active' : ''}`}
                      style={{ background: color.swatch }}
                      onClick={() => patchWatermark({ color: color.id })}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="stamp-field">
              <span className="stamp-field-label">
                Opacity <strong>{watermark.opacity}%</strong>
              </span>
              <div className="custom-range-wrapper">
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  className="custom-range"
                  value={watermark.opacity}
                  onChange={(e) => patchWatermark({ opacity: parseInt(e.target.value, 10) })}
                  aria-label="Watermark opacity"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={`stamp-card ${pageNumbers.enabled ? 'enabled' : ''}`}>
        <header className="stamp-card-header">
          <span className="stamp-card-icon">
            <Hash size={18} />
          </span>
          <div className="stamp-card-heading">
            <h3>Page numbers</h3>
            <p>Number every page of the finished PDF</p>
          </div>
          <Toggle
            checked={pageNumbers.enabled}
            onChange={(enabled) => patchNumbers({ enabled })}
            label="Add page numbers"
          />
        </header>

        {pageNumbers.enabled && (
          <div className="stamp-card-body">
            <div className="stamp-row">
              <div className="stamp-field">
                <span className="stamp-field-label">Position</span>
                <PositionPicker
                  value={pageNumbers.position}
                  onChange={(position) => patchNumbers({ position })}
                />
              </div>

              <div className="stamp-field stamp-field-grow">
                <span className="stamp-field-label">Format</span>
                <div className="stamp-segmented vertical" role="radiogroup" aria-label="Page number format">
                  {FORMATS.map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      role="radio"
                      aria-checked={pageNumbers.format === format.id}
                      className={pageNumbers.format === format.id ? 'active' : ''}
                      onClick={() => patchNumbers({ format: format.id })}
                    >
                      {format.label(pageNumbers.startAt, pageNumbers.startAt + totalPages - 1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="stamp-row">
              <label className="stamp-field">
                <span className="stamp-field-label">Start at</span>
                <input
                  className="split-range-input stamp-number-input"
                  type="number"
                  min={0}
                  max={9999}
                  value={pageNumbers.startAt}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    patchNumbers({ startAt: Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : 1 });
                  }}
                />
              </label>

              <label className="stamp-check">
                <input
                  type="checkbox"
                  checked={pageNumbers.skipFirstPage}
                  onChange={(e) => patchNumbers({ skipFirstPage: e.target.checked })}
                />
                <span>Skip the first page (cover)</span>
              </label>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
