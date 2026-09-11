import { useState, useEffect } from 'react';
import { Lock, X, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  onSkip: () => void;
  isProcessing: boolean;
}

export default function PasswordModal({
  isOpen,
  onClose,
  onConfirm,
  onSkip,
  isProcessing,
}: PasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!password) {
      setError('Please enter a password');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    onConfirm(password);
  };

  return (
    <div className="password-modal-overlay" onClick={onClose}>
      <div
        className="password-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-modal-title"
      >
        <div className="password-modal-header">
          <div className="password-modal-title">
            <Lock size={20} />
            <h3 id="lock-modal-title">Protect PDF with password</h3>
          </div>
          <button className="password-modal-close" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>

        <div className="password-modal-body">
          <p className="password-modal-desc">
            Add a password to protect your downloaded PDF. Anyone opening this
            file will need the password to view it.
          </p>

          <div className="password-field">
            <label htmlFor="lock-password">Password</label>
            <div className="password-input-wrap">
              <input
                id="lock-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter password..."
                autoFocus
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

          <div className="password-field">
            <label htmlFor="lock-password-confirm">Confirm Password</label>
            <div className="password-input-wrap">
              <input
                id="lock-password-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Confirm password..."
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              />
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
          <button className="password-skip-btn" onClick={onSkip} disabled={isProcessing}>
            Download without password
          </button>
          <button
            className="password-confirm-btn"
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="spinning" />
                Processing...
              </>
            ) : (
              <>
                <Lock size={16} />
                Protect & Download
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
