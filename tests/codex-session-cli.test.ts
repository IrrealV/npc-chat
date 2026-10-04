import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import {
  createSessionInput,
  runManualChatSessionCli,
  type SessionCliBridge,
  type SessionCliRuntime,
  type SessionInput,
  type SessionInputResult,
} from '../src/npc/session-cli.js';

const provenance: Omit<TextResult, 'response'> = {
  status: 'completed', model: 'gpt-test', requestedModel: 'gpt-test', resolvedModel: 'gpt-test',
  codexVersion: '0.154.0', serviceTier: 'default', effort: 'low', firstDeltaMs: 1, totalMs: 2,
};

function completed(returning = 'Ana'): TextResult {
  return { response: JSON.stringify([
    { username: returning, message: 'Hola' },
    { username: 'Beto', message: 'Vamos' },
  ]), ...provenance };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function scriptedInput(results: SessionInputResult[]) {
  const read = vi.fn<() => Promise<SessionInputResult>>(async () =>
    results.shift() ?? { kind: 'eof' });
  const close = vi.fn<() => void>();
  return { read, close };
}

type HarnessOptions = {
  isStdinTTY?: boolean;
  isStderrTTY?: boolean;
  input?: SessionInput;
  start?: () => Promise<SessionCliBridge>;
  bridge?: Partial<SessionCliBridge>;
};

function harness(options: HarnessOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const signals = new Set<() => void>();
  const input = options.input ?? scriptedInput([{ kind: 'eof' }]);
  const bridge: SessionCliBridge = {
    login: vi.fn(async (ceremony) => {
      ceremony({ verificationUrl: 'https://auth.openai.com/device', userCode: 'TEST-CODE' });
      return {};
    }),
    text: vi.fn(async () => completed()),
    close: vi.fn(async () => {}),
    ...options.bridge,
  };
  const start = vi.fn(options.start ?? (async () => bridge));
  const runtime: SessionCliRuntime = {
    start,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    isStdinTTY: options.isStdinTTY ?? true,
    isStderrTTY: options.isStderrTTY ?? true,
    createInput: vi.fn(() => input),
    onSignal: (listener) => signals.add(listener),
    offSignal: (listener) => signals.delete(listener),
  };
  return { bridge, input, runtime, signals, start, stderr, stdout,
    abort: () => { for (const signal of [...signals]) signal(); } };
}

describe('real manual session input adapter', () => {
  it('drops complete lines received while busy instead of queueing them', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const adapter = createSessionInput(input, output, vi.fn(), vi.fn());
    const first = adapter.read();
    input.write('accepted\n');
    await expect(first).resolves.toStrictEqual({ kind: 'line', value: 'accepted' });

    input.write('stale one\nstale two\n');
    await settle();
    const next = adapter.read();
    input.write('fresh\n');
    await expect(next).resolves.toStrictEqual({ kind: 'line', value: 'fresh' });
    adapter.close();
    expect(input.listenerCount('data')).toBe(0);
  });

  it('remembers EOF while busy and resolves the next ready read', async () => {
    const input = new PassThrough();
    const adapter = createSessionInput(input, new PassThrough(), vi.fn(), vi.fn());
    input.end();
    await settle();

    await expect(adapter.read()).resolves.toStrictEqual({ kind: 'eof' });
    adapter.close();
  });

  it('turns readline Ctrl+C into whole-session interruption and cleans listeners', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const interrupted = vi.fn();
    const adapter = createSessionInput(input, output, interrupted, vi.fn());
    const pending = adapter.read();
    input.write('\u0003');

    await expect(pending).resolves.toStrictEqual({ kind: 'interrupted' });
    expect(interrupted).toHaveBeenCalledTimes(1);
    adapter.close();
    expect(input.listenerCount('data')).toBe(0);
  });

  it('projects stream errors without exposing raw error text', async () => {
    const input = new PassThrough();
    const failed = vi.fn();
    const adapter = createSessionInput(input, new PassThrough(), vi.fn(), failed);
    const pending = adapter.read();
    input.emit('error', new Error('private terminal bytes'));

    await expect(pending).resolves.toStrictEqual({ kind: 'error' });
    expect(failed).toHaveBeenCalledTimes(1);
    adapter.close();
  });
});

