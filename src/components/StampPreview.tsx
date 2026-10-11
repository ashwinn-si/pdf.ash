import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Loader2 } from 'lucide-react';
import type { PageInfo } from '../utils/pdfRenderer';
import { renderPageImage } from '../utils/pdfOperations';
import {
  hasStampWork,
  layoutStamps,
  loadStampFonts,
  stampStart,
  type StampFonts,
  type StampOptions,
} from '../utils/pdfStamp';

interface StampPreviewProps {
  pages: PageInfo[];
  options: StampOptions;
}

/** Resolution the page is drawn at behind the stamps — crisp without being heavy. */
const PREVIEW_RENDER_SCALE = 1.5;

type BaseImage =
  | { key: string; img: HTMLImageElement; pointWidth: number; pointHeight: number }
  | { key: string; failed: true };

/** Rendered pages kept so flicking back and forth between them is instant.
 * Each is a full-resolution bitmap, so the cache stays small. */
const BASE_CACHE_LIMIT = 6;

/**
 * A live page with the watermark and page numbers drawn on it. The positions,
 * sizes, colours and text all come from `layoutStamps` — the same function the
 * download uses — so the preview can't drift from the real output.
 */
export default function StampPreview({ pages, options }: StampPreviewProps) {
  const [index, setIndex] = useState(0);
  const [cache, setCache] = useState<BaseImage[]>([]);
  const [fonts, setFonts] = useState<StampFonts | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const safeIndex = Math.min(index, Math.max(0, pages.length - 1));
  const page = pages[safeIndex] as PageInfo | undefined;
  const key = page ? `${page.fileIndex}:${page.pageIndex}:${page.rotation}` : '';
  const base = cache.find((entry) => entry.key === key) ?? null;
  const cached = base !== null;

  useEffect(() => {
    let cancelled = false;
    loadStampFonts().then((f) => {
      if (!cancelled) setFonts(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Render the underlying page (rotation included) once per page, not per option change.
  useEffect(() => {
    if (!page || cached) return;
    const remember = (entry: BaseImage) =>
      setCache((prev) => [...prev.filter((e) => e.key !== entry.key), entry].slice(-BASE_CACHE_LIMIT));
    let cancelled = false;
    renderPageImage(page.fileIndex, page.pageIndex, page.rotation, PREVIEW_RENDER_SCALE)
      .then(async ({ url, pointWidth, pointHeight }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (!cancelled) remember({ key, img, pointWidth, pointHeight });
      })
      .catch(() => {
        if (!cancelled) remember({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, page, cached]);

  // Redraw on every option change — cheap, since the page image is already loaded.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fonts || !base || 'failed' in base) return;
    const { img, pointWidth, pointHeight } = base;
    const k = img.naturalWidth / pointWidth; // canvas pixels per PDF point
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    for (const mark of layoutStamps(pointWidth, pointHeight, safeIndex, pages.length, options, fonts)) {
      const start = stampStart(mark, fonts);
      ctx.save();
      // PDF space has y pointing up and angles counter-clockwise; canvas is the opposite.
      ctx.translate(start.x * k, (pointHeight - start.y) * k);
      ctx.rotate((-mark.angle * Math.PI) / 180);
      ctx.globalAlpha = mark.opacity;
      ctx.fillStyle = `rgb(${mark.color.map((c) => Math.round(c * 255)).join(',')})`;
      ctx.font = `${mark.font === 'bold' ? 'bold ' : ''}${mark.size * k}px Helvetica, Arial, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(mark.text, 0, 0);
      ctx.restore();
    }
  }, [base, fonts, options, safeIndex, pages.length]);

  if (!page) return null;

  const loading = !fonts || !base;
  const failed = base !== null && 'failed' in base;
  const nothingOn = !hasStampWork(options);

  return (
    <section className="stamp-preview" aria-label="Preview">
      <header className="stamp-preview-header">
        <span className="stamp-card-icon">
          <Eye size={18} />
        </span>
        <div className="stamp-card-heading">
          <h3>Preview</h3>
          <p>Updates as you change the options</p>
        </div>
        <div className="stamp-preview-nav">
          <button
            type="button"
            onClick={() => setIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span aria-live="polite">
            {safeIndex + 1} / {pages.length}
          </span>
          <button
            type="button"
            onClick={() => setIndex(Math.min(pages.length - 1, safeIndex + 1))}
            disabled={safeIndex === pages.length - 1}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div className="stamp-preview-stage">
        {failed ? (
          <p className="stamp-preview-note">This page couldn’t be previewed.</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="stamp-preview-canvas"
            style={{ visibility: loading ? 'hidden' : 'visible' }}
            role="img"
            aria-label={`Page ${safeIndex + 1} with the watermark and page numbers applied`}
          />
        )}
        {loading && !failed && (
          <div className="stamp-preview-loading" role="status">
            <Loader2 size={20} className="spinning" />
          </div>
        )}
      </div>

      {nothingOn && (
        <p className="stamp-preview-note">
          Turn on a watermark (with some text) or page numbers to see them here.
        </p>
      )}
    </section>
  );
}
