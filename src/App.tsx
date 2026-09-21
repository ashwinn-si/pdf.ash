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
import Toast, { type ToastData } from './components/Toast';
import { Analytics } from '@vercel/analytics/react';
import {
  storeFileBuffer,
  getFileBuffer,
  buildPdf,
  splitPdf,
  extractPages,
  compressPdf,
  parseRanges,
  downloadFile,
  downloadFilesOrZip,
  convertPdfToImages,
  convertPdfToText,
  imageToPdfBuffer,
  lockPdfBytes,
  isValidFile,
  isPdfFile,
  isImageFile,
  isMarkdownFile,
  sniffFileKind,
  describeLoadError,
  ACCEPT_ATTRIBUTE,
} from './utils/pdfOperations';
import { markdownToPdfBuffer } from './utils/markdownToPdf';
import { decryptPdfBytes } from './utils/qpdf';
import {
  createInitialHistory,
  pushState,
  undo as historyUndo,
  redo as historyRedo,
  replacePresent,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type HistoryState,
} from './utils/historyManager';

import './App.css';

import type { ConvertFormat } from './components/ConvertPanel';
import type { SplitMode } from './components/SplitPanel';
import { renderPdfThumbnails, type PageInfo } from './utils/pdfRenderer';
import type { Annotation } from './utils/annotations';
import { sendAnalytics } from './utils/analytics';

/** A file the upload flow could not add, for the failure toast. */
interface UploadFailure {
  fileName: string;
  reason: string;
}

