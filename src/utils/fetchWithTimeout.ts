/**
 * Shared client-side timeout and fetch helpers so UI loading states
 * never hang indefinitely on stalled network or SDK requests.
 */

export class RequestTimeoutError extends Error {
  public readonly status = 408;
  public readonly isTimeout = true;

  constructor(message = 'Request timed out. Please check your connection and try again.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export async function withClientTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage?: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new RequestTimeoutError(
          timeoutMessage || `Operation timed out after ${Math.ceil(ms / 1000)}s.`
        )
      );
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; timeoutMessage?: string } = {}
): Promise<Response> {
  const { timeoutMs = 15000, timeoutMessage, signal: externalSignal, ...fetchInit } = init;
  const controller = new AbortController();

  let abortListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      abortListener = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', abortListener, { once: true });
    }
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (timedOut || err?.name === 'AbortError') {
      if (externalSignal?.aborted && !timedOut) {
        throw err;
      }
      throw new RequestTimeoutError(
        timeoutMessage ||
          `Request timed out after ${Math.ceil(timeoutMs / 1000)}s. Please try again.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal && abortListener) {
      externalSignal.removeEventListener('abort', abortListener);
    }
  }
}
