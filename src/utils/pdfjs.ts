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
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ?url so Vite emits the worker as a hashed asset — correct on any CDN deploy.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export { pdfjsLib };
