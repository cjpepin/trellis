import { useCallback, useEffect, useRef, useState } from "react";

const MAX_STACK = 80;

/**
 * Undo/redo for markdown source: idle-coalesced typing snapshots plus explicit commits before toolbar edits.
 */
export function useMarkdownUndoRedo(
  value: string,
  setValue: (next: string) => void,
  noteSlug: string
): {
  commitBeforeEdit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onTextareaIdleInput: () => void;
  syncAnchor: (next: string) => void;
  reset: (anchor: string) => void;
} {
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const typingAnchorRef = useRef(value);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPast([]);
    setFuture([]);
  }, [noteSlug]);

  const pushPast = useCallback((snapshot: string) => {
    setPast((p) => [...p.slice(-(MAX_STACK - 1)), snapshot]);
    setFuture([]);
  }, []);

  const commitBeforeEdit = useCallback(() => {
    pushPast(valueRef.current);
  }, [pushPast]);

  const syncAnchor = useCallback((next: string) => {
    typingAnchorRef.current = next;
  }, []);

  const reset = useCallback((anchor: string) => {
    setPast([]);
    setFuture([]);
    typingAnchorRef.current = anchor;
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) {
      return;
    }
    const prev = past[past.length - 1];
    if (prev === undefined) {
      return;
    }
    const current = valueRef.current;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [current, ...f].slice(0, MAX_STACK));
    setValue(prev);
    typingAnchorRef.current = prev;
  }, [past.length, setValue]);

  const redo = useCallback(() => {
    if (future.length === 0) {
      return;
    }
    const next = future[0];
    if (next === undefined) {
      return;
    }
    const current = valueRef.current;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p.slice(-(MAX_STACK - 1)), current]);
    setValue(next);
    typingAnchorRef.current = next;
  }, [future.length, setValue]);

  const onTextareaIdleInput = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      const v = valueRef.current;
      if (v === typingAnchorRef.current) {
        return;
      }
      pushPast(typingAnchorRef.current);
      typingAnchorRef.current = v;
    }, 650);
  }, [pushPast]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  return {
    commitBeforeEdit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    onTextareaIdleInput,
    syncAnchor,
    reset
  };
}
