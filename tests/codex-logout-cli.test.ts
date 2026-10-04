import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { runLogoutCli, type LogoutBridge, type LogoutCliRuntime } from '../src/npc/logout-cli.js';
import { BridgeError } from '../src/codex/rpc.js';

function harness(options: {
  isStdinTTY?: boolean;
  isStderrTTY?: boolean;
  start?: () => Promise<LogoutBridge>;
  logout?: () => Promise<void>;
  close?: () => Promise<void>;
} = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const signals = new Set<() => void>();
  const logout = vi.fn(options.logout ?? (async () => {}));
  const close = vi.fn(options.close ?? (async () => {}));
  const start = vi.fn(options.start ?? (async () => ({ logout, close })));
  const runtime: LogoutCliRuntime = {
    start,
    stdout: { write: (text) => { stdout.push(text); return true; } },
    stderr: { write: (text) => { stderr.push(text); return true; } },
    isStdinTTY: options.isStdinTTY ?? true,
    isStderrTTY: options.isStderrTTY ?? true,
    onSignal: (listener) => { signals.add(listener); },
    offSignal: (listener) => { signals.delete(listener); },
  };
  return { runtime, stdout, stderr, signals, start, logout, close, abort: () => { for (const listener of [...signals]) listener(); } };
}

describe('logout argument and terminal gates', () => {
  it.each([
    [['--help'], 0],
    [['--help', '--confirm'], 1],
    [['--unknown'], 1],
    [['extra'], 1],
    [[], 1],
    [['--confirm', '--confirm'], 1],
  ])('handles %j without starting the bridge', async (argv, status) => {
    const app = harness();
    expect(await runLogoutCli(argv, app.runtime)).toBe(status);
    expect(app.start).not.toHaveBeenCalled();
    expect(app.logout).not.toHaveBeenCalled();
    if (status === 0) {
      expect(app.stdout.join('')).toContain('npc:logout');
      expect(app.stderr).toEqual([]);
    } else {
      expect(app.stdout).toEqual([]);
    }
  });

  it('rejects an unknown option after confirmation without starting', async () => {
    const app = harness();
    expect(await runLogoutCli(['--confirm', '--force'], app.runtime)).toBe(1);
    expect(app.stderr).toEqual(['{"error":"unknown_option"}\n']);
    expect(app.start).not.toHaveBeenCalled();
  });

  it('requires both interactive terminals before starting the bridge', async () => {
    const stdin = harness({ isStdinTTY: false });
    expect(await runLogoutCli(['--confirm'], stdin.runtime)).toBe(1);
    expect(stdin.stderr).toEqual(['{"error":"interactive_terminal_required"}\n']);
    expect(stdin.start).not.toHaveBeenCalled();

    const stderr = harness({ isStderrTTY: false });
    expect(await runLogoutCli(['--confirm'], stderr.runtime)).toBe(1);
    expect(stderr.stderr).toEqual(['{"error":"interactive_terminal_required"}\n']);
    expect(stderr.start).not.toHaveBeenCalled();
  });
});

describe('logout lifecycle', () => {
  it('logs out once, closes without login or inference, and prints only fixed output', async () => {
    const app = harness();
    expect(await runLogoutCli(['--confirm'], app.runtime)).toBe(0);
    expect(app.start).toHaveBeenCalledTimes(1);
    expect(app.logout).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.stdout).toEqual(['{"loggedOut":true}\n']);
    expect(app.stderr).toEqual([]);
    expect(app.signals.size).toBe(0);
  });

  it('maps a held profile to a bounded busy error without logging out', async () => {
    const app = harness({ start: async () => { throw new BridgeError('profile_busy'); } });
    expect(await runLogoutCli(['--confirm'], app.runtime)).toBe(1);
    expect(app.stderr).toEqual(['{"error":"profile_busy"}\n']);
    expect(app.logout).not.toHaveBeenCalled();
    expect(app.close).not.toHaveBeenCalled();
  });

  it('projects an unexpected startup failure and a malformed logout as bounded errors', async () => {
    const startup = harness({ start: async () => { throw new Error('private detail'); } });
    expect(await runLogoutCli(['--confirm'], startup.runtime)).toBe(1);
    expect(startup.stderr).toEqual(['{"error":"startup_failed"}\n']);

    const malformed = harness({ logout: async () => { throw new BridgeError('logout_failed'); } });
    expect(await runLogoutCli(['--confirm'], malformed.runtime)).toBe(1);
    expect(malformed.stderr).toEqual(['{"error":"logout_failed"}\n']);
    expect(malformed.close).toHaveBeenCalledTimes(1);
    expect(malformed.stdout).toEqual([]);
  });

  it('never reports confirmed success for an interrupted logout and always cleans up', async () => {
    let release!: () => void;
    const app = harness({
      logout: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const running = runLogoutCli(['--confirm'], app.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    app.abort();
    release();
    expect(await running).toBe(1);
    expect(app.stdout).toEqual([]);
    expect(app.stderr).toEqual(['{"error":"interrupted"}\n']);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.signals.size).toBe(0);
  });

  it('closes the owned bridge and never logs out when a signal interrupts startup', async () => {
    let release!: (bridge: LogoutBridge) => void;
    const app = harness({ start: () => new Promise<LogoutBridge>((resolve) => { release = resolve; }) });
    const running = runLogoutCli(['--confirm'], app.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    app.abort();
    release({ logout: app.logout, close: app.close });
    expect(await running).toBe(1);
    expect(app.logout).not.toHaveBeenCalled();
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.stdout).toEqual([]);
    expect(app.stderr).toEqual(['{"error":"interrupted"}\n']);
    expect(app.signals.size).toBe(0);
  });

  it('keeps a confirmed logout successful when a signal arrives during cleanup', async () => {
    let releaseClose!: () => void;
    const app = harness({ close: () => new Promise<void>((resolve) => { releaseClose = resolve; }) });
    const running = runLogoutCli(['--confirm'], app.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    app.abort();
    releaseClose();
    expect(await running).toBe(0);
    expect(app.stdout).toEqual(['{"loggedOut":true}\n']);
    expect(app.stderr).toEqual([]);
    expect(app.signals.size).toBe(0);
  });

  it('reports cleanup failure instead of confirmed success when close fails', async () => {
    const app = harness({ close: async () => { throw new Error('cleanup detail'); } });
    expect(await runLogoutCli(['--confirm'], app.runtime)).toBe(1);
    expect(app.stdout).toEqual([]);
    expect(app.stderr).toEqual(['{"error":"cleanup_failed"}\n']);
    expect(app.signals.size).toBe(0);
  });
});

describe('logout executable wiring', () => {
  const tsx = 'node_modules/tsx/dist/cli.mjs';

  it.each([
    [['--help'], 0],
    [['--unknown'], 1],
  ])('executes %j without a TTY or native startup', (argv, status) => {
    const result = spawnSync(process.execPath, [tsx, 'scripts/npc-logout-cli.ts', ...argv], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
    });
    expect(result.status).toBe(status);
    if (status === 0) expect(result.stdout).toContain('npc:logout');
    else expect(result.stderr).toBe('{"error":"unknown_option"}\n');
  });
});
