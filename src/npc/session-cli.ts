import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { TextResult } from '../codex/bridge.js';
import { BridgeError } from '../codex/rpc.js';
import { ManualChatError, prepareManualChatRequest } from './chat.js';
import type { PresentationPublication } from './publisher.js';
import { ManualChatSession } from './session.js';

const HELP = `Usage: npm run --silent npc:session -- [--count <2-10>]

Run one continuous manual-event chat session after managed sign-in.
Options:
  --count <2-10>  Message count per accepted event (default: 5)
  --help           Show this help; must be used alone

At a ready prompt, enter /exit to end the session. Other slash commands are rejected.
`;

export type SessionInputResult =
  | { kind: 'line'; value: string }
  | { kind: 'eof' }
  | { kind: 'interrupted' }
  | { kind: 'error' };

export type SessionInput = {
  read: () => Promise<SessionInputResult>;
  close: () => void;
};

export type SessionCliBridge = {
  login: (ceremony: (value: { verificationUrl: string; userCode: string }) => void, timeoutMs?: number) => Promise<unknown>;
  text: (prompt: string, options?: { signal?: AbortSignal }) => Promise<TextResult>;
  close: () => Promise<void>;
};

export type SessionCliRuntime = {
  start: () => Promise<SessionCliBridge>;
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
  isStdinTTY: boolean;
  isStderrTTY: boolean;
  createInput: (onInterrupt: () => void, onError: () => void) => SessionInput;
  onSignal: (listener: () => void) => void;
  offSignal: (listener: () => void) => void;
};

type ParsedArguments = { kind: 'help' } | { kind: 'run'; count?: number };
type Phase = 'startup' | 'authentication' | 'input' | 'generation';

class SessionCliError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function createSessionInput(
  input: Readable,
  output: Writable,
  onInterrupt: () => void,
  onError: () => void,
): SessionInput {
  const inputEvents = ['data', 'end', 'error', 'close'] as const;
  const existingListeners = new Map(inputEvents.map((event) => [event, new Set(input.listeners(event))]));
  const readline = createInterface({ input, output, terminal: true, crlfDelay: Infinity });
  const ownedInputListeners = new Map(inputEvents.map((event) => [
    event,
    input.listeners(event).filter((listener) => !existingListeners.get(event)?.has(listener)),
  ]));
  let terminalResult: SessionInputResult | undefined;
  let resolvePending: ((result: SessionInputResult) => void) | undefined;
  let isClosed = false;

  const deliver = (result: SessionInputResult): void => {
    const resolve = resolvePending;
    resolvePending = undefined;
    if (resolve !== undefined) resolve(result);
  };
  const line = (value: string): void => {
    if (resolvePending !== undefined) deliver({ kind: 'line', value });
  };
  const close = (): void => {
    terminalResult ??= { kind: 'eof' };
    deliver(terminalResult);
  };
  const interrupt = (): void => {
    terminalResult = { kind: 'interrupted' };
    onInterrupt();
    deliver(terminalResult);
  };
  const error = (): void => {
    if (terminalResult?.kind === 'error') return;
    terminalResult = { kind: 'error' };
    onError();
    deliver(terminalResult);
  };

  readline.on('line', line);
  readline.on('close', close);
  readline.on('SIGINT', interrupt);
  readline.on('error', error);
  input.on('error', error);

  return {
    read: () => {
      if (terminalResult !== undefined) return Promise.resolve(terminalResult);
      if (resolvePending !== undefined) return Promise.reject(new SessionCliError('input_read_active'));
      return new Promise<SessionInputResult>((resolve) => { resolvePending = resolve; });
    },
    close: () => {
      if (isClosed) return;
      isClosed = true;
      readline.off('line', line);
      readline.off('close', close);
      readline.off('SIGINT', interrupt);
      readline.off('error', error);
      input.off('error', error);
      readline.close();
      for (const [event, listeners] of ownedInputListeners) {
        for (const listener of listeners) {
          input.off(event, listener as (...args: unknown[]) => void);
        }
      }
      terminalResult ??= { kind: 'eof' };
      deliver(terminalResult);
    },
  };
}

function parseCount(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new SessionCliError('invalid_count');
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 2 || count > 10) {
    throw new SessionCliError('invalid_count');
  }
  return count;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.includes('--help')) {
    if (argv.length !== 1) throw new SessionCliError('help_must_be_used_alone');
    return { kind: 'help' };
  }
  if (argv.length === 0) return { kind: 'run' };
  if (argv[0] !== '--count') throw new SessionCliError('unknown_option');
  if (argv.length === 1) throw new SessionCliError('missing_option_value');
  if (argv.length !== 2) throw new SessionCliError('unexpected_argument');
  return { kind: 'run', count: parseCount(argv[1] ?? '') };
}

