import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import { createPacedPublication, type PacingSchedule } from '../src/npc/pacing.js';
import type { PresentationPublisher } from '../src/npc/publisher.js';
import type { PresentationServer } from '../src/npc/presentation-server.js';
import { runServeCli, type ServeCliRuntime } from '../src/npc/serve-cli.js';
import type { SessionCliBridge, SessionInputResult } from '../src/npc/session-cli.js';

const result: TextResult = {
  response: JSON.stringify([
    { username: 'Ana', message: 'Hola' },
    { username: 'Beto', message: 'Vamos' },
  ]),
  status: 'completed', model: 'gpt-test', requestedModel: 'gpt-test', resolvedModel: 'gpt-test',
  codexVersion: '0.154.0', serviceTier: 'default', effort: 'low', firstDeltaMs: 1, totalMs: 2,
};

type HarnessOptions = {
  stdinTTY?: boolean;
  stderrTTY?: boolean;
  lines?: SessionInputResult[];
  serverStart?: () => Promise<number>;
  text?: () => Promise<TextResult>;
  pacedSchedule?: PacingSchedule;
};

function harness(options: HarnessOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const signals = new Set<() => void>();
  const bridge: SessionCliBridge = {
    login: vi.fn(async () => ({})),
    text: vi.fn(options.text ?? (async () => result)),
    close: vi.fn(async () => {}),
  };
  const start = vi.fn(async () => bridge);
  const server: PresentationServer = {
    start: vi.fn(options.serverStart ?? (async () => 4321)),
    close: vi.fn(async () => {}),
  };
  let publisher: PresentationPublisher | undefined;
  const createPresentationServer = vi.fn((createdPublisher: PresentationPublisher) => {
    publisher = createdPublisher;
    return server;
  });
  const lines = options.lines ?? [{ kind: 'eof' }];
  const scheduledDelays: number[] = [];
  const schedule: PacingSchedule = options.pacedSchedule ?? ((callback, delayMs) => {
    scheduledDelays.push(delayMs);
    const timer = setImmediate(callback);
    return () => clearImmediate(timer);
  });
  const createPaced = vi.fn((createdPublisher: PresentationPublisher) =>
    createPacedPublication(createdPublisher, { schedule, random: () => 0 }));
  const runtime: ServeCliRuntime = {
    start,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    isStdinTTY: options.stdinTTY ?? true,
    isStderrTTY: options.stderrTTY ?? true,
    createInput: () => ({
      read: vi.fn(async (): Promise<SessionInputResult> => lines.shift() ?? { kind: 'eof' }),
      close: vi.fn(),
    }),
    onSignal: (listener) => signals.add(listener),
    offSignal: (listener) => signals.delete(listener),
    createPresentationServer,
    createPacedPublication: createPaced,
  };
  return { bridge, createPaced, publisher: () => publisher, runtime, scheduledDelays, server, signals, start, stderr, stdout };
}

describe('presentation session CLI composition', () => {
  it.each([
    [['--help'], 0, ''],
    [['--port', '1023'], 1, 'invalid_port'],
    [['--port', '65536'], 1, 'invalid_port'],
    [['--port'], 1, 'missing_option_value'],
    [['--port', '4177', '--port', '4177'], 1, 'unknown_option'],
    [['--unknown', 'x'], 1, 'unknown_option'],
  ])('handles preflight argv %j before server or bridge startup', async (argv, status, error) => {
    const app = harness();

    expect(await runServeCli(argv, app.runtime)).toBe(status);
    expect(app.runtime.createPresentationServer).not.toHaveBeenCalled();
    expect(app.start).not.toHaveBeenCalled();
    if (error.length === 0) expect(app.stdout.join('')).toContain('npc:serve');
    else expect(app.stderr).toStrictEqual([`${JSON.stringify({ error })}\n`]);
  });

  it('rejects non-TTY use before creating presentation or authentication resources', async () => {
    const app = harness({ stdinTTY: false });

    expect(await runServeCli([], app.runtime)).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interactive_terminal_required"}\n']);
    expect(app.runtime.createPresentationServer).not.toHaveBeenCalled();
    expect(app.start).not.toHaveBeenCalled();
  });

  it('closes a failed port startup before bridge authentication', async () => {
    const app = harness({ serverStart: async () => { throw new Error('busy'); } });

    expect(await runServeCli(['--port', '4177'], app.runtime)).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"presentation_start_failed"}\n']);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.server.close).toHaveBeenCalledTimes(1);
  });

  it('runs one session bridge and publishes the sanitized batch to the shared server', async () => {
    const app = harness({ lines: [
      { kind: 'line', value: 'accepted event' },
      { kind: 'line', value: '/exit' },
    ] });

    expect(await runServeCli(['--count', '2', '--port', '4321'], app.runtime)).toBe(0);
    expect(app.server.start).toHaveBeenCalledTimes(1);
    expect(app.start).toHaveBeenCalledTimes(1);
    expect(app.bridge.login).toHaveBeenCalledTimes(1);
    expect(app.bridge.text).toHaveBeenCalledTimes(1);
    expect(app.createPaced).toHaveBeenCalledTimes(1);
    const finalSnapshot = app.publisher()?.snapshot();
    expect(finalSnapshot?.messages).toStrictEqual([
      { id: '1', username: 'Ana', message: 'Hola' },
      { id: '2', username: 'Beto', message: 'Vamos' },
    ]);
    expect(finalSnapshot?.stream).toMatch(/^npc-stream-/);
    expect(app.scheduledDelays).toStrictEqual([1000]);
    expect(app.scheduledDelays.every((delay) => delay >= 1000 && delay <= 3000)).toBe(true);
    expect(app.stderr.join('')).toContain('Reading panel: http://127.0.0.1:4321/');
    expect(app.stderr.join('')).toContain('OBS overlay: http://127.0.0.1:4321/overlay');
    expect(app.server.close).toHaveBeenCalledTimes(1);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.signals.size).toBe(0);
  });

  it('closes presentation resources after generation failure without exposing provider errors', async () => {
    const app = harness({
      lines: [{ kind: 'line', value: 'accepted event' }],
      text: async () => { throw new Error('private provider failure'); },
    });

    expect(await runServeCli(['--count', '2'], app.runtime)).toBe(1);
    expect(app.server.close).toHaveBeenCalledTimes(1);
    expect(app.publisher()?.snapshot().messages).toStrictEqual([]);
    expect(app.stderr.join('')).not.toContain('private provider failure');
  });

  it('disposes the paced publication before closing the presentation server', async () => {
    const app = harness({ lines: [{ kind: 'eof' }] });

    expect(await runServeCli([], app.runtime)).toBe(0);
    expect(app.createPaced).toHaveBeenCalledTimes(1);
    expect(app.server.close).toHaveBeenCalledTimes(1);
    expect(app.publisher()?.snapshot().messages).toHaveLength(0);
  });
});

describe('presentation executable wiring', () => {
  it('shows help without a TTY or native startup', () => {
    const result = spawnSync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs', 'scripts/npc-serve-cli.ts', '--help',
    ], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('npc:serve');
    expect(result.stderr).toBe('');
  });
});
