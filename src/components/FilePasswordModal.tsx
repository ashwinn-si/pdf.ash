import { useState, useEffect } from 'react';
import { Lock, X, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

interface FilePasswordModalProps {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  onConfirm: (password: string) => void;
  isProcessing: boolean;
  error?: string;
}

export default function FilePasswordModal({
  isOpen,
  fileName,
  onClose,
  onConfirm,
  isProcessing,
  error: externalError,
}: FilePasswordModalProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [internalError, setInternalError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Start clean every time this opens, and again if a second locked file
  // replaces the first while the modal stays open — otherwise the next
  // file's password field would carry over the previous one's value/error.
  // Adjusted during render, matching the pattern SignatureModal uses.
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [lastFileName, setLastFileName] = useState(fileName);
  if (wasOpen !== isOpen || lastFileName !== fileName) {
    setWasOpen(isOpen);
    setLastFileName(fileName);
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setInternalError('');
    }
  }

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!password) {
      setInternalError('Please enter a password');
      return;
    }
    setInternalError('');
    onConfirm(password);
  };

  const error = externalError || internalError;

  return (
    <div className="password-modal-overlay" onClick={onClose}>
      <div
        className="password-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-password-modal-title"
      >
        <div className="password-modal-header">
          <div className="password-modal-title">
            <Lock size={20} />
            <h3 id="file-password-modal-title">Password-protected file</h3>
          </div>
          <button className="password-modal-close" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>

        <div className="password-modal-body">
          <p className="password-modal-desc">
            The file <strong>{fileName}</strong> is password protected. 
            Please provide the password to load it.
          </p>

          <div className="password-field">
            <label htmlFor="file-password">Enter Password</label>
            <div className="password-input-wrap">
              <input
                id="file-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setInternalError(''); }}
                placeholder="Enter password..."
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              />
              <button
                type="button"
                className="password-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="password-error" role="alert">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="password-modal-footer">
          <button className="password-skip-btn" onClick={onClose} disabled={isProcessing}>
            Cancel
          </button>
          <button
            className="password-confirm-btn"
            onClick={handleConfirm}
            disabled={isProcessing || !password}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="spinning" />
                Unlocking...
              </>
            ) : (
              <>
                <Lock size={16} />
                Open File
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
