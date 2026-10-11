import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { PageInfo } from '../utils/pdfRenderer';
import { estimateCompression, formatBytes, type CompressionEstimate } from '../utils/pdfOperations';

interface CompressPanelProps {
  pages: PageInfo[];
  compressionQuality: number;
  onQualityChange: (quality: number) => void;
}

/** Wait for the slider to settle before paying for a real measurement. */
const ESTIMATE_DEBOUNCE_MS = 500;

export default function CompressPanel({
  pages,
  compressionQuality,
  onQualityChange,
}: CompressPanelProps) {
  const getQualityText = (q: number) => {
    if (q >= 85) return 'Max Quality';
    if (q >= 60) return 'Balanced';
    if (q >= 40) return 'Medium';
    return 'Small File';
  };

  // What the estimate depends on: the quality and exactly which pages (in what
  // rotation, with what marks) would be compressed.
  const key = useMemo(
    () =>
      `${compressionQuality}:` +
      pages.map((p) => `${p.id}.${p.rotation}.${p.annotations?.length ?? 0}`).join('|'),
    [pages, compressionQuality]
  );

  // Results are kept by key (not reset when the key changes), so "is there a
  // result for what's on screen?" is a lookup at render rather than state set
  // synchronously in an effect — and moving the slider back to a value already
  // measured is instant.
  const [results, setResults] = useState<Record<string, CompressionEstimate | 'failed'>>({});
  const current = results[key];

  useEffect(() => {
    if (pages.length === 0 || current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      estimateCompression(pages, compressionQuality / 100)
        .then((estimate) => {
          if (!cancelled) setResults((prev) => ({ ...prev, [key]: estimate }));
        })
        .catch(() => {
          if (!cancelled) setResults((prev) => ({ ...prev, [key]: 'failed' }));
        });
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, current, pages, compressionQuality]);

  const estimate = current && current !== 'failed' ? current : undefined;
  const failed = current === 'failed';
  const saved =
    estimate?.before && estimate.before > estimate.after
      ? Math.round((1 - estimate.after / estimate.before) * 100)
      : 0;

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
            aria-label="Compression quality"
            aria-valuetext={`${compressionQuality}% — ${getQualityText(compressionQuality)}`}
          />
        </div>

        <div className="range-value-display">
          <div className="quality-badge">
            <div className="quality-number">{compressionQuality}%</div>
            <div className="quality-text">{getQualityText(compressionQuality)}</div>
          </div>
        </div>

        <div className="compress-estimate" aria-live="polite">
          <div className="compress-estimate-side">
            <span className="compress-estimate-label">Current size</span>
            <span className="compress-estimate-value">
              {estimate?.before ? formatBytes(estimate.before) : '—'}
            </span>
          </div>

          <ArrowRight size={18} className="compress-estimate-arrow" aria-hidden="true" />

          <div className="compress-estimate-side">
            <span className="compress-estimate-label">
              {estimate?.exact === false ? 'Estimated size' : 'New size'}
            </span>
            {estimate ? (
              <span className="compress-estimate-value strong">
                {estimate.exact === false ? '~' : ''}
                {formatBytes(estimate.after)}
              </span>
            ) : failed ? (
              <span className="compress-estimate-value">Unavailable</span>
            ) : (
              <span className="compress-estimate-skeleton" aria-label="Calculating" />
            )}
          </div>

          {estimate && !estimate.alreadyOptimal && saved > 0 && (
            <span className="compress-estimate-pill">{saved}% smaller</span>
          )}
        </div>

        {estimate?.alreadyOptimal && (
          <p className="compress-estimate-note">
            This PDF is already well optimised — compressing at this quality won’t make it
            smaller, so you’ll get the file back as is.
          </p>
        )}
        {estimate && !estimate.alreadyOptimal && estimate.before === undefined && (
          <p className="compress-estimate-note">
            Some pages were removed, so there’s no original size to compare against.
          </p>
        )}
      </div>
    </div>
  );
}