function writeError(runtime: SessionCliRuntime, code: string): number {
  runtime.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
}

function projectError(error: unknown, phase: Phase, isAborted: boolean): string {
  if (isAborted || (error instanceof BridgeError && error.code === 'aborted')) return 'interrupted';
  if (error instanceof SessionCliError || error instanceof ManualChatError) return error.code;
  if (phase === 'startup') return 'startup_failed';
  if (phase === 'authentication') return 'authentication_failed';
  if (phase === 'input') return 'input_failed';
  return 'generation_failed';
}

export async function runManualChatSessionCli(
  argv: readonly string[],
  runtime: SessionCliRuntime,
  publish?: PresentationPublication,
): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
    if (parsed.kind === 'help') {
      runtime.stdout.write(HELP);
      return 0;
    }
    prepareManualChatRequest('validation', parsed.count);
  } catch (error) {
    return writeError(runtime, projectError(error, 'startup', false));
  }
  if (!runtime.isStdinTTY || !runtime.isStderrTTY) {
    return writeError(runtime, 'interactive_terminal_required');
  }

  const abort = new AbortController();
  let phase: Phase = 'startup';
  let bridge: SessionCliBridge | undefined;
  let input: SessionInput | undefined;
  let failureCode = '';
  let closePromise: Promise<boolean> | undefined;
  let rejectAbort!: (error: SessionCliError) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});

  const closeBridge = (): Promise<boolean> => {
    if (bridge === undefined) return Promise.resolve(true);
    closePromise ??= bridge.close().then(() => true, () => false);
    return closePromise;
  };
  const stop = (): void => {
    if (abort.signal.aborted) return;
    abort.abort();
    rejectAbort(new SessionCliError('interrupted'));
    input?.close();
    if (phase === 'authentication') void closeBridge();
  };
  const failInput = (): void => {
    if (failureCode.length === 0) failureCode = 'input_failed';
    stop();
  };

  runtime.onSignal(stop);
  try {
    bridge = await runtime.start();
    if (abort.signal.aborted) throw new SessionCliError('interrupted');
    phase = 'authentication';
    await Promise.race([
      bridge.login((ceremony) => {
        if (!abort.signal.aborted) {
          runtime.stderr.write(`Open ${ceremony.verificationUrl} in your browser and enter ${ceremony.userCode}.\n`);
        }
      }),
      aborted,
    ]);
    if (abort.signal.aborted) throw new SessionCliError('interrupted');

    input = runtime.createInput(stop, failInput);
    const session = new ManualChatSession(bridge, parsed.count);
    for (;;) {
      phase = 'input';
      runtime.stderr.write('event> ');
      const next = await input.read();
      if (abort.signal.aborted || next.kind === 'interrupted') throw new SessionCliError('interrupted');
      if (next.kind === 'error') throw new SessionCliError('input_failed');
      if (next.kind === 'eof') break;
      if (next.value.trim().length === 0) continue;
      if (next.value === '/exit') break;
      if (next.value.startsWith('/')) {
        runtime.stderr.write('{"error":"unknown_command","hint":"use /exit or enter an event"}\n');
        continue;
      }
      try {
        session.prepare(next.value);
      } catch (error) {
        if (error instanceof ManualChatError
          && (error.code === 'invalid_event' || error.code === 'prompt_limit')) {
          runtime.stderr.write(`${JSON.stringify({ error: error.code })}\n`);
          continue;
        }
        throw error;
      }

      phase = 'generation';
      const result = await session.generate(next.value, abort.signal);
      if (abort.signal.aborted) throw new SessionCliError('interrupted');
      runtime.stdout.write(`${JSON.stringify(result)}\n`);
      if (abort.signal.aborted) throw new SessionCliError('interrupted');
      const publication = publish?.(result.messages, abort.signal);
      if (publication !== undefined) await publication;
      if (abort.signal.aborted) throw new SessionCliError('interrupted');
    }
  } catch (error) {
    failureCode ||= projectError(error, phase, abort.signal.aborted);
  } finally {
    input?.close();
    const didClose = await closeBridge();
    runtime.offSignal(stop);
    if (abort.signal.aborted && failureCode.length === 0) failureCode = 'interrupted';
    else if (!didClose && failureCode.length === 0) failureCode = 'cleanup_failed';
  }

  if (failureCode.length > 0) return writeError(runtime, failureCode);
  return 0;
}
