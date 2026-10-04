import { BridgeError } from '../codex/rpc.js';

const HELP = `Usage: npm run --silent npc:logout -- --confirm

Sign out of the persisted Codex profile reused by npc:chat, npc:session and npc:serve.
Options:
  --confirm   Confirm the local logout (required)
  --help      Show this help; must be used alone
`;

// Fixed, secret-free success record. Remote revocation is best effort and is
// never reported as guaranteed.
export const LOGOUT_SUCCESS = '{"loggedOut":true}\n';

type ParsedArguments = { kind: 'help' } | { kind: 'run' };
export type LogoutBridge = { logout: () => Promise<void>; close: () => Promise<void> };
export type LogoutCliRuntime = {
  start: () => Promise<LogoutBridge>;
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
  isStdinTTY: boolean;
  isStderrTTY: boolean;
  onSignal: (listener: () => void) => void;
  offSignal: (listener: () => void) => void;
};

class LogoutCliError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const helpCount = argv.filter((value) => value === '--help').length;
  if (helpCount > 0) {
    if (argv.length !== 1) throw new LogoutCliError('help_must_be_used_alone');
    return { kind: 'help' };
  }
  let confirmed = false;
  for (const option of argv) {
    if (option === '--confirm') {
      if (confirmed) throw new LogoutCliError('duplicate_option');
      confirmed = true;
      continue;
    }
    throw new LogoutCliError(option.startsWith('--') ? 'unknown_option' : 'unexpected_argument');
  }
  if (!confirmed) throw new LogoutCliError('confirmation_required');
  return { kind: 'run' };
}

function writeError(runtime: LogoutCliRuntime, code: string): number {
  runtime.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
}

function projectError(error: unknown, started: boolean): string {
  if (error instanceof LogoutCliError) return error.code;
  if (error instanceof BridgeError && error.code === 'profile_busy') return 'profile_busy';
  if (error instanceof BridgeError && error.code === 'logout_failed') return 'logout_failed';
  return started ? 'logout_failed' : 'startup_failed';
}

export async function runLogoutCli(argv: readonly string[], runtime: LogoutCliRuntime): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
    if (parsed.kind === 'help') {
      runtime.stdout.write(HELP);
      return 0;
    }
  } catch (error) {
    return writeError(runtime, error instanceof LogoutCliError ? error.code : 'runtime_setup_failed');
  }

  if (!runtime.isStdinTTY || !runtime.isStderrTTY) return writeError(runtime, 'interactive_terminal_required');

  let aborted = false;
  let bridge: LogoutBridge | undefined;
  let confirmed = false;
  let failureCode = '';
  let closePromise: Promise<boolean> | undefined;
  let rejectStop!: (error: LogoutCliError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});

  const closeOwnedBridge = (): Promise<boolean> => {
    if (bridge === undefined) return Promise.resolve(true);
    closePromise ??= bridge.close().then(() => true, () => false);
    return closePromise;
  };
  const stop = (): void => {
    if (aborted) return;
    aborted = true;
    rejectStop(new LogoutCliError('interrupted'));
  };

  runtime.onSignal(stop);
  try {
    bridge = await runtime.start();
    if (aborted) throw new LogoutCliError('interrupted');
    await Promise.race([bridge.logout().then(() => { confirmed = true; }), stopped]);
  } catch (error) {
    failureCode = projectError(error, bridge !== undefined);
  } finally {
    const didClose = await closeOwnedBridge();
    runtime.offSignal(stop);
    if (failureCode.length === 0) {
      if (aborted && !confirmed) failureCode = 'interrupted';
      else if (!didClose) failureCode = 'cleanup_failed';
    }
  }

  if (failureCode.length > 0) return writeError(runtime, failureCode);
  runtime.stdout.write(LOGOUT_SUCCESS);
  return 0;
}
