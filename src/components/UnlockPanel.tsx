import { useState, useRef } from 'react';
import { Upload, KeyRound, Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';

interface UnlockPanelProps {
  onUnlocked: (unlockedBuffer: ArrayBuffer, fileName: string) => void;
}

export default function UnlockPanel({ onUnlocked }: UnlockPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
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
    setError('');
    setSuccess(false);

    try {
      // Import qpdf wasm
      const createQPDF = (await import('qpdf-wasm-esm-embedded')).default;
      
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
      setError('An error occurred during decryption. The file may be corrupt or unsupported.');
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
            <label htmlFor="pdf-password">Enter PDF Password</label>
            <div className="unlock-password-row">
              <input
                id="pdf-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="unlock-password-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlock();
                }}
              />
              <button
                className="unlock-submit-btn"
                onClick={handleUnlock}
                disabled={!password || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={16} className="spinning" />
                    Unlocking...
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
