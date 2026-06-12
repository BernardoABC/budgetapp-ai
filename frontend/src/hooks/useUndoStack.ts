import { useRef, useState, useCallback } from 'react';

export interface UndoEntry {
  label: string;
  undo: () => void;
}

const MAX_DEPTH = 50;

export function useUndoStack() {
  const stackRef = useRef<UndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const push = useCallback((entry: UndoEntry) => {
    stackRef.current = [entry, ...stackRef.current].slice(0, MAX_DEPTH);
    setCanUndo(true);
  }, []);

  const pop = useCallback((): string | null => {
    if (stackRef.current.length === 0) return null;
    const [top, ...rest] = stackRef.current;
    stackRef.current = rest;
    setCanUndo(rest.length > 0);
    top.undo();
    return top.label;
  }, []);

  return { push, pop, canUndo };
}
