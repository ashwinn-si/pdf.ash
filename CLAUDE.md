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

`PageInfo` (from `utils/pdfRenderer`) represents one rendered page: `{ id, fileIndex, fileName, pageIndex, totalPagesInFile, thumbnail, rotation, selected, annotations? }`. Pages from multiple uploaded files are flattened into one array; `fileIndex` links back to the original file buffer stored in `utils/pdfOperations` (module-level `Map`).

### Data flow

1. Files dropped/selected/pasted → `handleFilesSelected` in App.tsx, one file at a time, each in its own try/catch — a file that fails never drops the rest of the batch. A file is classified by name/MIME (`isPdfFile`/`isImageFile`/`isMarkdownFile`); when none of those decide, its actual bytes are sniffed (`sniffFileKind`) instead, since a browser's reported MIME type is unreliable (empty on Windows drags, or wrong for a renamed file).
2. Non-PDF inputs are converted to a PDF buffer first: images via `imageToPdfBuffer` (embeds by sniffed kind, applies JPEG EXIF orientation), Markdown (`.md`/`.markdown`) via `markdownToPdfBuffer` (both pdf-lib; the latter is a hand-rolled Markdown parser + paginated text layout, since pdf-lib has no rich-text renderer)
3. Buffer stored in module-level map via `storeFileBuffer(fileIndex, buffer)`. An encrypted PDF's buffer is decrypted through `utils/qpdf.ts` (see below) as soon as a password is known (or, for an owner-password-only PDF, immediately with an empty one) so later pdf-lib operations on the same buffer don't fail.
4. `renderPdfThumbnails` (pdfjs-dist) renders canvas thumbnails → `{ pages: PageInfo[], encrypted: boolean }`. Pages are appended to history with a functional `setHistory` update (not a closure over the current `pages`), so two uploads fired close together both land instead of one clobbering the other.
5. User manipulates pages (reorder via @dnd-kit, rotate, delete, select) — each mutation calls `updatePages` → `pushState`
6. On process: `buildPdf` / `compressPdf` / `splitPdf` / `extractPages` etc. read back buffers by `fileIndex`, use pdf-lib to construct output, trigger a browser download (a single file directly, or several as one ZIP via `downloadFilesOrZip` — see below)

Failures anywhere in this flow surface as a dismissible toast (`components/Toast.tsx`), not `alert()` — see "Error reporting" below.

### Tool system

`activeTool` (type `Tool` from `Sidebar.tsx`) controls which panel renders inside `Workspace`. Tools: `merge`, `rearrange`, `edit`, `split`, `compress`, `convert`, `imageToPdf`, `unlock`, `verify`.

