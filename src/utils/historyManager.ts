import type { PageInfo } from './pdfRenderer';

export interface HistoryState {
  past: PageInfo[][];
  present: PageInfo[];
  future: PageInfo[][];
}

export function createInitialHistory(pages: PageInfo[]): HistoryState {
  return {
    past: [],
    present: pages,
    future: [],
  };
}

export function pushState(history: HistoryState, newPages: PageInfo[]): HistoryState {
  return {
    past: [...history.past, history.present],
    present: newPages,
    future: [],
  };
}

export function undo(history: HistoryState): HistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);
  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: HistoryState): HistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const newFuture = history.future.slice(1);
  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  };
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}

/**
 * Swap out the present without adding an undo step.
 *
 * Used for continuous edits — dragging an annotation, typing into a text box —
 * where every pointermove or keystroke would otherwise become its own undo
 * step. Callers snapshot once with `pushState` when the gesture starts, then
 * stream the intermediate states through here. `future` is still cleared: the
 * edit invalidates any redo branch just as much as a discrete change does.
 */
export function replacePresent(history: HistoryState, newPages: PageInfo[]): HistoryState {
  return {
    past: history.past,
    present: newPages,
    future: [],
  };
}
