import { useState, useRef, useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';
import { isValidFile, ACCEPT_ATTRIBUTE } from '../utils/pdfOperations';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  onFilesRejected?: (names: string[]) => void;
}

export default function UploadZone({ onFilesSelected, onFilesRejected }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current++;
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      const allFiles = Array.from(e.dataTransfer.files);
      const files = allFiles.filter(isValidFile);
      if (files.length > 0) {
        onFilesSelected(files);
      }
      const rejected = allFiles.filter((f) => !isValidFile(f));
      if (rejected.length > 0) {
        onFilesRejected?.(rejected.map((f) => f.name));
      }
    },
    [onFilesSelected, onFilesRejected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        onFilesSelected(files);
      }
      // Reset input to allow re-uploading the same file
      e.target.value = '';
    },
    [onFilesSelected]
  );

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />

      <div className="upload-zone-icon">
        {isDragging ? <FileText size={36} /> : <Upload size={36} />}
      </div>

      <h2>{isDragging ? 'Drop your files here' : 'Upload Files'}</h2>
      <p>Drag and drop or click to browse your files</p>

      <button
        className="upload-zone-btn"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
      >
        <Upload size={18} />
        Select Files
      </button>

      <div className="upload-zone-formats">
        Supports PDF, JPG/JFIF, PNG, WebP, Markdown • Multiple files allowed
      </div>
    </div>
  );
}
