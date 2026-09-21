/**
 * Single entry point for pdfjs-dist.
 *
 * Imported statically on purpose. The build obfuscator rewrites string
 * literals into string-array lookups, including the specifier inside a
 * dynamic `import('pdfjs-dist')` — Rollup then cannot see a literal to rewrite
 * into a chunk URL, so the bare name survives into the bundle and the browser
 * throws "Failed to resolve module specifier 'pdfjs-dist'" at runtime. Static
 * import statements are not expressions, so the obfuscator leaves them alone.
 *
 * Nothing is lost by doing this: pdfjs is needed to render the very first
 * thumbnail, so it was always in the initial bundle and the dynamic imports
 * were never actually deferring anything.
 *
 * Importing through here also guarantees the worker is configured before any
 * caller touches getDocument, which a scattered dynamic import did not.
 *
 * Legacy build, not modern: `pdfjs-dist/build/*` (the default `pdfjs-dist`
 * entry) calls `Map.prototype.getOrInsertComputed` inside `page.render()` and
 * in its worker, plus leans on `Math.sumPrecise`, `Uint8Array#toHex`/
 * `fromBase64`, `Promise.try` and `URL.parse` — all Chrome-145+-only (early
 * 2026). A Windows Chrome that's behind on updates (managed/paused updates,
 * older OS build) throws `getOrInsertComputed is not a function` on the very
 * first thumbnail. `pdfjs-dist/legacy/build/*` ships core-js polyfills for
 * all of these, in both the main-thread bundle and the worker (verified by
 * grepping both minified files for `getOrInsertComputed:function`), so it
 * runs on much older browsers for a modest size cost.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

// ?url so Vite emits the worker as a hashed asset — correct on any CDN deploy.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/**
 * Absolute URL for one of the four asset folders pdf.js needs beyond the
 * worker itself — see `openPdf` below. Built at call time, not module scope,
 * and never from `import.meta.env`: the obfuscator runs on `src/**` *before*
 * Vite's own transforms (including the `define` plugin that substitutes
 * `import.meta.env.*`), so anything read from env at module scope would be
 * obfuscated as a plain string rather than replaced with the real value.
 * `window.location.href` is available at runtime instead and needs no build
 * step at all.
 */
function pdfjsAssetUrl(dir: 'cmaps' | 'standard_fonts' | 'wasm' | 'iccs'): string {
  return new URL(`/pdfjs/${dir}/`, window.location.href).href;
}

/**
 * Open a PDF with pdf.js. Every pdf.js caller in this app should go through
 * here rather than calling `pdfjsLib.getDocument` directly, so the worker and
 * the four asset folders below are never forgotten at a new call site.
 *
 * - `cMapUrl`/`cMapPacked`: predefined Adobe CMaps, needed for CJK and other
 *   non-Latin text that isn't drawn with a simple 1-byte encoding (#10).
 * - `standardFontDataUrl`: fallback glyph data for the 14 standard PDF fonts
 *   when a PDF references them without embedding (common for scanned/OCRed
 *   documents and older PDF producers).
 * - `wasmUrl`: the openjpeg (JPEG2000), jbig2 and qcms (ICC colour
 *   management) codecs. Without this, JPEG2000 images in scanned PDFs render
 *   blank and pdf.js logs "OpenJPEG failed to initialize" (#10).
 * - `iccUrl`: the one bundled ICC profile pdf.js falls back to when a PDF's
 *   embedded colour profile can't be parsed.
 *
 * `vite.config.ts`'s `pdfjsAssets()` plugin serves/emits
 * `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}` under
 * `/pdfjs/<dir>/` in both dev and the production build, so these URLs always
 * resolve regardless of deploy target.
 */
export function openPdf(
  data: ArrayBuffer | Uint8Array,
  password?: string
): PDFDocumentLoadingTask {
  return pdfjsLib.getDocument({
    data,
    password,
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    wasmUrl: pdfjsAssetUrl('wasm'),
    iccUrl: pdfjsAssetUrl('iccs'),
  });
}

export { pdfjsLib };
