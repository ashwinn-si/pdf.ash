/**
 * qpdf (compiled to WASM) for password-protected and structurally damaged
 * PDFs — jobs pdf-lib intentionally refuses (it has no decryption support and
 * no repair pass for a broken xref table).
 *
 * The WASM module is a large (~1.7MB) code-split chunk, only needed by three
 * call sites (Unlock, the encrypted/damaged-PDF safety net in `loadForEdit`,
 * and Protect PDF's AES-256 lock), so it's imported lazily rather than
 * bundled into the main chunk. Keep the specifier a plain string literal:
 * `vite.config.ts` lists it in `reservedStrings` so the build obfuscator
 * doesn't rewrite it into a string-array lookup that Rollup can no longer see
 * (see `utils/pdfjs.ts` for the same issue with a *static* import — this one
 * is dynamic, which is fine precisely because qpdf isn't needed for the very
 * first render the way pdf.js is).
 *
 * qpdf version: this build is 11.0.0. The package can't be run under Node to
 * ask `--version` directly (it's browser-only ESM and throws a module-format
 * error there), so this was confirmed by decoding the wasm binary embedded in
 * `qpdf.mjs` (base64 → bytes) and running `strings` on it: it contains the
 * literal "11.0.0" next to "show qpdf version", plus the long option names
 * `user-password`/`owner-password`/`bits`. qpdf >= 11's `--encrypt` takes
 * `--user-password=`/`--owner-password=`/`--bits=` rather than positional
 * arguments, which is what `encryptPdfBytes` below uses — it's immune to
 * passwords starting with '@' or '-', which the older positional syntax
 * would misparse as more options.
 */

interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
}

interface QpdfModule {
  FS: QpdfFS;
  callMain(args: string[]): number | void;
}

/** Thrown for any qpdf failure, carrying the captured stderr so callers (see
 * `describeLoadError`) can tell a wrong password from everything else. */
export class QpdfError extends Error {
  stderr: string;
  isPasswordError: boolean;

  constructor(message: string, stderr: string, isPasswordError: boolean) {
    super(message);
    this.name = 'QpdfError';
    this.stderr = stderr;
    this.isPasswordError = isPasswordError;
  }
}

/**
 * Run one qpdf invocation against `input`. `args` should reference the input
 * and output files by the names `runQpdf` writes/reads them under (`in.pdf`/
 * `out.pdf` by default).
 *
 * qpdf's process exit code is not a reliable success signal: exit code 3
 * means "succeeded with warnings" (e.g. a PDF with a recoverable structural
 * problem), and the Emscripten `callMain` binding can throw for that even
 * though the job actually finished writing its output. So success here is
 * defined as "the output file exists in the virtual filesystem", checked
 * regardless of what `callMain` did — a real failure (wrong password,
 * unparseable input) never produces an output file at all.
 *
 * This bundled qpdf-wasm-esm-embedded build doesn't export `FS.analyzePath`
 * (only `writeFile`/`readFile`, per the `Object.assign(T, {...})` at the
 * bottom of its generated `qpdf.mjs`), so existence is checked by attempting
 * `FS.readFile` and treating the Emscripten `ErrnoError` it throws for a
 * missing path as "no output file".
 */
export async function runQpdf(
  args: string[],
  input: Uint8Array,
  opts?: { inputName?: string; outputName?: string }
): Promise<Uint8Array> {
  const inputName = opts?.inputName ?? 'in.pdf';
  const outputName = opts?.outputName ?? 'out.pdf';

  const createQPDF = (await import('qpdf-wasm-esm-embedded')).default;

  let stderr = '';
  // The factory's declared return type (`EmscriptenModule`, from
  // @types/emscripten) doesn't model the `FS`/`callMain` members that the
  // MODULARIZE build actually attaches to the instance, so the result is
  // asserted through `unknown` into the narrow shape this file actually uses.
  const qpdf = (await createQPDF({
    print: () => {},
    printErr: (text: string) => {
      stderr += text + '\n';
    },
  })) as unknown as QpdfModule;

  qpdf.FS.writeFile(inputName, input);

  try {
    qpdf.callMain(args);
  } catch {
    // Fall through — whether the output file exists is the real signal.
  }

  let output: Uint8Array | undefined;
  try {
    output = qpdf.FS.readFile(outputName);
  } catch {
    // Emscripten's FS throws (an ErrnoError) when the path doesn't exist —
    // that's the "no output file" signal.
  }

  if (!output || output.length === 0) {
    const isPasswordError = /invalid password/i.test(stderr);
    throw new QpdfError(
      isPasswordError ? 'Incorrect password' : 'qpdf failed to process this file',
      stderr,
      isPasswordError
    );
  }

  return output;
}

/**
 * Decrypt a PDF. An empty password also strips owner-only restrictions
 * (print/copy locks) from a PDF that has no user password at all — qpdf
 * accepts an empty `--password=` for those the same way any PDF reader would
 * open them without prompting.
 */
export async function decryptPdfBytes(bytes: Uint8Array, password = ''): Promise<Uint8Array> {
  return runQpdf(['--password=' + password, '--decrypt', 'in.pdf', 'out.pdf'], bytes);
}

/** Rewrite a structurally damaged PDF's xref/object streams. */
export async function repairPdfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return runQpdf(['in.pdf', 'out.pdf'], bytes);
}

/**
 * Encrypt with AES-256, using the same password for the user and owner
 * slots — this app only ever collects one password to lock a file with.
 */
export async function encryptPdfBytes(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return runQpdf(
    [
      '--encrypt',
      `--user-password=${password}`,
      `--owner-password=${password}`,
      '--bits=256',
      '--',
      'in.pdf',
      'out.pdf',
    ],
    bytes
  );
}
