import { useEffect } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';

export interface ToastData {
  id: number;
  kind: 'error' | 'notice';
  message: string;
  /** Extra lines shown under the message, e.g. one per failed file. */
  details?: string[];
}

interface ToastProps extends ToastData {
  onDismiss: () => void;
}

/** How long a notice stays before dismissing itself. Errors stay until the
 * user closes them or a new toast replaces them — they need to be read. */
const NOTICE_LIFETIME_MS = 6000;

export default function Toast({ kind, message, details, onDismiss }: ToastProps) {
  useEffect(() => {
    if (kind !== 'notice') return;
    const timer = setTimeout(onDismiss, NOTICE_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [kind, onDismiss]);

  return (
    <div className={`app-toast app-toast--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="toaster-content">
        <div className="toaster-icon">
          {kind === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
        </div>
        <div className="toaster-text">
          <p>{message}</p>
          {details && details.length > 0 && (
            <ul className="toast-detail-list">
              {details.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        <button className="toaster-close" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
