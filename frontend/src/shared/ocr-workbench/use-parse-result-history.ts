'use client';

import { useCallback, useState } from 'react';

import { cloneParseResult } from '@/shared/ocr-workbench/parse-result-document';
import type { ParseResult } from '@/shared/ocr-workbench/translator-parse-result';

const MAX_HISTORY = 50;

type HistState = { stack: ParseResult[]; i: number };

export function useParseResultHistory() {
  const [s, setS] = useState<HistState>({ stack: [], i: -1 });

  const doc = s.i >= 0 && s.stack[s.i] ? s.stack[s.i] : null;
  const canUndo = s.i > 0;
  const canRedo = s.i >= 0 && s.i < s.stack.length - 1;

  const reset = useCallback((next: ParseResult) => {
    setS({ stack: [cloneParseResult(next)], i: 0 });
  }, []);

  const commit = useCallback((mutate: (draft: ParseResult) => void) => {
    setS((prev) => {
      if (prev.i < 0 || !prev.stack[prev.i]) return prev;
      const cur = cloneParseResult(prev.stack[prev.i]);
      mutate(cur);
      const stack = prev.stack.slice(0, prev.i + 1);
      stack.push(cur);
      const capped =
        stack.length > MAX_HISTORY ? stack.slice(-MAX_HISTORY) : stack;
      return { stack: capped, i: capped.length - 1 };
    });
  }, []);

  const commitMergeText = useCallback(
    (mutate: (draft: ParseResult) => void) => {
      setS((prev) => {
        if (prev.i < 0 || !prev.stack[prev.i]) return prev;
        const next = cloneParseResult(prev.stack[prev.i]);
        mutate(next);
        const prevTop = prev.stack[prev.i];
        if (JSON.stringify(prevTop) === JSON.stringify(next)) {
          return prev;
        }
        const stack = prev.stack.slice(0, prev.i + 1);
        stack.push(next);
        const capped =
          stack.length > MAX_HISTORY ? stack.slice(-MAX_HISTORY) : stack;
        return { stack: capped, i: capped.length - 1 };
      });
    },
    []
  );

  const undo = useCallback(() => {
    setS((prev) => {
      if (prev.i <= 0) return prev;
      return { ...prev, i: prev.i - 1 };
    });
  }, []);

  const redo = useCallback(() => {
    setS((prev) => {
      if (prev.i < 0 || prev.i >= prev.stack.length - 1) return prev;
      return { ...prev, i: prev.i + 1 };
    });
  }, []);

  return { doc, canUndo, canRedo, reset, commit, commitMergeText, undo, redo };
}
