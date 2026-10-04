import { describe, expect, it, vi } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import { PRESENTATION_MESSAGE_LIMIT, PresentationPublisher } from '../src/npc/publisher.js';
import {
  runManualChatSessionCli,
  type SessionCliBridge,
  type SessionCliRuntime,
  type SessionInputResult,
} from '../src/npc/session-cli.js';

const result: TextResult = {
  response: JSON.stringify([
    { username: 'Ana', message: 'Hola' },
    { username: 'Beto', message: 'Vamos' },
  ]),
  status: 'completed',
  model: 'gpt-test',
  requestedModel: 'gpt-test',
  resolvedModel: 'gpt-test',
  codexVersion: '0.154.0',
  serviceTier: 'default',
  effort: 'low',
  firstDeltaMs: 1,
  totalMs: 2,
};

function runtimeFor(lines: SessionInputResult[], bridge: SessionCliBridge): SessionCliRuntime {
  return {
    start: async () => bridge,
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    isStdinTTY: true,
    isStderrTTY: true,
    createInput: () => ({
      read: vi.fn(async (): Promise<SessionInputResult> => lines.shift() ?? { kind: 'eof' }),
      close: vi.fn(),
    }),
    onSignal: vi.fn(),
    offSignal: vi.fn(),
  };
}

describe('session publication boundary', () => {
  it('publishes one copied sanitized batch after successful stdout', async () => {
    const bridge: SessionCliBridge = {
      login: vi.fn(async () => ({})),
      text: vi.fn(async () => result),
      close: vi.fn(async () => {}),
    };
    const runtime = runtimeFor([
      { kind: 'line', value: 'accepted event' },
      { kind: 'line', value: '/exit' },
    ], bridge);
    const publish = vi.fn();

    const status = await runManualChatSessionCli(['--count', '2'], runtime, publish);

    expect(status).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith([
      { username: 'Ana', message: 'Hola' },
      { username: 'Beto', message: 'Vamos' },
    ], expect.any(AbortSignal));
    expect(publish.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(runtime.stdout.write).mock.invocationCallOrder[0] ?? 0,
    );
    result.response = 'changed source response';
    expect(publish.mock.calls[0]?.[0]).toStrictEqual([
      { username: 'Ana', message: 'Hola' },
      { username: 'Beto', message: 'Vamos' },
    ]);
    result.response = JSON.stringify([
      { username: 'Ana', message: 'Hola' },
      { username: 'Beto', message: 'Vamos' },
    ]);
  });

  it('does not publish when cancellation arrives during the stdout write', async () => {
    const bridge: SessionCliBridge = {
      login: vi.fn(async () => ({})),
      text: vi.fn(async () => result),
      close: vi.fn(async () => {}),
    };
    const runtime = runtimeFor([{ kind: 'line', value: 'accepted event' }], bridge);
    let signal: (() => void) | undefined;
    runtime.onSignal = (listener) => { signal = listener; };
    runtime.offSignal = () => { signal = undefined; };
    runtime.stdout.write = vi.fn(() => { signal?.(); return true; });
    const publish = vi.fn();

    expect(await runManualChatSessionCli(['--count', '2'], runtime, publish)).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it('does not publish failed generation output', async () => {
    const bridge: SessionCliBridge = {
      login: vi.fn(async () => ({})),
      text: vi.fn(async () => { throw new Error('private provider failure'); }),
      close: vi.fn(async () => {}),
    };
    const runtime = runtimeFor([{ kind: 'line', value: 'accepted event' }], bridge);
    const publish = vi.fn();

    expect(await runManualChatSessionCli(['--count', '2'], runtime, publish)).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('bounded presentation publisher', () => {
  it('retains the latest 100 messages and defensively copies snapshots', () => {
    const publisher = new PresentationPublisher();
    const messages = Array.from({ length: PRESENTATION_MESSAGE_LIMIT + 5 }, (_, index) => ({
      username: `User ${index}`,
      message: `Message ${index}`,
    }));

    publisher.publish(messages);
    const snapshot = publisher.snapshot();
    messages[5]!.username = 'changed input';
    (snapshot.messages[0] as { username: string }).username = 'changed snapshot';

    expect(publisher.snapshot().messages).toHaveLength(PRESENTATION_MESSAGE_LIMIT);
    expect(publisher.snapshot().messages[0]).toStrictEqual({
      id: '6',
      username: 'User 5',
      message: 'Message 5',
    });
  });

  it('delivers complete replacement snapshots to every subscriber', () => {
    const publisher = new PresentationPublisher();
    const first: unknown[] = [];
    const second: unknown[] = [];
    const stopFirst = publisher.subscribe((snapshot) => first.push(snapshot));
    publisher.publish([{ username: 'Ana', message: 'Uno' }]);
    publisher.subscribe((snapshot) => second.push(snapshot));
    publisher.publish([{ username: 'Beto', message: 'Dos' }]);
    stopFirst();

    expect(first.map((snapshot) =>
      (snapshot as { stream: string; messages: Array<{ username: string; message: string }> }).messages.map(
        ({ username, message }) => ({ username, message }),
      ),
    )).toStrictEqual([
      [],
      [{ username: 'Ana', message: 'Uno' }],
      [{ username: 'Ana', message: 'Uno' }, { username: 'Beto', message: 'Dos' }],
    ]);
    expect(second.map((snapshot) =>
      (snapshot as { stream: string; messages: Array<{ username: string; message: string }> }).messages.map(
        ({ username, message }) => ({ username, message }),
      ),
    )).toStrictEqual([
      [{ username: 'Ana', message: 'Uno' }],
      [{ username: 'Ana', message: 'Uno' }, { username: 'Beto', message: 'Dos' }],
    ]);
    const streams = new Set([...first, ...second].map((snapshot) =>
      (snapshot as { stream: string }).stream,
    ));
    expect(streams.size).toBe(1);
  });
});
