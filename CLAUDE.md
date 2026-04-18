# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start dev server (localhost:5173)
npm run build      # tsc type-check + vite build → dist/
npm run lint       # eslint
npm run preview    # preview production build locally
```

No test suite exists in this project.

## Architecture

Single-page React (TypeScript) app. All PDF processing is **fully client-side** — no backend, no file uploads.

### State model

`App.tsx` owns all state. Core state is `history: HistoryState` — a past/present/future stack of `PageInfo[]` arrays (undo/redo via `utils/historyManager`).

`PageInfo` (from `utils/pdfRenderer`) represents one rendered page: `{ id, fileIndex, pageIndex, thumbnailUrl, rotation, selected }`. Pages from multiple uploaded files are flattened into one array; `fileIndex` links back to the original file buffer stored in `utils/pdfOperations` (module-level `Map`).

### Data flow

1. Files dropped/selected → `handleFilesSelected` in App.tsx
2. Images are first converted to PDF via `imageToPdfBuffer` (pdf-lib)
3. Buffer stored in module-level map via `storeFileBuffer(fileIndex, buffer)`
4. `renderPdfThumbnails` (pdfjs-dist) renders canvas thumbnails → `PageInfo[]`
5. Pages appended to history present state
6. User manipulates pages (reorder via @dnd-kit, rotate, delete, select) — each mutation calls `updatePages` → `pushState`
7. On process: `buildPdf` / `compressPdf` / `splitPdf` etc. read back buffers by `fileIndex`, use pdf-lib to construct output, trigger browser download

### Tool system

`activeTool` (type `Tool` from `Sidebar.tsx`) controls which panel renders inside `Workspace`. Tools: `merge`, `rearrange`, `split`, `compress`, `convert`, `imageToPdf`, `unlock`.

- `merge/rearrange/imageToPdf` → `buildPdf` → optional password lock via `lockPdfBytes` (qpdf-wasm)
- `compress` → `compressPdf` (re-renders pages via pdfjs canvas at lower quality, rebuilds with pdf-lib)
- `split` → `splitPdf` with parsed page ranges
- `convert` → `convertPdfToImages` (PNG/JPG) or `convertPdfToText` (pdfjs text layer)
- `unlock` → `UnlockPanel` handles its own download, bypasses BottomBar

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | All state, event handlers, layout |
| `src/utils/pdfOperations.ts` | All PDF operations + file buffer store |
| `src/utils/pdfRenderer.ts` | Thumbnail rendering via pdfjs-dist |
| `src/utils/historyManager.ts` | Immutable undo/redo stack |
| `src/utils/analytics.ts` | Vercel Analytics wrapper |
| `src/components/Workspace.tsx` | Renders active tool panel + page grid |

### Build note

Production builds are JS-obfuscated via `vite-plugin-javascript-obfuscator`. This significantly increases build time. The obfuscator runs only on `apply: 'build'` — dev server is unaffected.

### PDF password handling

Two separate flows:
- **Opening locked PDFs**: `FilePasswordModal` prompts for password, re-renders via `renderPdfThumbnails(file, idx, 0.5, password)`
- **Saving locked PDFs**: `PasswordModal` prompts at download time; password passed to `lockPdfBytes` (qpdf-wasm-esm-embedded)
