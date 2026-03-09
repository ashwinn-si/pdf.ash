import { useState, useRef, useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  acceptImages?: boolean;
}

export default function UploadZone({ onFilesSelected, acceptImages = false }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
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

      const validTypes = acceptImages
        ? ['image/png', 'image/jpeg', 'image/jpg']
        : ['application/pdf'];
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => validTypes.includes(f.type)
      );
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [onFilesSelected]
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
        accept={acceptImages ? '.jpg,.jpeg,.png' : '.pdf'}
        multiple
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />

      <div className="upload-zone-icon">
        {isDragging ? <FileText size={36} /> : <Upload size={36} />}
      </div>

      <h2>{isDragging ? (acceptImages ? 'Drop your images here' : 'Drop your PDFs here') : (acceptImages ? 'Upload Images' : 'Upload PDF Files')}</h2>
      <p>Drag and drop or click to browse your files</p>

      <button
        className="upload-zone-btn"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
      >
        <Upload size={18} />
        {acceptImages ? 'Select Images' : 'Select PDF Files'}
      </button>

      <div className="upload-zone-formats">
        {acceptImages
          ? 'Supports .jpg, .jpeg, .png files • Multiple files allowed'
          : 'Supports .pdf files • Multiple files allowed'
        }
      </div>
    </div>
  );
}
