import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { X, Upload, PenLine, Bookmark, Trash2, Eraser } from 'lucide-react';
import {
  loadSavedSignatures,
  saveSignature,
  deleteSavedSignature,
  trimTransparent,
  whiteToTransparent,
  fileToDataUrl,
} from '../utils/signatureStore';

type Tab = 'upload' | 'draw' | 'saved';

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Receives a PNG/JPEG data URL plus its natural pixel size. */
  onConfirm: (dataUrl: string, width: number, height: number) => void;
}

function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = dataUrl;
  });
}

export default function SignatureModal({ isOpen, onClose, onConfirm }: SignatureModalProps) {
  const [tab, setTab] = useState<Tab>('upload');
  const [preview, setPreview] = useState<string | null>(null);
  const [rawUpload, setRawUpload] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState('');
  // The canvas unmounts while the modal is closed, so track ink in state.
  const [hasInk, setHasInk] = useState(false);

  const inputId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Start each opening clean — a previous signature must never leak into the
  // next use — and pick up saved signatures added since the last open.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSaved(loadSavedSignatures());
    } else {
      setPreview(null);
      setRawUpload(null);
      setError('');
      setRemember(false);
      setHasInk(false);
    }
  }

  // Re-derive the upload preview whenever the background toggle flips.
  useEffect(() => {
    if (!rawUpload) return;
    let cancelled = false;
    (async () => {
      try {
        const processed = removeBackground
          ? await whiteToTransparent(rawUpload)
          : rawUpload;
        if (!cancelled) setPreview(processed);
      } catch {
        if (!cancelled) setError('Could not process that image.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawUpload, removeBackground]);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError('Please choose a PNG or JPG image.');
      return;
    }
    setError('');
    try {
      setRawUpload(await fileToDataUrl(file));
    } catch {
      setError('Could not read that file.');
    }
  }, []);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d')!;
    const p = getCanvasPoint(e);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot, so a single tap leaves a mark.
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    setHasInk(true);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = getCanvasPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const confirmWith = async (dataUrl: string, persist: boolean) => {
    try {
      const { width, height } = await measure(dataUrl);
      if (persist) setSaved(saveSignature(dataUrl));
      onConfirm(dataUrl, width, height);
      onClose();
    } catch {
      setError('Could not use that signature.');
    }
  };

  const handleUse = async () => {
    if (tab === 'draw') {
      if (!hasInk) {
        setError('Draw your signature first.');
        return;
      }
      const trimmed = trimTransparent(canvasRef.current!);
      if (!trimmed) {
        setError('Draw your signature first.');
        return;
      }
      await confirmWith(trimmed, remember);
      return;
    }
    if (!preview) {
      setError('Choose a signature image first.');
      return;
    }
    await confirmWith(preview, remember);
  };

  if (!isOpen) return null;

  return (
    <div className="password-modal-overlay" onClick={onClose}>
      <div
        className="password-modal signature-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-modal-title"
      >
        <div className="password-modal-header">
          <div className="password-modal-title">
            <PenLine size={18} />
            <h3 id="signature-modal-title">Add signature</h3>
          </div>
          <button className="password-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="signature-tabs" role="tablist">
          {(
            [
              ['upload', 'Upload', <Upload size={15} key="u" />],
              ['draw', 'Draw', <PenLine size={15} key="d" />],
              ['saved', `Saved${saved.length ? ` (${saved.length})` : ''}`, <Bookmark size={15} key="s" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`signature-tab ${tab === id ? 'active' : ''}`}
              onClick={() => {
                setTab(id as Tab);
                setError('');
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="password-modal-body">
          {tab === 'upload' && (
            <>
              {/* A real <label for> opens the picker natively. Proxying a
                  click to a display:none input is refused by Safari and some
                  embedded webviews, which left the dialog never opening. */}
              <label
                className="signature-dropzone"
                htmlFor={inputId}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFile(e.dataTransfer.files[0]);
                }}
              >
                <input
                  id={inputId}
                  className="signature-file-input"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {preview ? (
                  <img src={preview} alt="Signature preview" className="signature-preview-img" />
                ) : (
                  <>
                    <Upload size={22} />
                    <span>Click or drop a PNG / JPG of your signature</span>
                  </>
                )}
              </label>
              <label className="signature-check">
                <input
                  type="checkbox"
                  checked={removeBackground}
                  onChange={(e) => setRemoveBackground(e.target.checked)}
                />
                Remove white background
              </label>
            </>
          )}

          {tab === 'draw' && (
            <>
              <div className="signature-pad-wrap">
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={240}
                  className="signature-pad"
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerCancel={endDraw}
                />
                <span className="signature-pad-hint">Sign here</span>
              </div>
              <button className="signature-clear" onClick={clearCanvas}>
                <Eraser size={14} /> Clear
              </button>
            </>
          )}

          {tab === 'saved' && (
            <div className="signature-saved-list">
              {saved.length === 0 && (
                <p className="password-modal-desc">
                  No saved signatures yet. Tick “Remember this signature” when you add one.
                </p>
              )}
              {saved.map((dataUrl, i) => (
                <div className="signature-saved-item" key={i}>
                  <button className="signature-saved-use" onClick={() => confirmWith(dataUrl, false)}>
                    <img src={dataUrl} alt={`Saved signature ${i + 1}`} />
                  </button>
                  <button
                    className="signature-saved-delete"
                    onClick={() => setSaved(deleteSavedSignature(i))}
                    aria-label={`Delete saved signature ${i + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab !== 'saved' && (
            <label className="signature-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember this signature on this device
            </label>
          )}

          {error && <p className="signature-error">{error}</p>}
        </div>

        {tab !== 'saved' && (
          <div className="password-modal-footer">
            <button className="password-skip-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="password-confirm-btn" onClick={handleUse}>
              Place signature
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