describe('manual session CLI validation and lifecycle', () => {
  it('shows help without creating native or readline resources', async () => {
    const app = harness({ isStdinTTY: false, isStderrTTY: false });

    expect(await runManualChatSessionCli(['--help'], app.runtime)).toBe(0);
    expect(app.stdout.join('')).toContain('npc:session');
    expect(app.start).not.toHaveBeenCalled();
    expect(app.runtime.createInput).not.toHaveBeenCalled();
    expect(app.signals.size).toBe(0);
  });

  it.each([
    [['--unknown'], 'unknown_option'],
    [['--help', '--count', '2'], 'help_must_be_used_alone'],
    [['--count'], 'missing_option_value'],
    [['--count', '02'], 'invalid_count'],
    [['--count', '1'], 'invalid_count'],
    [['--count', '11'], 'invalid_count'],
  ])('rejects argv %j before resources with %s', async (argv, code) => {
    const app = harness();

    expect(await runManualChatSessionCli(argv, app.runtime)).toBe(1);
    expect(app.stderr).toStrictEqual([`${JSON.stringify({ error: code })}\n`]);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.runtime.createInput).not.toHaveBeenCalled();
  });

  it('rejects non-TTY operation before startup or input creation', async () => {
    const app = harness({ isStdinTTY: false });

    expect(await runManualChatSessionCli([], app.runtime)).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interactive_terminal_required"}\n']);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.runtime.createInput).not.toHaveBeenCalled();
  });

  it('logs in once and publishes only three validated related turns', async () => {
    const input = scriptedInput([
      { kind: 'line', value: 'first' }, { kind: 'line', value: 'second' },
      { kind: 'line', value: 'third' }, { kind: 'line', value: '/exit' },
    ]);
    let call = 0;
    const app = harness({ input, bridge: { text: vi.fn(async () => completed(call++ === 0 ? 'Ana' : 'ana')) } });

    expect(await runManualChatSessionCli(['--count', '2'], app.runtime)).toBe(0);
    expect(app.start).toHaveBeenCalledTimes(1);
    expect(app.bridge.login).toHaveBeenCalledTimes(1);
    expect(app.bridge.text).toHaveBeenCalledTimes(3);
    expect(app.stdout).toHaveLength(3);
    expect(app.stdout.join('')).not.toContain('"first"');
    expect(app.input.close).toHaveBeenCalledTimes(1);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.signals.size).toBe(0);
  });

  it('reprompts safe invalid input but ends after a generation failure without retry', async () => {
    const input = scriptedInput([
      { kind: 'line', value: '' }, { kind: 'line', value: '/unknown' },
      { kind: 'line', value: 'accepted' }, { kind: 'line', value: 'never-read' },
    ]);
    const app = harness({ input, bridge: { text: vi.fn(async () => { throw new Error('private provider'); }) } });

    expect(await runManualChatSessionCli([], app.runtime)).toBe(1);
    expect(app.bridge.text).toHaveBeenCalledTimes(1);
    expect(app.stdout).toStrictEqual([]);
    expect(app.stderr.join('')).toContain('unknown_command');
    expect(app.stderr.at(-1)).toBe('{"error":"generation_failed"}\n');
    expect(app.stderr.join('')).not.toContain('private provider');
  });

  it('finishes and publishes an accepted turn before honoring busy EOF', async () => {
    const inputStream = new PassThrough();
    const outputStream = new PassThrough();
    const pending = deferred<TextResult>();
    const app = harness({ bridge: { text: vi.fn(() => pending.promise) } });
    app.runtime.createInput = vi.fn((interrupt, error) =>
      createSessionInput(inputStream, outputStream, interrupt, error));
    const running = runManualChatSessionCli(['--count', '2'], app.runtime);
    await settle();
    inputStream.write('accepted\n');
    await settle();
    inputStream.end();
    pending.resolve(completed());

    expect(await running).toBe(0);
    expect(app.stdout).toHaveLength(1);
    expect(app.bridge.text).toHaveBeenCalledTimes(1);
  });

  it('closes a startup result that arrives after process cancellation', async () => {
    const startup = deferred<SessionCliBridge>();
    const app = harness({ start: () => startup.promise });
    const running = runManualChatSessionCli([], app.runtime);
    await settle();
    app.abort();
    startup.resolve(app.bridge);

    expect(await running).toBe(1);
    expect(app.stderr).toStrictEqual(['{\"error\":\"interrupted\"}\n']);
    expect(app.bridge.login).not.toHaveBeenCalled();
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.signals.size).toBe(0);
  });

  it('ends safely when the real input stream fails while ready', async () => {
    const inputStream = new PassThrough();
    const app = harness();
    app.runtime.createInput = vi.fn((interrupt, error) =>
      createSessionInput(inputStream, new PassThrough(), interrupt, error));
    const running = runManualChatSessionCli([], app.runtime);
    await settle();
    inputStream.emit('error', new Error('private input failure'));

    expect(await running).toBe(1);
    expect(app.stderr.at(-1)).toBe('{\"error\":\"input_failed\"}\n');
    expect(app.stderr.join('')).not.toContain('private input failure');
    expect(app.bridge.text).not.toHaveBeenCalled();
    expect(app.signals.size).toBe(0);
  });

  it('cancels login by closing transport and suppresses late ceremony', async () => {
    const login = deferred<unknown>();
    let ceremony: ((value: { verificationUrl: string; userCode: string }) => void) | undefined;
    const app = harness({ bridge: { login: vi.fn((callback) => { ceremony = callback; return login.promise; }) } });
    const running = runManualChatSessionCli([], app.runtime);
    await settle();
    app.abort();
    await settle();
    ceremony?.({ verificationUrl: 'https://auth.openai.com/late', userCode: 'SECRET' });
    login.resolve({});

    expect(await running).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interrupted"}\n']);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.runtime.createInput).not.toHaveBeenCalled();
  });

  it('cancels generation on Ctrl+C and never publishes late success', async () => {
    const pending = deferred<TextResult>();
    let signal: AbortSignal | undefined;
    const inputStream = new PassThrough();
    const app = harness({ bridge: { text: vi.fn((_prompt, options) => { signal = options?.signal; return pending.promise; }) } });
    app.runtime.createInput = vi.fn((interrupt, error) =>
      createSessionInput(inputStream, new PassThrough(), interrupt, error));
    const running = runManualChatSessionCli([], app.runtime);
    await settle();
    inputStream.write('accepted\n');
    await settle();
    inputStream.write('\u0003');
    pending.resolve(completed());

    expect(await running).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(app.stdout).toStrictEqual([]);
    expect(app.stderr.at(-1)).toBe('{"error":"interrupted"}\n');
    expect(app.signals.size).toBe(0);
  });

  it('honors cancellation during cleanup without retracting an earlier validated turn', async () => {
    const cleanup = deferred<void>();
    const cleanupStarted = deferred<void>();
    const input = scriptedInput([{ kind: 'line', value: 'accepted' }, { kind: 'eof' }]);
    const app = harness({ input, bridge: { close: vi.fn(() => {
      cleanupStarted.resolve();
      return cleanup.promise;
    }) } });
    const running = runManualChatSessionCli(['--count', '2'], app.runtime);
    await cleanupStarted.promise;
    app.abort();
    cleanup.resolve();

    expect(await running).toBe(1);
    expect(app.stdout).toHaveLength(1);
    expect(app.stderr.at(-1)).toBe('{\"error\":\"interrupted\"}\n');
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.signals.size).toBe(0);
  });
});

describe('manual session executable wiring', () => {
  const tsx = 'node_modules/tsx/dist/cli.mjs';

  it.each([
    [['--help'], 0],
    [['--unknown'], 1],
  ])('executes %j without a TTY or native startup', (argv, status) => {
    const result = spawnSync(process.execPath, [tsx, 'scripts/npc-session-cli.ts', ...argv], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
    });
    expect(result.status).toBe(status);
    if (status === 0) expect(result.stdout).toContain('npc:session');
    else expect(result.stderr).toBe('{"error":"unknown_option"}\n');
  });
});