function App() {
  const [activeTool, setActiveTool] = useState<Tool>('merge');
  const [history, setHistory] = useState<HistoryState>(createInitialHistory([]));
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [splitRange, setSplitRange] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('range');
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>('png');
  const [compressionQuality, setCompressionQuality] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ message: 'Loading files…', percent: 0 });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; fileIndex: number }[]>([]);
  const [filePasswordError, setFilePasswordError] = useState('');
  const [isDecryptingFile, setIsDecryptingFile] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const fileCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const toastIdRef = useRef(0);

  // Send analytics when component mounts
  useEffect(() => {
    sendAnalytics();
  }, []);

  const pages = history.present;
  const selectedCount = pages.filter(p => p.selected).length;

  const showToast = useCallback((kind: ToastData['kind'], message: string, details?: string[]) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, kind, message, details });
  }, []);

  const showFailureToast = useCallback(
    (failures: UploadFailure[]) => {
      if (failures.length === 0) return;
      if (failures.length === 1) {
        showToast('error', `${failures[0].fileName} — ${failures[0].reason}`);
      } else {
        showToast(
          'error',
          `${failures.length} files couldn't be added`,
          failures.map(f => `${f.fileName} — ${f.reason}`)
        );
      }
    },
    [showToast]
  );

  // Split's "extract selected" mode only makes sense while pages are
  // selected — if the selection is cleared out from under it, fall back to
  // page ranges rather than leaving an option chosen that does nothing.
  // Adjusted during render (not an effect) so it lands in the same paint as
  // the selection change instead of a visible extra frame.
  const [lastSelectedCount, setLastSelectedCount] = useState(selectedCount);
  if (selectedCount !== lastSelectedCount) {
    setLastSelectedCount(selectedCount);
    if (selectedCount === 0 && splitMode === 'selected') {
      setSplitMode('range');
    }
  }

  const updatePages = useCallback((newPages: PageInfo[]) => {
    setHistory(prev => pushState(prev, newPages));
  }, []);

  const handleUndo = useCallback(() => {
    setHistory(prev => historyUndo(prev));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory(prev => historyRedo(prev));
  }, []);

  // Ctrl/Cmd+Z undo, Ctrl+Y or Ctrl/Cmd+Shift+Z redo — standard shortcuts most
  // desktop editors already support. Ignored while typing anywhere, and while
  // the Edit tool's own text box is open, so this never steals a keystroke.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // File upload handler. Each file gets its own try/catch so one bad or
  // unrecognised file never drops the rest of the batch (#9), and pages are
  // added with a functional update so two uploads fired close together both
  // land instead of one clobbering the other (#5).
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      setIsLoading(true);
      setLoadingProgress({ message: `Loading ${files.length} file${files.length !== 1 ? 's' : ''}…`, percent: 0 });

      const batchPages: PageInfo[] = [];
      const lockedFiles: { file: File; fileIndex: number }[] = [];
      const failures: UploadFailure[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const fileIndex = fileCountRef.current++;

          let buffer: ArrayBuffer;
          if (isPdfFile(file)) {
            buffer = await file.arrayBuffer();
          } else if (isImageFile(file)) {
            buffer = await imageToPdfBuffer(file);
          } else if (isMarkdownFile(file)) {
            buffer = await markdownToPdfBuffer(file);
          } else {
            // Name and MIME didn't decide — sniff the actual bytes before
            // giving up on the file (#3, #4).
            const kind = await sniffFileKind(file);
            if (kind === 'pdf') {
              buffer = await file.arrayBuffer();
            } else if (kind === 'png' || kind === 'jpeg' || kind === 'webp') {
              buffer = await imageToPdfBuffer(file);
            } else {
              failures.push({ fileName: file.name, reason: 'unsupported file type' });
              continue;
            }
          }

          storeFileBuffer(fileIndex, buffer);

          // Render thumbnails from the PDF buffer (whether originally PDF or converted from image)
          const blob = new Blob([buffer], { type: 'application/pdf' });
          const pdfFile = new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.pdf', {
            type: 'application/pdf',
          });

          try {
            const { pages: thumbnails, encrypted } = await renderPdfThumbnails(
              pdfFile,
              fileIndex,
              0.5,
              undefined,
              (done, total) => {
                setLoadingProgress({
                  message: `Loading ${file.name} (${i + 1} of ${files.length}) — page ${done} of ${total}`,
                  percent: Math.round(((i + done / total) / files.length) * 100),
                });
              }
            );

            if (encrypted) {
              // Owner-password-only "restricted" PDF: pdf.js opened it with no
              // password, but pdf-lib still refuses the buffer as encrypted —
              // decrypt it now so Merge/Compress/Edit work later (#8).
              const decrypted = await decryptPdfBytes(new Uint8Array(buffer), '');
              storeFileBuffer(
                fileIndex,
                decrypted.buffer.slice(
                  decrypted.byteOffset,
                  decrypted.byteOffset + decrypted.byteLength
                ) as ArrayBuffer
              );
            }

            batchPages.push(...thumbnails);
          } catch (err) {
            if (err instanceof Error && err.name === 'PasswordException') {
              lockedFiles.push({ file: pdfFile, fileIndex });
            } else {
              throw err;
            }
          }
        } catch (err) {
          console.error('Error loading file:', file.name, err);
          failures.push({ fileName: file.name, reason: describeLoadError(err) });
        }
      }

      if (batchPages.length > 0) {
        setHistory(prev => pushState(prev, [...prev.present, ...batchPages]));
      }
      if (lockedFiles.length > 0) {
        setPendingFiles(prev => [...prev, ...lockedFiles]);
      }
      if (failures.length > 0) {
        showFailureToast(failures);
      }

      setIsLoading(false);
    },
    [showFailureToast]
  );

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      const rejected: File[] = [];

      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (!file) continue;
          if (isValidFile(file)) {
            files.push(file);
          } else {
            rejected.push(file);
          }
        }
      }

      if (files.length > 0) {
        handleFilesSelected(files);
      }
      if (rejected.length > 0) {
        showFailureToast(rejected.map(f => ({ fileName: f.name, reason: 'unsupported file type' })));
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFilesSelected, showFailureToast]);

  const handleFilePasswordConfirm = useCallback(
    async (password: string) => {
      if (pendingFiles.length === 0) return;

      const current = pendingFiles[0];
      setIsDecryptingFile(true);
      setFilePasswordError('');

      try {
        const { pages: thumbnails } = await renderPdfThumbnails(
          current.file,
          current.fileIndex,
          0.5,
          password
        );

        // The stored buffer is still encrypted at this point — decrypt it so
        // pdf-lib (Merge/Compress/Edit) and later pdf.js calls both work (#8).
        const buffer = getFileBuffer(current.fileIndex);
        if (buffer) {
          const decrypted = await decryptPdfBytes(new Uint8Array(buffer), password);
          storeFileBuffer(
            current.fileIndex,
            decrypted.buffer.slice(
              decrypted.byteOffset,
              decrypted.byteOffset + decrypted.byteLength
            ) as ArrayBuffer
          );
        }

        setHistory(prev => pushState(prev, [...prev.present, ...thumbnails]));
        setPendingFiles(prev => prev.slice(1));
      } catch (err) {
        if (err instanceof Error && err.name === 'PasswordException') {
          setFilePasswordError('Incorrect password. Please try again.');
        } else {
          setFilePasswordError(describeLoadError(err));
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

  // Replace one page's annotations. Continuous gestures (dragging a mark,
  // typing into a text box) pass commit=false so they don't each become their
  // own undo step — the editor snapshots once up front via handleCheckpoint.
  const handleAnnotationsChange = useCallback(
    (pageId: string, annotations: Annotation[], commit: boolean) => {
      setHistory(prev => {
        const next = prev.present.map(p =>
          p.id === pageId ? { ...p, annotations } : p
        );
        return commit ? pushState(prev, next) : replacePresent(prev, next);
      });
    },
    []
  );

  const handleCheckpoint = useCallback(() => {
    setHistory(prev => pushState(prev, prev.present));
  }, []);

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
          case 'edit':
          case 'imageToPdf':
          case 'compress': {
            let data: Uint8Array;
            if (activeTool === 'compress') {
              const result = await compressPdf(pages, compressionQuality / 100, setProgress);
              data = result.data;
              if (result.alreadyOptimal) {
                showToast(
                  'notice',
                  'This PDF is already well optimised — downloaded without further compression.'
                );
              }
            } else {
              data = await buildPdf(pages, setProgress);
            }

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
                      ? 'converted.pdf'
                      : activeTool === 'edit'
                        ? 'edited.pdf'
                        : 'rearranged.pdf';
            }
            downloadFile(data, filename);
            break;
          }

          case 'split': {
            if (splitMode === 'selected') {
              const selected = pages.filter(p => p.selected);
              const data = await extractPages(selected, setProgress);
              const trimmed = customFilename.trim();
              const filename = trimmed
                ? trimmed.toLowerCase().endsWith('.pdf')
                  ? trimmed
                  : `${trimmed}.pdf`
                : 'extracted.pdf';
              downloadFile(data, filename);
              break;
            }

            let ranges: number[][];
            if (splitMode === 'individual') {
              ranges = pages.map((_, i) => [i]);
            } else {
              ranges = parseRanges(splitRange, pages.length);
              if (ranges.length === 0) {
                showToast('error', 'Please enter valid page ranges (e.g., "1-3, 4-6")');
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
            const zipName = customFilename.trim() ? `${prefix}.zip` : 'split.zip';
            await downloadFilesOrZip(renamedFiles, zipName);
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
        showToast('error', `Something went wrong — ${describeLoadError(err)}.`);
      } finally {
        setIsProcessing(false);
        setProgress(0);
      }
    },
    [pages, activeTool, splitMode, splitRange, convertFormat, compressionQuality, customFilename, showToast]
  );

  // Process button handler – for merge/rearrange, show password modal first
  const handleProcessClick = useCallback(() => {
    if (pages.length === 0) return;

    // For merge, rearrange, imageToPdf – offer password protection
    if (['merge', 'rearrange', 'edit', 'imageToPdf'].includes(activeTool)) {
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

  // Unlock handler — UnlockPanel handles its own download; nothing to do here.
  const handleUnlocked = useCallback(() => {}, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeTool === 'unlock' || activeTool === 'verify') return;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current++;
      setIsDraggingFile(true);
    }
  }, [activeTool]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeTool === 'unlock' || activeTool === 'verify') return;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDraggingFile(false);
      }
    }
  }, [activeTool]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Always prevented, everywhere — otherwise the browser navigates away to
    // show the dropped file instead of letting the app handle it.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      dragCounter.current = 0;

      // The Unlock and Verify tools have their own dedicated drop zones — a
      // drop anywhere else on the page while they're active shouldn't load
      // files into the workspace behind them (#7).
      if (activeTool === 'unlock' || activeTool === 'verify') return;

      const allFiles = Array.from(e.dataTransfer.files);
      const files = allFiles.filter(isValidFile);
      const rejected = allFiles.filter(f => !isValidFile(f));
      if (files.length > 0) {
        handleFilesSelected(files);
      }
      if (rejected.length > 0) {
        showFailureToast(rejected.map(f => ({ fileName: f.name, reason: 'unsupported file type' })));
      }
    },
    [activeTool, handleFilesSelected, showFailureToast]
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
          onFilesRejected={(names) =>
            showFailureToast(names.map(name => ({ fileName: name, reason: 'unsupported file type' })))
          }
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
          onAnnotationsChange={handleAnnotationsChange}
          onCheckpoint={handleCheckpoint}
        />

        {activeTool !== 'unlock' && activeTool !== 'verify' && (
          <BottomBar
            pageCount={pages.length}
            selectedCount={selectedCount}
            activeTool={activeTool}
            splitMode={splitMode}
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
        accept={ACCEPT_ATTRIBUTE}
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Loading overlay for initial file upload */}
      {isLoading && (
        <ProgressOverlay progress={loadingProgress.percent} message={loadingProgress.message} />
      )}

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

      {toast && (
        <Toast
          key={toast.id}
          id={toast.id}
          kind={toast.kind}
          message={toast.message}
          details={toast.details}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default App;
