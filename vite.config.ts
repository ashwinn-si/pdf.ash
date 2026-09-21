import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscator from 'vite-plugin-javascript-obfuscator'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;
type PdfjsAssetDir = (typeof PDFJS_ASSET_DIRS)[number];

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'application/javascript',
};

/**
 * Serves/emits the four `pdfjs-dist` asset folders `utils/pdfjs.ts`'s
 * `openPdf` points at (`cMapUrl` → cmaps, `standardFontDataUrl` →
 * standard_fonts, `wasmUrl` → wasm, `iccUrl` → iccs) under `/pdfjs/<dir>/`,
 * in both dev and the production build. No dependency beyond Node's own
 * fs/path — these are static files being copied/served, not something that
 * needs a bundler pass.
 */
function pdfjsAssets(): Plugin {
  const pdfjsDistDir = fileURLToPath(new URL('./node_modules/pdfjs-dist', import.meta.url));

  return {
    name: 'pdfjs-assets',

    // Production build: emit every file in each folder as a static asset at
    // the same `pdfjs/<dir>/<file>` path the dev middleware below serves.
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const dirPath = join(pdfjsDistDir, dir);
        for (const file of readdirSync(dirPath)) {
          const filePath = join(dirPath, file);
          if (!statSync(filePath).isFile()) continue;
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${file}`,
            source: readFileSync(filePath),
          });
        }
      }
    },

    // Dev server: serve the same folders straight from node_modules so
    // `openPdf`'s asset URLs resolve without a build.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/([^/]+)\/([^/?]+)/.exec(req.url ?? '');
        if (!match) return next();

        const [, dir, encodedFile] = match;
        if (!(PDFJS_ASSET_DIRS as readonly string[]).includes(dir)) return next();

        let file: string;
        try {
          file = decodeURIComponent(encodedFile);
        } catch {
          res.statusCode = 400;
          res.end('Bad request');
          return;
        }

        // Path traversal guard: resolve the requested path and require it to
        // still land inside `<pdfjsDistDir>/<dir>` — `join` normalises any
        // `..` segments (raw or percent-encoded) out, so an escape attempt
        // resolves outside the allowed prefix and gets rejected here.
        const dirPath = join(pdfjsDistDir, dir as PdfjsAssetDir);
        const requestedPath = join(dirPath, file);
        if (requestedPath !== dirPath && !requestedPath.startsWith(dirPath + sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        let data: Buffer;
        try {
          data = readFileSync(requestedPath);
        } catch {
          return next(); // 404 — let Vite's own middleware report it
        }

        const ext = requestedPath.slice(requestedPath.lastIndexOf('.'));
        const contentType = CONTENT_TYPES[ext];
        if (contentType) res.setHeader('Content-Type', contentType);
        res.end(data);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    pdfjsAssets(),
    obfuscator({
      include: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.jsx', 'src/**/*.tsx'],
      exclude: [/node_modules/],
      apply: 'build',
      options: {
        // Specifiers of dynamic imports must survive as plain literals.
        // Anything the obfuscator turns into a string-array lookup is
        // invisible to Rollup, so it never gets rewritten into a chunk URL and
        // the bare package name reaches the browser, which cannot resolve it.
        // pdfjs-dist is imported statically (see utils/pdfjs.ts); these three
        // are deliberately lazy and so need protecting by name (qpdf-wasm-esm-embedded
        // is the qpdf engine — see utils/qpdf.ts — used by Unlock, the encrypted/
        // damaged-PDF safety net, and Protect PDF's AES-256 lock).
        reservedStrings: ['^pkijs$', '^asn1js$', '^qpdf-wasm-esm-embedded$'],
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        debugProtectionInterval: 0,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        // selfDefending must stay off: the obfuscator runs in Vite's transform
        // phase, and esbuild's minifier runs *after* it — including on the
        // selfDefending wrapper itself, which can rewrite an escaped "\n"
        // string literal into a template literal containing a real newline.
        // The wrapper's own tamper-check regex, `(((.+)+)+)+$`, then runs
        // against that changed text and can backtrack catastrophically,
        // hanging the main thread on load. Confirmed on this build: with
        // selfDefending on, `grep -c '(((.+)+)+)+\$' dist/assets/index-*.js`
        // finds the pattern in the output. javascript-obfuscator's own docs
        // warn that selfDefending is incompatible with any post-obfuscation
        // transform, and Vite always runs one (esbuild), so this can never
        // safely be re-enabled under this build pipeline.
        selfDefending: false,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 10,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.5,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 2,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.75,
        unicodeEscapeSequence: false
      }
    })
  ],
})
