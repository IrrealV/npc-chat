import type { TextResult } from '../codex/bridge.js';
import { BridgeError } from '../codex/rpc.js';
import {
  generateManualChatBatch,
  ManualChatError,
  prepareManualChatRequest,
  type ManualChatBatch,
} from './chat.js';

const HELP = `Usage: npm run --silent npc:chat -- --event <text> [--count <2-10>]

Generate one validated manual-event chat batch after managed sign-in.
Options:
  --event <text>   Event description (required)
  --count <2-10>  Message count (default: 5)
  --help           Show this help; must be used alone
`;

type Ceremony = { verificationUrl: string; userCode: string };
type Phase = 'startup' | 'authentication' | 'generation';
type ParsedArguments = { kind: 'help' } | { kind: 'run'; event: string; count?: number };

export type ChatCliBridge = {
  login: (ceremony: (value: Ceremony) => void, timeoutMs?: number) => Promise<unknown>;
  text: (prompt: string, options?: { signal?: AbortSignal }) => Promise<TextResult>;
  close: () => Promise<void>;
};

export type ChatCliRuntime = {
  start: () => Promise<ChatCliBridge>;
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
  isStderrTTY: boolean;
  onSignal: (listener: () => void) => void;
  offSignal: (listener: () => void) => void;
};

class ChatCliError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function parseCount(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new ChatCliError('invalid_count');
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new ChatCliError('invalid_count');
  return count;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const helpCount = argv.filter((value) => value === '--help').length;
  if (helpCount > 0) {
    if (argv.length !== 1) throw new ChatCliError('help_must_be_used_alone');
    return { kind: 'help' };
  }

  let event = '';
  let count: number | undefined;
  let hasEvent = false;
  let hasCount = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== '--event' && option !== '--count') {
      throw new ChatCliError(option.startsWith('--') ? 'unknown_option' : 'unexpected_argument');
    }
    if ((option === '--event' && hasEvent) || (option === '--count' && hasCount)) {
      throw new ChatCliError('duplicate_option');
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new ChatCliError('missing_option_value');
    index += 1;
    if (option === '--event') {
      hasEvent = true;
      event = value;
    } else {
      hasCount = true;
      count = parseCount(value);
    }
  }
  return { kind: 'run', event, count };
}

function writeError(runtime: ChatCliRuntime, code: string): number {
  runtime.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
}

function projectError(error: unknown, phase: Phase, isAborted: boolean): string {
  if (isAborted || (error instanceof BridgeError && error.code === 'aborted')) return 'interrupted';
  if (error instanceof ManualChatError) return error.code;
  if (error instanceof ChatCliError) return error.code;
  if (phase === 'startup') return 'startup_failed';
  if (phase === 'authentication') return 'authentication_failed';
  return 'generation_failed';
}

export async function runManualChatCli(argv: readonly string[], runtime: ChatCliRuntime): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
    if (parsed.kind === 'help') {
      runtime.stdout.write(HELP);
      return 0;
    }
    prepareManualChatRequest(parsed.event, parsed.count);
  } catch (error) {
    return writeError(runtime, projectError(error, 'startup', false));
  }

  if (!runtime.isStderrTTY) return writeError(runtime, 'interactive_terminal_required');

  const abort = new AbortController();
  let phase: Phase = 'startup';
  let bridge: ChatCliBridge | undefined;
  let result: ManualChatBatch | undefined;
  let failureCode = '';
  let closePromise: Promise<boolean> | undefined;
  let rejectAbort!: (error: ChatCliError) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});

  const closeOwnedBridge = (): Promise<boolean> => {
    if (bridge === undefined) return Promise.resolve(true);
    closePromise ??= bridge.close().then(() => true, () => false);
    return closePromise;
  };
  const stop = (): void => {
    if (abort.signal.aborted) return;
    abort.abort();
    rejectAbort(new ChatCliError('interrupted'));
    if (phase === 'authentication') void closeOwnedBridge();
  };

  runtime.onSignal(stop);
  try {
    bridge = await runtime.start();
    if (abort.signal.aborted) throw new ChatCliError('interrupted');

    phase = 'authentication';
    await Promise.race([
      bridge.login((ceremony) => {
        if (!abort.signal.aborted) {
          runtime.stderr.write(`Open ${ceremony.verificationUrl} in your browser and enter ${ceremony.userCode}.\n`);
        }
      }),
      aborted,
    ]);
    if (abort.signal.aborted) throw new ChatCliError('interrupted');

    phase = 'generation';
    result = await generateManualChatBatch(bridge, parsed.event, {
      count: parsed.count,
      signal: abort.signal,
    });
    if (abort.signal.aborted) throw new ChatCliError('interrupted');
  } catch (error) {
    failureCode = projectError(error, phase, abort.signal.aborted);
  } finally {
    const didClose = await closeOwnedBridge();
    runtime.offSignal(stop);
    if (abort.signal.aborted && failureCode.length === 0) failureCode = 'interrupted';
    else if (!didClose && failureCode.length === 0) failureCode = 'cleanup_failed';
  }

  if (failureCode.length > 0) return writeError(runtime, failureCode);
  runtime.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
