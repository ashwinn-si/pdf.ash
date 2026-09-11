import { useState, useRef } from 'react';
import { describeFailure } from '../utils/lazyModule';
import { Upload, KeyRound, Loader2, CheckCircle2, AlertCircle, FileText, Eye, EyeOff } from 'lucide-react';

interface UnlockPanelProps {
  onUnlocked: (unlockedBuffer: ArrayBuffer, fileName: string) => void;
}

export default function UnlockPanel({ onUnlocked }: UnlockPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // The qpdf engine is a ~1.7MB code-split chunk fetched on first use; that
  // wait is long enough that it needs its own label.
  const [phase, setPhase] = useState<'loading' | 'working'>('loading');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && selected.type === 'application/pdf') {
      setFile(selected);
      setError('');
      setSuccess(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type === 'application/pdf') {
      setFile(dropped);
      setError('');
      setSuccess(false);
    }
  };

  const handleUnlock = async () => {
    if (!file || !password) return;

    setIsProcessing(true);
    setPhase('loading');
    setError('');
    setSuccess(false);

    try {
      // Import qpdf wasm
      const createQPDF = (await import('qpdf-wasm-esm-embedded')).default;
      setPhase('working');
      
      const arrayBuffer = await file.arrayBuffer();
      const inputBytes = new Uint8Array(arrayBuffer);
      
      // Initialize QPDF module
      const qpdf: any = await createQPDF({
        print: (text: string) => console.log('QPDF:', text),
        printErr: (text: string) => console.error('QPDF Error:', text),
      });

      // Write to virtual filesystem
      qpdf.FS.writeFile('input.pdf', inputBytes);
      
      try {
        // Execute qpdf command
        qpdf.callMain([
          `--password=${password}`,
          '--decrypt',
          'input.pdf',
          'output.pdf'
        ]);
        
        // Read decrypted file
        const outputBytes = qpdf.FS.readFile('output.pdf');
        const unlockedBuffer = outputBytes.buffer as ArrayBuffer;

        setSuccess(true);

        // Trigger download
        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.replace('.pdf', '_unlocked.pdf');
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 10000);

        onUnlocked(unlockedBuffer, file.name);
      } catch (cmdErr) {
        console.error('QPDF command error:', cmdErr);
        // If decryption fails, the output file won't exist or qpdf will throw
        setError('Incorrect password or failed to decrypt. Please try again.');
      }
    } catch (err: any) {
      console.error('Unlock error:', err);
      setError(
        describeFailure(
          err,
          'An error occurred during decryption. The file may be corrupt or unsupported.'
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="unlock-panel">
      <div className="unlock-panel-header">
        <KeyRound size={24} />
        <div>
          <h3>Unlock PDF</h3>
          <p>Remove password protection from a PDF file</p>
        </div>
      </div>

      <div className="unlock-panel-body">
        {/* File drop zone */}
        <div
          className={`unlock-drop-zone ${file ? 'has-file' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label={file ? `Selected file: ${file.name}. Choose a different file` : 'Drop a locked PDF here or click to browse'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {file ? (
            <div className="unlock-file-info">
              <FileText size={28} />
              <span className="unlock-file-name">{file.name}</span>
              <span className="unlock-file-size">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
          ) : (
            <>
              <Upload size={32} />
              <span>Drop a locked PDF here or click to browse</span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Password input */}
        {file && (
          <div className="unlock-password-section">
            <label htmlFor="pdf-password">Enter PDF password</label>
            <div className="unlock-password-row">
              <div className="password-field-wrap">
                <input
                  id="pdf-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password..."
                  className="unlock-password-input"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUnlock();
                  }}
                />
                <button
                  type="button"
                  className="password-field-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                className="unlock-submit-btn"
                onClick={handleUnlock}
                disabled={!password || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={16} className="spinning" />
                    {phase === 'loading' ? 'Preparing…' : 'Unlocking…'}
                  </>
                ) : (
                  <>
                    <KeyRound size={16} />
                    Unlock & Download
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Status messages */}
        {error && (
          <div className="unlock-message error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {success && (
          <div className="unlock-message success">
            <CheckCircle2 size={16} />
            PDF unlocked successfully! Downloading...
          </div>
        )}
      </div>
    </div>
  );
}
