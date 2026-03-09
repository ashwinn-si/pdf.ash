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
