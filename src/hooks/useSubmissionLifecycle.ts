import { useCallback, useEffect, useRef, useState } from 'react';
import { getFriendlyErrorMessage } from '../utils/errorHandler';

export type SubmissionPhase =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'submitting'
  | 'verifying'
  | 'succeeded'
  | 'failed';

export interface SubmissionContext {
  signal: AbortSignal;
  idempotencyKey: string;
  setPhase: (phase: SubmissionPhase) => void;
  setProgress: (pct: number) => void;
}

function createClientRequestKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Shared production submission lifecycle hook:
 * - Synchronous ref guard prevents rapid double-clicks / concurrent submissions
 * - Stable idempotencyKey preserved across retries of the same form attempt
 * - AbortController cancellation on unmount or explicit abort
 * - Phase & upload progress tracking
 */
export function useSubmissionLifecycle() {
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(createClientRequestKey());
  const abortControllerRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abort();
    submittingRef.current = false;
    idempotencyKeyRef.current = createClientRequestKey();
    setPhase('idle');
    setProgress(0);
    setError('');
  }, [abort]);

  const rotateIdempotencyKey = useCallback(() => {
    idempotencyKeyRef.current = createClientRequestKey();
    return idempotencyKeyRef.current;
  }, []);

  const runSubmission = useCallback(
    async <T,>(
      task: (ctx: SubmissionContext) => Promise<T>,
      options: { rotateKeyOnSuccess?: boolean } = { rotateKeyOnSuccess: true }
    ): Promise<T | null> => {
      if (submittingRef.current) {
        return null;
      }
      submittingRef.current = true;
      abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setError('');
      setPhase('submitting');

      try {
        const result = await task({
          signal: controller.signal,
          idempotencyKey: idempotencyKeyRef.current,
          setPhase,
          setProgress,
        });
        setPhase('succeeded');
        setProgress(100);
        if (options.rotateKeyOnSuccess !== false) {
          idempotencyKeyRef.current = createClientRequestKey();
        }
        return result;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setPhase('idle');
          return null;
        }
        const msg = getFriendlyErrorMessage(err, 'Submission failed. Please try again.');
        setError(msg);
        setPhase('failed');
        throw err;
      } finally {
        submittingRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [abort]
  );

  return {
    phase,
    isSubmitting: phase === 'validating' || phase === 'uploading' || phase === 'submitting' || phase === 'verifying',
    progress,
    error,
    setError,
    setPhase,
    setProgress,
    submittingRef,
    idempotencyKeyRef,
    rotateIdempotencyKey,
    runSubmission,
    abort,
    reset,
  };
}
