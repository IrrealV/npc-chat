import type { ManualChatMessage } from './chat.js';
import { ManualChatError } from './chat.js';
import type { PresentationPublication, PresentationPublisher } from './publisher.js';

const DELAY_MIN_MS_DEFAULT = 1000;
const DELAY_MAX_MS_DEFAULT = 3000;
const BATCH_MESSAGES_MAX = 10;

export type PacingSchedule = (callback: () => void, delayMs: number) => () => void;

export type PacingOptions = {
  schedule?: PacingSchedule;
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
};

export type PacedPublication = {
  publish: PresentationPublication;
  stop: () => void;
};

type ActiveBatch = {
  pending: ManualChatMessage[];
  signal: AbortSignal | undefined;
  onAbort: () => void;
  cancelTimer: (() => void) | undefined;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function scheduleDefault(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => { clearTimeout(timer); };
}

export function createPacedPublication(
  publisher: PresentationPublisher,
  options: PacingOptions = {},
): PacedPublication {
  const schedule = options.schedule ?? scheduleDefault;
  const random = options.random ?? Math.random;
  const minDelayMs = options.minDelayMs ?? DELAY_MIN_MS_DEFAULT;
  const maxDelayMs = options.maxDelayMs ?? DELAY_MAX_MS_DEFAULT;

  let disposed = false;
  let active: ActiveBatch | undefined;

  const release = (batch: ActiveBatch): void => {
    batch.cancelTimer?.();
    batch.cancelTimer = undefined;
    batch.signal?.removeEventListener('abort', batch.onAbort);
  };

  const finish = (batch: ActiveBatch): void => {
    if (active !== batch) return;
    active = undefined;
    release(batch);
    if (!batch.settled) {
      batch.settled = true;
      batch.resolve();
    }
  };

  const fail = (batch: ActiveBatch, error: unknown): void => {
    if (active !== batch) return;
    active = undefined;
    release(batch);
    if (!batch.settled) {
      batch.settled = true;
      batch.reject(error);
    }
  };

  const nextDelay = (): number => {
    const span = maxDelayMs - minDelayMs;
    return minDelayMs + Math.floor(random() * (span + 1));
  };

  const publish: PresentationPublication = (messages, signal) => {
    if (disposed || active !== undefined) throw new ManualChatError('session_busy');
    if (messages.length > BATCH_MESSAGES_MAX) throw new ManualChatError('invalid_count');
    const batch = messages.map(({ username, message }) => ({ username, message }));
    if (batch.length === 0 || isAborted(signal)) return undefined;

    let resolveBatch: (() => void) | undefined;
    let rejectBatch: ((error: unknown) => void) | undefined;
    const publication = batch.length === 1
      ? undefined
      : new Promise<void>((resolve, reject) => {
          resolveBatch = resolve;
          rejectBatch = reject;
        });
    const current: ActiveBatch = {
      pending: batch.slice(1),
      signal,
      onAbort: () => { finish(current); },
      cancelTimer: undefined,
      resolve: resolveBatch ?? (() => {}),
      reject: rejectBatch ?? (() => {}),
      settled: false,
    };
    const revealNext = (): void => {
      if (active !== current) return;
      current.cancelTimer = undefined;
      if (isAborted(current.signal)) {
        finish(current);
        return;
      }
      try {
        const next = current.pending.shift();
        if (next === undefined) {
          finish(current);
          return;
        }
        publisher.publish([next]);
      } catch (error) {
        fail(current, error);
        return;
      }
      // Recheck after subscriber callbacks before scheduling anything new.
      if (active !== current) return;
      if (isAborted(current.signal)) {
        finish(current);
        return;
      }
      if (current.pending.length === 0) {
        finish(current);
        return;
      }
      try {
        current.cancelTimer = schedule(revealNext, nextDelay());
      } catch (error) {
        fail(current, error);
      }
    };
    // Reserve ownership before any synchronous subscriber can observe this call.
    active = current;

    try {
      publisher.publish([batch[0]!]);
    } catch (error) {
      finish(current);
      throw error;
    }
    // Recheck after subscriber callbacks: stop/abort may have finished this batch.
    if (active !== current) return publication;
    if (isAborted(current.signal)) {
      finish(current);
      return publication;
    }
    if (current.pending.length === 0) {
      finish(current);
      return publication;
    }
    try {
      current.cancelTimer = schedule(revealNext, nextDelay());
    } catch (error) {
      fail(current, error);
      return publication;
    }
    signal?.addEventListener('abort', current.onAbort, { once: true });
    // An abort may have raced just before the listener was registered.
    if (isAborted(current.signal)) finish(current);
    return publication;
  };

  const stop = (): void => {
    disposed = true;
    if (active !== undefined) finish(active);
  };

  return { publish, stop };
}
