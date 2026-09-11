/**
 * Helpers for the parts of the app that are code-split and fetched on demand
 * (the signature verifier, the qpdf engine).
 *
 * These downloads are large and happen the first time a tool is used, so the
 * UI has to say something is happening rather than appearing to hang.
 *
 * They can also fail in a way ordinary errors do not. Each deploy emits chunk
 * filenames with fresh content hashes; a tab that was loaded before a deploy
 * still references the previous ones, so the first lazy import after a deploy
 * can 404. The fix for the user is simply to reload, so that case needs
 * naming rather than being reported as a corrupt file.
 */

const CHUNK_ERROR_PATTERNS =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to resolve module specifier|dynamically imported module/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.test(message);
}

export const CHUNK_LOAD_MESSAGE =
  'Could not download part of the app. If a new version was just deployed, reloading this page will fix it.';

/**
 * Turn any failure into something worth showing a person: the reload hint for
 * a missing chunk, and the given fallback for everything else.
 */
export function describeFailure(error: unknown, fallback: string): string {
  return isChunkLoadError(error) ? CHUNK_LOAD_MESSAGE : fallback;
}
