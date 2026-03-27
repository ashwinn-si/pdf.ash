import { useState, useCallback, useRef, useEffect } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import { FileText } from 'lucide-react';
import Sidebar, { type Tool } from './components/Sidebar';
import TopBar from './components/TopBar';
import Workspace from './components/Workspace';
import BottomBar from './components/BottomBar';
import ProgressOverlay from './components/ProgressOverlay';
import PasswordModal from './components/PasswordModal';
import FilePasswordModal from './components/FilePasswordModal';
import { Analytics } from '@vercel/analytics/react';
import {
  storeFileBuffer,
  buildPdf,
  splitPdf,
  compressPdf,
  parseRanges,
  downloadFile,
  downloadMultipleFiles,
  convertPdfToImages,
  convertPdfToText,
  imageToPdfBuffer,
  lockPdfBytes,
} from './utils/pdfOperations';
import {
  createInitialHistory,
  pushState,
  undo as historyUndo,
  redo as historyRedo,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type HistoryState,
} from './utils/historyManager';

import './App.css';

import type { ConvertFormat } from './components/ConvertPanel';
import { renderPdfThumbnails, type PageInfo } from './utils/pdfRenderer';
import { sendAnalytics } from './utils/analytics';

function App() {
  const [activeTool, setActiveTool] = useState<Tool>('merge');
  const [history, setHistory] = useState<HistoryState>(createInitialHistory([]));
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [splitRange, setSplitRange] = useState('');
  const [splitMode, setSplitMode] = useState<'range' | 'individual'>('range');
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>('png');
  const [compressionQuality, setCompressionQuality] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; fileIndex: number }[]>([]);
  const [filePasswordError, setFilePasswordError] = useState('');
  const [isDecryptingFile, setIsDecryptingFile] = useState(false);

  const fileCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Send analytics when component mounts
  useEffect(() => {
    sendAnalytics();
  }, []);

  const pages = history.present;

  const updatePages = useCallback((newPages: PageInfo[]) => {
    setHistory(prev => pushState(prev, newPages));
  }, []);

  const handleUndo = useCallback(() => {
    setHistory(prev => historyUndo(prev));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory(prev => historyRedo(prev));
  }, []);

  // File upload handler
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      setIsLoading(true);
      const lockedFiles: { file: File; fileIndex: number }[] = [];
      try {
        const newPages: PageInfo[] = [...pages];

        for (const file of files) {
          const fileIndex = fileCountRef.current++;

          let buffer: ArrayBuffer;
          if (file.type.startsWith('image/')) {
            buffer = await imageToPdfBuffer(file);
          } else {
            buffer = await file.arrayBuffer();
          }

          storeFileBuffer(fileIndex, buffer);

          // Render thumbnails from the PDF buffer (whether originally PDF or converted from image)
          const blob = new Blob([buffer], { type: 'application/pdf' });
          const pdfFile = new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.pdf', {
            type: 'application/pdf',
          });

          try {
            const thumbnails = await renderPdfThumbnails(pdfFile, fileIndex);
            newPages.push(...thumbnails);
          } catch (err: any) {
            if (err.name === 'PasswordException') {
              lockedFiles.push({ file: pdfFile, fileIndex });
            } else {
              throw err;
            }
          }
        }

        updatePages(newPages);

        if (lockedFiles.length > 0) {
          setPendingFiles(prev => [...prev, ...lockedFiles]);
        }
      } catch (err) {
        console.error('Error loading PDFs:', err);
        alert('Error loading PDF files. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [pages, updatePages]
  );

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file && validTypes.includes(file.type)) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) {
        handleFilesSelected(files);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFilesSelected]);

  const handleFilePasswordConfirm = useCallback(
    async (password: string) => {
      if (pendingFiles.length === 0) return;

      const current = pendingFiles[0];
      setIsDecryptingFile(true);
      setFilePasswordError('');

      try {
        const thumbnails = await renderPdfThumbnails(
          current.file,
          current.fileIndex,
          0.5,
          password
        );
        // Wait for the state update or just use the current present
        setHistory(prev => pushState(prev, [...prev.present, ...thumbnails]));
        setPendingFiles(prev => prev.slice(1));
      } catch (err: any) {
        if (err.name === 'PasswordException') {
          setFilePasswordError('Incorrect password. Please try again.');
        } else {
          setFilePasswordError('Failed to load the file. It may be corrupt.');
        }
      } finally {
        setIsDecryptingFile(false);
      }
    },
    [pendingFiles]
  );

  const handleFilePasswordClose = useCallback(() => {
    setPendingFiles(prev => prev.slice(1));
    setFilePasswordError('');
  }, []);

  // Drag end handler for reordering
  const handleReorder = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = pages.findIndex(p => p.id === active.id);
        const newIndex = pages.findIndex(p => p.id === over.id);
        const newPages = arrayMove(pages, oldIndex, newIndex);
        updatePages(newPages);
      }
    },
    [pages, updatePages]
  );

  // Rotate a page by 90°
  const handleRotate = useCallback(
    (id: string) => {
      const newPages = pages.map(p =>
        p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      );
      updatePages(newPages);
    },
    [pages, updatePages]
  );

  // Delete a page
  const handleDelete = useCallback(
    (id: string) => {
      const newPages = pages.filter(p => p.id !== id);
      updatePages(newPages);
    },
    [pages, updatePages]
  );

  // Toggle page selection
  const handleToggleSelect = useCallback(
    (id: string) => {
      const newPages = pages.map(p => (p.id === id ? { ...p, selected: !p.selected } : p));
      updatePages(newPages);
    },
    [pages, updatePages]
  );

  // Move a page manually (for mobile view where DND is disabled)
  const handleMovePage = useCallback(
    (id: string, direction: 'left' | 'right') => {
      const index = pages.findIndex(p => p.id === id);
      if (index === -1) return;

      let newIndex = index;
      if (direction === 'left' && index > 0) {
        newIndex = index - 1;
      } else if (direction === 'right' && index < pages.length - 1) {
        newIndex = index + 1;
      }

      if (newIndex !== index) {
        const newPages = arrayMove(pages, index, newIndex);
        updatePages(newPages);
      }
    },
    [pages, updatePages]
  );

  // Add more files
  const handleAddFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        handleFilesSelected(files);
      }
      e.target.value = '';
    },
    [handleFilesSelected]
  );

  // Toggle dark mode
  const handleToggleTheme = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);
  const [customFilename, setCustomFilename] = useState('');

  // Process button handler
  const handleProcess = useCallback(
    async (password?: string) => {
      if (pages.length === 0) return;

      setIsProcessing(true);
      setProgress(0);

      try {
        switch (activeTool) {
          case 'merge':
          case 'rearrange':
          case 'imageToPdf':
          case 'compress': {
            let data =
              activeTool === 'compress'
                ? await compressPdf(pages, compressionQuality / 100, setProgress)
                : await buildPdf(pages, setProgress);

            if (password) {
              data = await lockPdfBytes(data, password);
            }

            let filename = customFilename.trim();
            if (filename) {
              if (!filename.toLowerCase().endsWith('.pdf')) {
                filename += '.pdf';
              }
            } else {
              filename =
                activeTool === 'compress'
                  ? 'compressed.pdf'
                  : activeTool === 'merge'
                    ? 'merged.pdf'
                    : activeTool === 'imageToPdf'
                      ? 'converted_images.pdf'
                      : 'rearranged.pdf';
            }
            downloadFile(data, filename);
            break;
          }

          case 'split': {
            let ranges: number[][];
            if (splitMode === 'individual') {
              ranges = pages.map((_, i) => [i]);
            } else {
              ranges = parseRanges(splitRange, pages.length);
              if (ranges.length === 0) {
                alert('Please enter valid page ranges (e.g., "1-3, 4-6")');
                setIsProcessing(false);
                return;
              }
            }
            const files = await splitPdf(pages, ranges, setProgress);
            // If custom filename is provided, use it as a prefix for split files
            const prefix = customFilename.trim() || 'split';
            const renamedFiles = files.map((f, i) => ({
              ...f,
              name: customFilename.trim() ? `${prefix}_${i + 1}.pdf` : f.name
            }));
            await downloadMultipleFiles(renamedFiles);
            break;
          }

          case 'convert': {
            const filenameValue = customFilename.trim();
            if (convertFormat === 'txt') {
              const txtFilename = filenameValue
                ? (filenameValue.toLowerCase().endsWith('.txt') ? filenameValue : `${filenameValue}.txt`)
                : 'extracted_text.txt';
              await convertPdfToText(pages, txtFilename, setProgress);
            } else {
              await convertPdfToImages(pages, convertFormat, filenameValue, setProgress);
            }
            break;
          }
        }
      } catch (err) {
        console.error('Processing error:', err);
        alert('An error occurred during processing. Please try again.');
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    },
    [pages, activeTool, splitMode, splitRange, convertFormat, compressionQuality, customFilename]
  );

  // Process button handler – for merge/rearrange, show password modal first
  const handleProcessClick = useCallback(() => {
    if (pages.length === 0) return;

    // For merge, rearrange, imageToPdf – offer password protection
    if (['merge', 'rearrange', 'imageToPdf'].includes(activeTool)) {
      setShowPasswordModal(true);
      return;
    }

    // For other tools, process directly
    handleProcess();
  }, [pages.length, activeTool, handleProcess]);

  // Handle password-protected download
  const handlePasswordConfirm = useCallback(
    async (password: string) => {
      setShowPasswordModal(false);
      handleProcess(password);
    },
    [handleProcess]
  );

  // Handle download without password
  const handlePasswordSkip = useCallback(() => {
    setShowPasswordModal(false);
    handleProcess();
  }, [handleProcess]);

  // Unlock handler
  const handleUnlocked = useCallback((_buffer: ArrayBuffer, _fileName: string) => {
    // The UnlockPanel handles the download itself.
    // Optionally, we could load the unlocked PDF into the workspace here.
  }, []);

  const selectedCount = pages.filter(p => p.selected).length;

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current++;
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDraggingFile(false);
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
      setIsDraggingFile(false);
      dragCounter.current = 0;

      const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
      const files = Array.from(e.dataTransfer.files).filter(f => validTypes.includes(f.type));
      if (files.length > 0) {
        handleFilesSelected(files);
      }
    },
    [handleFilesSelected]
  );

  return (
    <div
      className="app-layout"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Analytics />
      <Sidebar
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        pageCount={pages.length}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="app-main">
        <TopBar
          onAddFiles={handleAddFiles}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={historyCanUndo(history)}
          canRedo={historyCanRedo(history)}
          pageCount={pages.length}
          selectedCount={selectedCount}
          isDarkMode={isDarkMode}
          onToggleTheme={handleToggleTheme}
          hasPages={pages.length > 0}
          customFilename={customFilename}
          onFilenameChange={setCustomFilename}
        />

        <Workspace
          pages={pages}
          activeTool={activeTool}
          onFilesSelected={handleFilesSelected}
          onReorder={handleReorder}
          onRotate={handleRotate}
          onDelete={handleDelete}
          onToggleSelect={handleToggleSelect}
          onMovePage={handleMovePage}
          splitRange={splitRange}
          onSplitRangeChange={setSplitRange}
          splitMode={splitMode}
          onSplitModeChange={setSplitMode}
          convertFormat={convertFormat}
          onConvertFormatChange={setConvertFormat}
          compressionQuality={compressionQuality}
          onCompressionQualityChange={setCompressionQuality}
          acceptImages={activeTool === 'imageToPdf'}
          onUnlocked={handleUnlocked}
        />

        {activeTool !== 'unlock' && (
          <BottomBar
            pageCount={pages.length}
            selectedCount={selectedCount}
            activeTool={activeTool}
            onProcess={handleProcessClick}
            isProcessing={isProcessing}
            hasPages={pages.length > 0}
          />
        )}
      </div>

      {/* Hidden file input for "Add Files" button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Loading overlay for initial file upload */}
      {isLoading && <ProgressOverlay progress={50} message="Loading PDF pages..." />}

      {/* Processing overlay */}
      {isProcessing && <ProgressOverlay progress={progress} />}

      {/* Global Drag Overlay */}
      {isDraggingFile && (
        <div className="global-drop-overlay">
          <div className="global-drop-content">
            <div className="upload-zone-icon dragging">
              <FileText size={48} />
            </div>
            <h2>Drop files to add</h2>
          </div>
        </div>
      )}

      {/* Password Modal */}
      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onConfirm={handlePasswordConfirm}
        onSkip={handlePasswordSkip}
        isProcessing={isProcessing}
      />

      <FilePasswordModal
        isOpen={pendingFiles.length > 0}
        fileName={pendingFiles[0]?.file.name || ''}
        onClose={handleFilePasswordClose}
        onConfirm={handleFilePasswordConfirm}
        isProcessing={isDecryptingFile}
        error={filePasswordError}
      />
    </div>
  );
}

export default App;
