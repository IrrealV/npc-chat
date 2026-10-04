import { prepareManualChatRequest } from './chat.js';
import { createPacedPublication, type PacedPublication } from './pacing.js';
import { PresentationPublisher } from './publisher.js';
import type { PresentationServer } from './presentation-server.js';
import { runManualChatSessionCli, type SessionCliRuntime } from './session-cli.js';

const HELP = `Usage: npm run --silent npc:serve -- [--count <2-10>] [--port <1024-65535>]

Run the manual chat session with a local reading panel and OBS overlay.
Options:
  --count <2-10>       Message count per accepted event (default: 5)
  --port <1024-65535>  Loopback HTTP port (default: 4177)
  --help               Show this help; must be used alone
`;

type ParsedArguments = { kind: 'help' } | { kind: 'run'; count?: number; port: number };

export type ServeCliRuntime = SessionCliRuntime & {
  createPresentationServer: (publisher: PresentationPublisher, port: number) => PresentationServer;
  createPacedPublication?: (publisher: PresentationPublisher) => PacedPublication;
};

class ServeCliError extends Error {
  constructor(readonly code: string) { super(code); }
}

function integer(value: string, minimum: number, maximum: number, code: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new ServeCliError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ServeCliError(code);
  return parsed;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.includes('--help')) {
    if (argv.length !== 1) throw new ServeCliError('help_must_be_used_alone');
    return { kind: 'help' };
  }
  let count: number | undefined;
  let port = 4177;
  let hasPort = false;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new ServeCliError('missing_option_value');
    if (option === '--count' && count === undefined) count = integer(value, 2, 10, 'invalid_count');
    else if (option === '--port' && !hasPort) {
      port = integer(value, 1024, 65535, 'invalid_port');
      hasPort = true;
    } else throw new ServeCliError('unknown_option');
  }
  prepareManualChatRequest('validation', count);
  return { kind: 'run', count, port };
}

function writeError(runtime: ServeCliRuntime, code: string): number {
  runtime.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
}

export async function runServeCli(argv: readonly string[], runtime: ServeCliRuntime): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return writeError(runtime, error instanceof ServeCliError ? error.code : 'startup_failed');
  }
  if (parsed.kind === 'help') {
    runtime.stdout.write(HELP);
    return 0;
  }
  if (!runtime.isStdinTTY || !runtime.isStderrTTY) return writeError(runtime, 'interactive_terminal_required');

  const publisher = new PresentationPublisher();
  const paced = runtime.createPacedPublication?.(publisher) ?? createPacedPublication(publisher);
  const server = runtime.createPresentationServer(publisher, parsed.port);
  let status = 1;
  try {
    const port = await server.start();
    runtime.stderr.write(`Reading panel: http://127.0.0.1:${port}/\n`);
    runtime.stderr.write(`OBS overlay: http://127.0.0.1:${port}/overlay\n`);
    const sessionArgv = parsed.count === undefined ? [] : ['--count', String(parsed.count)];
    status = await runManualChatSessionCli(
      sessionArgv,
      runtime,
      (messages, signal) => paced.publish(messages, signal),
    );
  } catch {
    status = writeError(runtime, 'presentation_start_failed');
  } finally {
    paced.stop();
    try {
      await server.close();
    } catch {
      if (status === 0) status = writeError(runtime, 'presentation_cleanup_failed');
    }
  }
  return status;
}