- `merge/rearrange/edit/imageToPdf` → `buildPdf` → optional password lock via `lockPdfBytes` (qpdf, AES-256)
- `compress` → `compressPdf` (re-renders pages via pdfjs canvas at lower quality, rebuilds with pdf-lib; returns `{ data, alreadyOptimal }` — if rasterizing came out larger than the lossless rebuild, the lossless one wins and the UI shows a notice instead of silently handing back a bigger file)
- `split` → three modes (`SplitPanel`'s `SplitMode`): `range`/`individual` → `splitPdf` with parsed page ranges → `downloadFilesOrZip`; `selected` (only offered once pages are selected) → `extractPages` on the selected pages → a single PDF download
- `convert` → `convertPdfToImages` (PNG/JPG, zips its own output when there's more than one page) or `convertPdfToText` (pdfjs text layer)
- `unlock` → `UnlockPanel` handles its own download via `decryptPdfBytes`, bypasses BottomBar
- `verify` → `VerifyPanel`, read-only signature/certificate inspection, bypasses BottomBar

`unlock` and `verify` each own a dedicated drop zone; their `onDrop` calls `stopPropagation()` and App's own drag handlers additionally no-op the global overlay/upload while either tool is active, so dropping a file on those panels never also loads it into the workspace behind them.

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | All state, event handlers, layout |
| `src/utils/pdfjs.ts` | Single entry point for pdfjs-dist: `openPdf(data, password?)` |
| `src/utils/qpdf.ts` | qpdf-wasm: decrypt, repair, AES-256 lock |
| `src/utils/pdfText.ts` | WinAnsi-safe text for the base-14 fonts (`toWinAnsi`/`unsupportedChars`) |
| `src/utils/pdfOperations.ts` | All PDF operations + file buffer store + file-type checks/sniffing (`isValidFile`/`isImageFile`/`isMarkdownFile`/`isPdfFile`/`sniffFileKind`) + ZIP/download helpers |
| `src/utils/markdownToPdf.ts` | Markdown → PDF parser and paginated renderer |
| `src/utils/pdfRenderer.ts` | Thumbnail rendering via pdfjs-dist |
| `src/utils/historyManager.ts` | Immutable undo/redo stack |
| `src/utils/analytics.ts` | Vercel Analytics wrapper |
| `src/components/Workspace.tsx` | Renders active tool panel + page grid |
| `src/components/Toast.tsx` | Dismissible error/notice toast, bottom-right above the BottomBar |

### pdf.js: legacy build, not modern

`utils/pdfjs.ts` imports `pdfjs-dist/legacy/build/*`, not the default `pdfjs-dist` entry. The modern build calls `Map.prototype.getOrInsertComputed` (plus `Math.sumPrecise`, `Uint8Array#toHex`/`fromBase64`, `Promise.try`, `URL.parse`) in both the main thread and the worker — all Chrome-145+-only (early 2026) APIs, so a Windows Chrome that's behind on updates throws `getOrInsertComputed is not a function` on the first thumbnail. The legacy build ships core-js polyfills for all of these and runs on much older browsers. Both imports are **static** (`import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'`, `... from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'`) — a dynamic `import('pdfjs-dist')` would have its specifier rewritten by the build obfuscator into a string-array lookup that Rollup can no longer see, so the bare package name would reach the browser unresolved. Every call site goes through `openPdf(data, password?)` rather than `pdfjsLib.getDocument` directly, so the worker and pdf.js's asset URLs (`cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl` — needed for CJK text, embedded standard fonts, JPEG2000/ICC colour) are never forgotten at a new call site. `vite.config.ts`'s `pdfjsAssets()` plugin serves/emits the corresponding `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}` folders under `/pdfjs/<dir>/` in both dev and the production build.

### qpdf: decrypt, repair, AES-256 lock

`utils/qpdf.ts` wraps `qpdf-wasm-esm-embedded` (lazy-imported — it's a large code-split chunk) for the three things pdf-lib refuses outright: opening an encrypted PDF (`decryptPdfBytes`, including an owner-password-only "restricted" PDF opened with an empty password), repairing a structurally damaged one (`repairPdfBytes`), and locking one with AES-256 (`encryptPdfBytes`, used by `lockPdfBytes` — this replaced an earlier RC4-128 library). `pdfOperations.ts`'s `loadForEdit` calls into this automatically as a one-retry safety net whenever `PDFDocument.load` throws on a stored buffer. `QpdfError` carries `isPasswordError` so the UI (Unlock, the encrypted-file password prompt) can tell a wrong password from every other failure.

### Content sniffing

`sniffFileKind(file)` reads the first 1KB of a file's actual bytes (the `%PDF-`, PNG, JPEG, and RIFF/WEBP signatures) rather than trusting its name or MIME type, which are both unreliable — a PNG saved with a `.jpg` extension, a Windows drag with an empty `type`, or a `.jfif`/`.pjpeg` JPEG all need this to load correctly. `handleFilesSelected` uses it as the fallback once `isPdfFile`/`isImageFile`/`isMarkdownFile` can't decide from name/MIME alone; `imageToPdfBuffer` always uses it to pick the right embedder.

### ZIP output

Splitting into several files or converting several pages to images used to fire one download per output, which Chrome blocks past the first with its "this site is trying to download multiple files" prompt. `downloadFilesOrZip(files, zipName)` (in `pdfOperations.ts`, zipping via **fflate**) downloads a single file directly but zips anything more than one into a single archive; `convertPdfToImages` calls this itself, and `App.tsx`'s Split handler does for its `range`/`individual` modes.

### Error reporting

Every user-facing failure — a file that couldn't be added, an invalid split range, a processing error, the compress "already optimised" notice — goes through the `Toast` component (`role="alert"` for errors, `role="status"` for notices; errors stay until dismissed or replaced, notices auto-dismiss after ~6s) instead of `alert()`. `describeLoadError(err)` (in `pdfOperations.ts`) turns a raw exception into a short, plain-language reason the toast prefixes with the file name.

### Build note

Production builds are JS-obfuscated via `vite-plugin-javascript-obfuscator`. This significantly increases build time. The obfuscator runs only on `apply: 'build'` — dev server is unaffected. `selfDefending` is explicitly off: the obfuscator runs in Vite's transform phase, and esbuild's minifier runs *after* it, including over the selfDefending wrapper itself — it can turn an escaped `"\n"` into a template literal containing a real newline, which the wrapper's own tamper-check regex (`(((.+)+)+)+$`) then catastrophically backtracks on and hangs the main thread on load. This is confirmed reproducible with `selfDefending` on, and javascript-obfuscator's own docs say it's incompatible with any post-obfuscation transform — which Vite always runs — so it can never safely be re-enabled under this build pipeline.

### PDF password handling

Two separate flows:
- **Opening locked PDFs**: `FilePasswordModal` prompts for password, re-renders via `renderPdfThumbnails(file, idx, 0.5, password)`, then decrypts the stored buffer with `decryptPdfBytes` so later pdf-lib operations on the same file work.
- **Saving locked PDFs**: `PasswordModal` prompts at download time; password passed to `lockPdfBytes` (AES-256 via qpdf).

Both modals reset their password/error state each time they open (and `FilePasswordModal` also when the file name changes, since it's reused across a queue of locked files without ever fully closing).
