import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import { BridgeError } from '../src/codex/rpc.js';
import {
  runManualChatCli,
  type ChatCliBridge,
  type ChatCliRuntime,
} from '../src/npc/chat-cli.js';

const provenance: Omit<TextResult, 'response'> = {
  status: 'completed',
  model: 'gpt-test',
  requestedModel: 'gpt-test',
  resolvedModel: 'gpt-test',
  codexVersion: '0.154.0',
  serviceTier: 'default',
  effort: 'low',
  firstDeltaMs: 3,
  totalMs: 8,
};

function messages(count = 5): { username: string; message: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    username: index % 2 === 0 ? 'Ana' : 'Beto',
    message: `Message ${index + 1}`,
  }));
}

function completed(count = 5): TextResult {
  return { response: JSON.stringify(messages(count)), ...provenance };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type HarnessOptions = {
  isStderrTTY?: boolean;
  start?: () => Promise<ChatCliBridge>;
  bridge?: Partial<ChatCliBridge>;
};

function harness(options: HarnessOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const listeners = new Set<() => void>();
  const bridge: ChatCliBridge = {
    login: vi.fn(async (ceremony) => {
      ceremony({ verificationUrl: 'https://auth.openai.com/device', userCode: 'TEST-CODE' });
      return { planType: 'plus' };
    }),
    text: vi.fn(async () => completed()),
    close: vi.fn(async () => {}),
    ...options.bridge,
  };
  const start = vi.fn(options.start ?? (async () => bridge));
  const runtime: ChatCliRuntime = {
    start,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
    isStderrTTY: options.isStderrTTY ?? true,
    onSignal: (listener) => listeners.add(listener),
    offSignal: (listener) => listeners.delete(listener),
  };
  return {
    bridge,
    listeners,
    runtime,
    start,
    stderr,
    stdout,
    abort: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('manual chat CLI argument and boundary validation', () => {
  it('shows help alone without TTY, startup, or signal listeners', async () => {
    const app = harness({ isStderrTTY: false });

    const exitCode = await runManualChatCli(['--help'], app.runtime);

    expect(exitCode).toBe(0);
    expect(app.stdout.join('')).toContain('npc:chat');
    expect(app.stderr).toStrictEqual([]);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
  });

  it.each([
    [['--wat'], 'unknown_option'],
    [['event'], 'unexpected_argument'],
    [['--event'], 'missing_option_value'],
    [['--count'], 'missing_option_value'],
    [['--event', 'x', '--event', 'y'], 'duplicate_option'],
    [['--event', 'x', '--count', '5', '--count', '6'], 'duplicate_option'],
    [['--help', '--event', 'x'], 'help_must_be_used_alone'],
    [['--event', 'x', '--help'], 'help_must_be_used_alone'],
    [['--event', 'x', '--count', '02'], 'invalid_count'],
    [['--event', 'x', '--count', '2.0'], 'invalid_count'],
    [['--event', 'x', '--count', '+2'], 'invalid_count'],
    [['--event', 'x', '--count', '11'], 'invalid_count'],
  ])('rejects argv %j before startup with %s', async (argv, error) => {
    const app = harness();

    const exitCode = await runManualChatCli(argv, app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual([`${JSON.stringify({ error })}\n`]);
    expect(app.stdout).toStrictEqual([]);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
  });

  it.each([
    [[], 'invalid_event'],
    [['--event', ' \n '], 'invalid_event'],
    [['--event', 'x', '--count', '1'], 'invalid_count'],
  ])('prevalidates input %j before startup with %s', async (argv, error) => {
    const app = harness();

    const exitCode = await runManualChatCli(argv, app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual([`${JSON.stringify({ error })}\n`]);
    expect(app.start).not.toHaveBeenCalled();
  });

  it('prevalidates the fully escaped prompt before startup', async () => {
    const app = harness();

    const exitCode = await runManualChatCli(['--event', '"\\'.repeat(4000)], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"prompt_limit"}\n']);
    expect(app.start).not.toHaveBeenCalled();
  });

  it('rejects escaped-only prompt overflow while the raw event remains below the limit', async () => {
    const app = harness();
    const event = '\u0000'.repeat(700);
    expect(event.length).toBeLessThan(4000);

    const exitCode = await runManualChatCli(['--event', event], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"prompt_limit"}\n']);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.bridge.login).not.toHaveBeenCalled();
  });

  it('requires an interactive stderr only after valid input', async () => {
    const app = harness({ isStderrTTY: false });

    const exitCode = await runManualChatCli(['--event', 'Goal'], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interactive_terminal_required"}\n']);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
  });
});

describe('manual chat CLI lifecycle and safe projection', () => {
  it('owns one startup, login, text call, close, and validated JSON output', async () => {
    const app = harness();

    const exitCode = await runManualChatCli(['--event', 'Goal', '--count', '5'], app.runtime);

    expect(exitCode).toBe(0);
    expect(app.start).toHaveBeenCalledTimes(1);
    expect(app.bridge.login).toHaveBeenCalledTimes(1);
    expect(app.bridge.text).toHaveBeenCalledTimes(1);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.listeners.size).toBe(0);
    expect(app.stderr).toStrictEqual([
      'Open https://auth.openai.com/device in your browser and enter TEST-CODE.\n',
    ]);
    const output = JSON.parse(app.stdout.join('')) as Record<string, unknown>;
    expect(output).toStrictEqual({ messages: messages(), ...provenance });
    expect(app.stdout.join('')).not.toContain('Goal');
    expect(app.stdout.join('')).not.toContain('planType');
  });

  it('uses the shared default and boundary count validation', async () => {
    for (const count of [undefined, 2, 10]) {
      const app = harness({ bridge: { text: vi.fn(async () => completed(count ?? 5)) } });
      const argv = count === undefined ? ['--event', 'Goal'] : ['--event', 'Goal', '--count', String(count)];

      const exitCode = await runManualChatCli(argv, app.runtime);

      expect(exitCode).toBe(0);
      expect(app.bridge.text).toHaveBeenCalledTimes(1);
      expect(JSON.parse(app.stdout.join('')).messages).toHaveLength(count ?? 5);
    }
  });

  it.each([
    ['startup', () => harness({ start: async () => { throw new Error('secret startup'); } }), 'startup_failed', 0],
    ['login', () => harness({ bridge: { login: async () => { throw new Error('secret account'); } } }), 'authentication_failed', 1],
    ['text', () => harness({ bridge: { text: async () => { throw new Error('secret response'); } } }), 'generation_failed', 1],
  ])('projects an unknown secret-bearing %s failure safely', async (_phase, create, error, closeCount) => {
    const app = create();

    const exitCode = await runManualChatCli(['--event', 'Goal'], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr.at(-1)).toBe(`${JSON.stringify({ error })}\n`);
    expect(app.stderr.join('')).not.toContain('secret');
    expect(app.stdout).toStrictEqual([]);
    expect(app.bridge.close).toHaveBeenCalledTimes(closeCount);
    expect(app.listeners.size).toBe(0);
  });

  it('maps adapter failures without exposing raw response data', async () => {
    const app = harness({ bridge: {
      text: async () => ({ ...completed(), response: 'private malformed response' }),
    } });

    const exitCode = await runManualChatCli(['--event', 'Goal'], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr.at(-1)).toBe('{"error":"invalid_response"}\n');
    expect(app.stderr.join('')).not.toContain('private');
    expect(app.stdout).toStrictEqual([]);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup failure safely instead of printing successful output', async () => {
    const app = harness({ bridge: { close: async () => { throw new Error('secret close'); } } });

    const exitCode = await runManualChatCli(['--event', 'Goal'], app.runtime);

    expect(exitCode).toBe(1);
    expect(app.stderr.at(-1)).toBe('{"error":"cleanup_failed"}\n');
    expect(app.stderr.join('')).not.toContain('secret');
    expect(app.stdout).toStrictEqual([]);
    expect(app.listeners.size).toBe(0);
  });
});

describe('manual chat CLI cancellation races', () => {
  it('closes a startup result that arrives after cancellation and starts no ceremony', async () => {
    const pendingStart = deferred<ChatCliBridge>();
    const app = harness({ start: () => pendingStart.promise });
    const running = runManualChatCli(['--event', 'Goal'], app.runtime);
    await settle();

    app.abort();
    pendingStart.resolve(app.bridge);
    const exitCode = await running;

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interrupted"}\n']);
    expect(app.bridge.login).not.toHaveBeenCalled();
    expect(app.bridge.text).not.toHaveBeenCalled();
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.listeners.size).toBe(0);
  });

  it('closes pending login, suppresses late ceremony, and never calls text', async () => {
    const pendingLogin = deferred<unknown>();
    let ceremony: ((value: { verificationUrl: string; userCode: string }) => void) | undefined;
    const app = harness({ bridge: {
      login: vi.fn((callback) => {
        ceremony = callback;
        return pendingLogin.promise;
      }),
    } });
    const running = runManualChatCli(['--event', 'Goal'], app.runtime);
    await settle();

    app.abort();
    await settle();
    ceremony?.({ verificationUrl: 'https://auth.openai.com/late', userCode: 'LATE-CODE' });
    pendingLogin.resolve({ planType: 'plus' });
    const exitCode = await running;

    expect(exitCode).toBe(1);
    expect(app.stderr).toStrictEqual(['{"error":"interrupted"}\n']);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.bridge.text).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
  });

  it('forwards text cancellation to the bridge and prints no batch', async () => {
    let textSignal: AbortSignal | undefined;
    const app = harness({ bridge: {
      text: vi.fn(async (_prompt, options) => {
        textSignal = options?.signal;
        return new Promise<TextResult>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new BridgeError('aborted')), { once: true });
        });
      }),
    } });
    const running = runManualChatCli(['--event', 'Goal'], app.runtime);
    await settle();
    await settle();

    app.abort();
    const exitCode = await running;

    expect(textSignal?.aborted).toBe(true);
    expect(exitCode).toBe(1);
    expect(app.stderr.at(-1)).toBe('{"error":"interrupted"}\n');
    expect(app.stdout).toStrictEqual([]);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.listeners.size).toBe(0);
  });

  it('publishes no batch when cancellation arrives during successful cleanup', async () => {
    const pendingClose = deferred<void>();
    const closeStarted = deferred<void>();
    const app = harness({ bridge: {
      close: vi.fn(() => {
        closeStarted.resolve();
        return pendingClose.promise;
      }),
    } });
    const running = runManualChatCli(['--event', 'Goal'], app.runtime);
    await closeStarted.promise;

    app.abort();
    app.abort();
    pendingClose.resolve();
    const exitCode = await running;

    expect(exitCode).toBe(1);
    expect(app.stderr.at(-1)).toBe('{"error":"interrupted"}\n');
    expect(app.stdout).toStrictEqual([]);
    expect(app.bridge.text).toHaveBeenCalledTimes(1);
    expect(app.bridge.close).toHaveBeenCalledTimes(1);
    expect(app.listeners.size).toBe(0);
  });
});

describe('manual chat executable wiring', () => {
  const tsx = 'node_modules/tsx/dist/cli.mjs';

  it('executes help without a TTY or native startup', () => {
    const result = spawnSync(process.execPath, [tsx, 'scripts/npc-chat-cli.ts', '--help'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('npc:chat');
    expect(result.stderr).toBe('');
  });

  it('executes invalid argv without a TTY or native startup', () => {
    const result = spawnSync(process.execPath, [tsx, 'scripts/npc-chat-cli.ts', '--unknown'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('{"error":"unknown_option"}\n');
  });
});
