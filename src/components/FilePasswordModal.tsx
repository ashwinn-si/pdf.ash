import { useState } from 'react';
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
      <div className="password-modal" onClick={(e) => e.stopPropagation()}>
        <div className="password-modal-header">
          <div className="password-modal-title">
            <Lock size={20} />
            <h3>Password Protected File</h3>
          </div>
          <button className="password-modal-close" onClick={onClose}>
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
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="password-error">
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
