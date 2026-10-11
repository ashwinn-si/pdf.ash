import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, ShieldCheck, Undo2, Lock, ClipboardPaste } from 'lucide-react';
import { isValidFile, ACCEPT_ATTRIBUTE } from '../utils/pdfOperations';
import type { Tool } from './Sidebar';

/** Per-tool headline so the empty screen says what the chosen tool will do. */
const TOOL_COPY: Partial<Record<Tool, { title: string; hint: string }>> = {
  merge: { title: 'Merge & arrange', hint: 'Drop PDFs, images or Markdown files — anything non-PDF is converted — then drag pages into the order you want.' },
  split: { title: 'Split a PDF', hint: 'Drop a PDF to cut it by page range, into single pages, or extract a selection.' },
  compress: { title: 'Compress a PDF', hint: 'Drop a PDF to shrink it for email or the web.' },
  convert: { title: 'Convert a PDF', hint: 'Drop a PDF to turn its pages into PNG, JPG or plain text.' },
  stamp: { title: 'Watermark & number pages', hint: 'Drop a PDF to add a text watermark and page numbers.' },
};

const TRUST_POINTS = [
  { icon: <ShieldCheck size={14} />, text: 'Files never leave your device' },
  { icon: <Undo2 size={14} />, text: 'Undo & redo every change' },
  { icon: <Lock size={14} />, text: 'AES-256 password option' },
];

interface UploadZoneProps {
  activeTool?: Tool;
  onFilesSelected: (files: File[]) => void;
  onFilesRejected?: (names: string[]) => void;
}

export default function UploadZone({ activeTool, onFilesSelected, onFilesRejected }: UploadZoneProps) {
  const copy = (activeTool && TOOL_COPY[activeTool]) || { title: 'Upload Files', hint: 'Drag and drop or click to browse your files' };
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

      <h2>{isDragging ? 'Drop your files here' : copy.title}</h2>
      <p>{copy.hint}</p>

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

      <ul className="upload-zone-trust" aria-label="Privacy and safety">
        {TRUST_POINTS.map((point) => (
          <li key={point.text}>
            {point.icon}
            {point.text}
          </li>
        ))}
      </ul>

      <div className="upload-zone-paste">
        <ClipboardPaste size={13} />
        You can also paste files with Ctrl/⌘+V
      </div>
    </div>
  );
}
