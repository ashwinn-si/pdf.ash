import { useState, useCallback, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import Sidebar, { type Tool } from './components/Sidebar';
import TopBar from './components/TopBar';
import Workspace from './components/Workspace';
import BottomBar from './components/BottomBar';
import ProgressOverlay from './components/ProgressOverlay';
import { renderPdfThumbnails, type PageInfo } from './utils/pdfRenderer';
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
  const [isLoading, setIsLoading] = useState(false);

  const fileCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pages = history.present;

  const updatePages = useCallback(
    (newPages: PageInfo[]) => {
      setHistory((prev) => pushState(prev, newPages));
    },
    []
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => historyUndo(prev));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => historyRedo(prev));
  }, []);

  // File upload handler
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      setIsLoading(true);
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
          const pdfFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".pdf", { type: 'application/pdf' });
          const thumbnails = await renderPdfThumbnails(pdfFile, fileIndex);
          newPages.push(...thumbnails);
        }

        updatePages(newPages);
      } catch (err) {
        console.error('Error loading PDFs:', err);
        alert('Error loading PDF files. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [pages, updatePages]
  );

  // Drag end handler for reordering
  const handleReorder = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = pages.findIndex((p) => p.id === active.id);
        const newIndex = pages.findIndex((p) => p.id === over.id);
        const newPages = arrayMove(pages, oldIndex, newIndex);
        updatePages(newPages);
      }
    },
    [pages, updatePages]
  );

  // Rotate a page by 90°
  const handleRotate = useCallback(
    (id: string) => {
      const newPages = pages.map((p) =>
        p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      );
      updatePages(newPages);
    },
    [pages, updatePages]
  );

  // Delete a page
  const handleDelete = useCallback(
    (id: string) => {
      const newPages = pages.filter((p) => p.id !== id);
      updatePages(newPages);
    },
    [pages, updatePages]
  );

  // Toggle page selection
  const handleToggleSelect = useCallback(
    (id: string) => {
      const newPages = pages.map((p) =>
        p.id === id ? { ...p, selected: !p.selected } : p
      );
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
    setIsDarkMode((prev) => {
      const next = !prev;
      document.documentElement.setAttribute(
        'data-theme',
        next ? 'dark' : 'light'
      );
      return next;
    });
  }, []);

  // Process button handler
  const handleProcess = useCallback(async () => {
    if (pages.length === 0) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      switch (activeTool) {
        case 'merge':
        case 'rearrange':
        case 'imageToPdf':
        case 'compress': {
          const data = activeTool === 'compress'
            ? await compressPdf(pages, setProgress)
            : await buildPdf(pages, setProgress);
          const filename = activeTool === 'compress'
            ? 'compressed.pdf'
            : activeTool === 'merge'
              ? 'merged.pdf'
              : activeTool === 'imageToPdf'
                ? 'converted_images.pdf'
                : 'rearranged.pdf';
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
          downloadMultipleFiles(files);
          break;
        }



        case 'convert': {
          if (convertFormat === 'txt') {
            await convertPdfToText(pages, setProgress);
          } else {
            await convertPdfToImages(pages, convertFormat, setProgress);
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
  }, [pages, activeTool, splitMode, splitRange, convertFormat, updatePages]);

  const selectedCount = pages.filter((p) => p.selected).length;

  return (
    <div className="app-layout">
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
          acceptImages={activeTool === 'imageToPdf'}
        />

        <BottomBar
          pageCount={pages.length}
          selectedCount={selectedCount}
          activeTool={activeTool}
          onProcess={handleProcess}
          isProcessing={isProcessing}
          hasPages={pages.length > 0}
        />
      </div>

      {/* Hidden file input for "Add Files" button */}
      <input
        ref={fileInputRef}
        type="file"
        accept={activeTool === 'imageToPdf' ? '.pdf,.jpg,.jpeg,.png' : '.pdf'}
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Loading overlay for initial file upload */}
      {isLoading && (
        <ProgressOverlay progress={50} message="Loading PDF pages..." />
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <ProgressOverlay progress={progress} />
      )}
    </div>
  );
}

export default App;
