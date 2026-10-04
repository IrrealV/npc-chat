import { request as httpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import { ManualChatError } from '../src/npc/chat.js';
import { createPacedPublication, type PacingSchedule } from '../src/npc/pacing.js';
import { PresentationPublisher } from '../src/npc/publisher.js';
import { createPresentationServer } from '../src/npc/presentation-server.js';
import { runManualChatSessionCli, type SessionCliBridge, type SessionCliRuntime, type SessionInputResult } from '../src/npc/session-cli.js';
import { runServeCli, type ServeCliRuntime } from '../src/npc/serve-cli.js';

const result: TextResult = {
  response: JSON.stringify([
    { username: 'Ana', message: 'Hola' },
    { username: 'Beto', message: 'Vamos' },
  ]),
  status: 'completed', model: 'gpt-test', requestedModel: 'gpt-test', resolvedModel: 'gpt-test',
  codexVersion: '0.154.0', serviceTier: 'default', effort: 'low', firstDeltaMs: 1, totalMs: 2,
};

const batch = [
  { username: 'Ana', message: 'Hola' },
  { username: 'Beto', message: 'Vamos' },
  { username: 'Cata', message: 'Tres' },
];

function manualScheduler(): {
  schedule: PacingSchedule;
  delays: () => number[];
  recorded: () => number[];
  fireNext: () => void;
  size: () => number;
} {
  const queue: Array<{ callback: () => void; delayMs: number }> = [];
  const scheduled: number[] = [];
  const schedule: PacingSchedule = (callback, delayMs) => {
    scheduled.push(delayMs);
    queue.push({ callback, delayMs });
    return () => {
      const index = queue.findIndex((entry) => entry.callback === callback);
      if (index >= 0) queue.splice(index, 1);
    };
  };
  return {
    schedule,
    delays: () => queue.map((entry) => entry.delayMs),
    recorded: () => [...scheduled],
    fireNext: () => { queue.shift()?.callback(); },
    size: () => queue.length,
  };
}

type SettleState = 'settled' | 'rejected' | 'hung';

async function settleState(publication: void | Promise<void>): Promise<SettleState> {
  return Promise.race([
    Promise.resolve(publication).then(
      () => 'settled' as const,
      () => 'rejected' as const,
    ),
    new Promise<SettleState>((resolve) => { setTimeout(() => resolve('hung'), 20); }),
  ]);
}

function fakeSignal(): { signal: AbortSignal; listeners: Array<() => void>; abort: () => void } {
  const listeners: Array<() => void> = [];
  const state = { aborted: false };
  const signal = {
    get aborted() { return state.aborted; },
    addEventListener: (_type: string, listener: () => void) => { listeners.push(listener); },
    removeEventListener: (_type: string, listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  } as unknown as AbortSignal;
  return {
    signal,
    listeners,
    abort: () => {
      state.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

function sessionRuntime(
  lines: SessionInputResult[],
  stderr: string[] = [],
  bridgeOverride: Partial<SessionCliBridge> = {},
): SessionCliRuntime {
  const bridge: SessionCliBridge = {
    login: vi.fn(async () => ({})),
    text: vi.fn(async () => result),
    close: vi.fn(async () => {}),
    ...bridgeOverride,
  };
  return {
    start: async () => bridge,
    stdout: { write: vi.fn(() => true) },
    stderr: { write: (text) => { stderr.push(text); return true; } },
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

describe('presentation identity', () => {
  it('carries a publisher stream identity and stable presentation IDs in snapshots', () => {
    const publisher = new PresentationPublisher();

    publisher.publish([{ username: 'Ana', message: 'Hola' }]);
    const first = publisher.snapshot();
    publisher.publish([{ username: 'Beto', message: 'Vamos' }]);
    const second = publisher.snapshot();

    expect(typeof first.stream).toBe('string');
    expect(first.stream.length).toBeGreaterThan(0);
    expect(second.stream).toBe(first.stream);
    expect(first.messages.map((message) => message.id)).toStrictEqual(['1']);
    expect(second.messages.map((message) => message.id)).toStrictEqual(['1', '2']);
    expect(publisher.snapshot().messages.map((message) => message.id)).toStrictEqual(['1', '2']);
  });

  it('keeps duplicate identical messages as distinct arrivals with distinct IDs', () => {
    const publisher = new PresentationPublisher();
    publisher.publish([{ username: 'Ana', message: 'Hola' }]);
    publisher.publish([{ username: 'Ana', message: 'Hola' }]);

    const snapshot = publisher.snapshot();
    expect(snapshot.messages).toHaveLength(2);
    expect(new Set(snapshot.messages.map((message) => message.id)).size).toBe(2);
    expect(snapshot.messages[0]).toStrictEqual({ id: '1', username: 'Ana', message: 'Hola' });
    expect(snapshot.messages[1]).toStrictEqual({ id: '2', username: 'Ana', message: 'Hola' });
  });

  it('gives a restarted publisher a different stream identity', () => {
    const first = new PresentationPublisher();
    const second = new PresentationPublisher();
    first.publish([{ username: 'Ana', message: 'Hola' }]);
    second.publish([{ username: 'Ana', message: 'Hola' }]);

    expect(first.snapshot().stream).not.toBe(second.snapshot().stream);
  });
});

describe('session asynchronous publication boundary', () => {
  it('passes an abort signal to publication and waits for it before the next prompt', async () => {
    const stderr: string[] = [];
    const lines: SessionInputResult[] = [
      { kind: 'line', value: 'accepted event' },
      { kind: 'line', value: '/exit' },
    ];
    const runtime = sessionRuntime(lines, stderr);
    const timeline: string[] = [];
    let receivedSignal: AbortSignal | undefined;
    let releasePublication: (() => void) | undefined;
    const publicationGate = new Promise<void>((resolve) => { releasePublication = resolve; });
    const publish = vi.fn(async (messages: unknown, signal: AbortSignal | undefined): Promise<void> => {
      receivedSignal = signal;
      timeline.push('publish:batch');
      await publicationGate;
      timeline.push('publish-done');
    });
    const promptWrite = runtime.stderr.write;
    runtime.stderr.write = (text) => {
      if (text === 'event> ') timeline.push('prompt');
      return promptWrite(text);
    };

    const running = runManualChatSessionCli(['--count', '2'], runtime, publish);
    await vi.waitFor(() => expect(timeline).toContain('publish:batch'));
    releasePublication?.();
    expect(await running).toBe(0);

    expect(stderr.filter((text) => text === 'event> ')).toHaveLength(2);
    expect(receivedSignal).toBeDefined();
    expect(timeline).toStrictEqual(['prompt', 'publish:batch', 'publish-done', 'prompt']);
  });

  it('cancels paced presentation immediately while bridge cleanup is still blocked', async () => {
    const stderr: string[] = [];
    let closeStartedResolve: (() => void) | undefined;
    const closeStarted = new Promise<void>((resolve) => { closeStartedResolve = resolve; });
    const runtime = sessionRuntime([{ kind: 'line', value: 'accepted event' }], stderr);
    let resolveClose: (() => void) | undefined;
    const closeBlocked = new Promise<void>((resolve) => { resolveClose = resolve; });
    runtime.start = async () => ({
      login: vi.fn(async () => ({})),
      text: vi.fn(async () => result),
      close: vi.fn(() => {
        closeStartedResolve?.();
        return closeBlocked;
      }),
    });

    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const signals: Array<() => void> = [];
    runtime.onSignal = (listener) => { signals.push(listener); };
    runtime.offSignal = (listener) => {
      const index = signals.indexOf(listener);
      if (index >= 0) signals.splice(index, 1);
    };
    const running = runManualChatSessionCli(['--count', '2'], runtime, (messages, signal) => {
      const publication = paced.publish(messages, signal);
      if (publication instanceof Promise) {
        void publication.then(() => { publicationSettled = true; });
      }
      return publication;
    });
    let publicationSettled = false;

    await vi.waitFor(() => expect(publisher.snapshot().messages).toHaveLength(1));
    expect(pacing.size()).toBe(1);

    signals.forEach((signal) => signal());
    expect(pacing.size()).toBe(0);
    await closeStarted;
    await vi.waitFor(() => expect(publicationSettled).toBe(true));
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);

    pacing.fireNext();
    expect(publisher.snapshot().messages).toHaveLength(1);

    resolveClose?.();
    expect(await running).toBe(1);
    expect(stderr.at(-1)).toBe('{"error":"interrupted"}\n');
  });
});

describe('paced publication controller', () => {
  it('reveals the first message synchronously and the rest FIFO at scheduled delays', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const delays = [0, 0.9999];
    let delayIndex = 0;
    const paced = createPacedPublication(publisher, {
      schedule: pacing.schedule,
      random: () => delays[delayIndex++] ?? 0,
    });

    const publication = paced.publish(batch);
    expect(publication).toBeInstanceOf(Promise);
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);
    expect(pacing.delays()).toStrictEqual([1000]);

    pacing.fireNext();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos']);
    expect(pacing.delays()).toStrictEqual([3000]);

    pacing.fireNext();
    await publication;
    expect(pacing.size()).toBe(0);
    expect(publisher.snapshot().messages).toHaveLength(3);
  });

  it('asserts recorded delays against exact inclusive boundary values before draining', async () => {
    const cases: ReadonlyArray<{ random: () => number; expected: number[] }> = [
      { random: () => 0, expected: [1000, 1000] },
      { random: () => 0.999999, expected: [3000, 3000] },
      { random: () => 0.5, expected: [2000, 2000] },
    ];
    for (const { random, expected } of cases) {
      const publisher = new PresentationPublisher();
      const pacing = manualScheduler();
      const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random });
      const publication = paced.publish(batch);
      expect(pacing.recorded()).toStrictEqual([expected[0]]);
      pacing.fireNext();
      expect(pacing.recorded()).toStrictEqual(expected);
      while (pacing.size() > 0) pacing.fireNext();
      await publication;
      expect(pacing.recorded()).toStrictEqual(expected);
    }
  });

  it('keeps pending messages out of snapshots while every subscriber observes each reveal', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const first: number[] = [];
    const second: number[] = [];
    publisher.subscribe((snapshot) => first.push(snapshot.messages.length));
    publisher.subscribe((snapshot) => second.push(snapshot.messages.length));

    const publication = paced.publish(batch);
    expect(first).toStrictEqual([0, 1]);
    expect(second).toStrictEqual([0, 1]);
    expect(publisher.snapshot().messages.map((message) => message.message)).not.toContain('Vamos');

    pacing.fireNext();
    pacing.fireNext();
    await publication;
    expect(first).toStrictEqual([0, 1, 2, 3]);
    expect(second).toStrictEqual([0, 1, 2, 3]);
  });

  it('rejects reentrant publication before mutating state', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });

    const publication = paced.publish(batch);
    expect(() => paced.publish([{ username: 'Dana', message: 'Cuatro' }]))
      .toThrowError(ManualChatError);
    expect(publisher.snapshot().messages).toHaveLength(1);
    expect(pacing.size()).toBe(1);

    pacing.fireNext();
    pacing.fireNext();
    await publication;
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos', 'Tres']);
    expect(publisher.snapshot().messages.every((message) => message.message !== 'Cuatro')).toBe(true);
  });

  it('rejects a batch above ten messages without revealing anything', () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const oversized = Array.from({ length: 11 }, (_, index) => ({
      username: `User ${index}`,
      message: `Message ${index}`,
    }));

    expect(() => paced.publish(oversized)).toThrowError(ManualChatError);
    expect(publisher.snapshot().messages).toHaveLength(0);
    expect(pacing.size()).toBe(0);
  });

  it('rejects a nested publish from a synchronous subscriber while the first batch owns the schedule', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    let insideFirstReveal = false;
    let nestedError: unknown;
    publisher.subscribe(() => {
      if (!insideFirstReveal) return;
      try {
        paced.publish([{ username: 'Dana', message: 'Cuatro' }]);
        nestedError = new Error('nested_publish_accepted');
      } catch (error) {
        nestedError = error;
      }
    });

    insideFirstReveal = true;
    const publication = paced.publish(batch);
    insideFirstReveal = false;
    expect(nestedError).toBeInstanceOf(ManualChatError);
    expect(pacing.size()).toBe(1);
    pacing.fireNext();
    pacing.fireNext();
    await publication;
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos', 'Tres']);
    expect(publisher.snapshot().messages.every((message) => message.message !== 'Cuatro')).toBe(true);
  });

  it('settles immediately when a synchronous subscriber stops during the first reveal', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    let insideFirstReveal = false;
    publisher.subscribe(() => { if (insideFirstReveal) paced.stop(); });

    insideFirstReveal = true;
    const publication = paced.publish(batch);
    insideFirstReveal = false;
    expect(await settleState(publication)).toBe('settled');
    expect(pacing.size()).toBe(0);
    pacing.fireNext();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);
  });

  it('settles and leaves no abort listener when a synchronous subscriber aborts during the first reveal', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const abort = fakeSignal();
    let insideFirstReveal = false;
    publisher.subscribe(() => { if (insideFirstReveal) abort.abort(); });

    insideFirstReveal = true;
    const publication = paced.publish(batch, abort.signal);
    insideFirstReveal = false;
    expect(await settleState(publication)).toBe('settled');
    expect(pacing.size()).toBe(0);
    expect(abort.listeners).toHaveLength(0);
    pacing.fireNext();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);
  });

  it('does not schedule a replacement timer when a synchronous subscriber stops during a later reveal', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    let reveals = 0;
    publisher.subscribe(() => {
      reveals += 1;
      if (reveals === 3) paced.stop();
    });

    const publication = paced.publish(batch);
    expect(pacing.size()).toBe(1);
    pacing.fireNext();
    expect(await settleState(publication)).toBe('settled');
    expect(pacing.size()).toBe(0);
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos']);
    pacing.fireNext();
    expect(publisher.snapshot().messages).toHaveLength(2);
  });

  it('rejects the publication and releases ownership when the injected scheduler fails mid-batch', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    let scheduleCalls = 0;
    const paced = createPacedPublication(publisher, {
      schedule: (callback, delayMs) => {
        scheduleCalls += 1;
        if (scheduleCalls === 2) throw new Error('scheduler_failed');
        return pacing.schedule(callback, delayMs);
      },
      random: () => 0,
    });

    const publication = paced.publish(batch);
    pacing.fireNext();
    await expect(publication).rejects.toThrow('scheduler_failed');
    expect(pacing.size()).toBe(0);
    expect(() => paced.publish([{ username: 'Dana', message: 'Cuatro' }])).not.toThrow();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos', 'Cuatro']);
  });

  it('rejects the publication and releases ownership when the injected random fails mid-batch', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    let randomCalls = 0;
    const paced = createPacedPublication(publisher, {
      schedule: pacing.schedule,
      random: () => {
        randomCalls += 1;
        if (randomCalls === 2) throw new Error('random_failed');
        return 0;
      },
    });

    const publication = paced.publish(batch);
    pacing.fireNext();
    await expect(publication).rejects.toThrow('random_failed');
    expect(pacing.size()).toBe(0);
    expect(() => paced.publish([{ username: 'Dana', message: 'Cuatro' }])).not.toThrow();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos', 'Cuatro']);
  });

  it('releases ownership when a synchronous subscriber throws during the first reveal', () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    let calls = 0;
    const unsubscribe = publisher.subscribe(() => {
      calls += 1;
      if (calls >= 2) throw new Error('subscriber_failed');
    });

    expect(() => paced.publish(batch)).toThrowError('subscriber_failed');
    expect(pacing.size()).toBe(0);
    unsubscribe();
    expect(() => paced.publish([{ username: 'Dana', message: 'Cuatro' }])).not.toThrow();
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Cuatro']);
  });

  it('rejects an oversized batch before reading or copying its messages', () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const backing = Array.from({ length: 11 }, (_, index) => ({
      username: `User ${index}`,
      message: `Message ${index}`,
    }));
    const reads: string[] = [];
    const oversized = new Proxy(backing, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => paced.publish(oversized)).toThrowError(ManualChatError);
    expect(reads).toHaveLength(0);
    expect(publisher.snapshot().messages).toHaveLength(0);
    expect(pacing.size()).toBe(0);
  });

  it('resolves an empty batch without scheduling a timer', () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });

    expect(paced.publish([])).toBeUndefined();
    expect(pacing.size()).toBe(0);
    expect(publisher.snapshot().messages).toHaveLength(0);
  });

  it('stops an active batch immediately on abort without a later reveal', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const controller = new AbortController();

    const publication = paced.publish(batch, controller.signal);
    pacing.fireNext();
    expect(publisher.snapshot().messages).toHaveLength(2);

    controller.abort();
    await publication;
    expect(pacing.size()).toBe(0);

    pacing.fireNext();
    expect(publisher.snapshot().messages).toHaveLength(2);
    expect(publisher.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos']);

    controller.abort();
    expect(publisher.snapshot().messages).toHaveLength(2);

    const next = paced.publish([{ username: 'Dana', message: 'Cuatro' }]);
    expect(next).toBeUndefined();
    expect(publisher.snapshot().messages).toHaveLength(3);
  });

  it('ignores an already-aborted signal without revealing anything', () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const controller = new AbortController();
    controller.abort();

    expect(paced.publish(batch, controller.signal)).toBeUndefined();
    expect(publisher.snapshot().messages).toHaveLength(0);
    expect(pacing.size()).toBe(0);
  });

  it('stops idempotently, settles the active batch, and rejects later publication', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });

    const publication = paced.publish(batch);
    paced.stop();
    paced.stop();
    await publication;
    expect(pacing.size()).toBe(0);
    expect(publisher.snapshot().messages).toHaveLength(1);

    pacing.fireNext();
    expect(publisher.snapshot().messages).toHaveLength(1);
    expect(() => paced.publish(batch)).toThrowError(ManualChatError);
  });
});

type SseStream = { response: import('node:http').IncomingMessage; chunks: string[] };

function openSse(port: number): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/events' });
    request.once('response', (response) => {
      const chunks: string[] = [];
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => chunks.push(chunk));
      resolve({ response, chunks });
    });
    request.once('error', reject);
    request.end();
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition_not_observed');
}

describe('paced publication over real loopback SSE', () => {
  it('delivers paced reveals gradually and never exposes pending messages', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    const stream = await openSse(port);
    try {
      const publication = paced.publish(batch);
      await waitFor(() => stream.chunks.join('').includes('Hola'));
      expect(stream.chunks.join('')).not.toContain('Vamos');
      expect(stream.chunks.join('')).toContain('event: snapshot');

      pacing.fireNext();
      await waitFor(() => stream.chunks.join('').includes('Vamos'));
      expect(stream.chunks.join('')).not.toContain('Tres');

      pacing.fireNext();
      await publication;
      await waitFor(() => stream.chunks.join('').includes('Tres'));
      const payload = stream.chunks.join('');
      expect(payload).toContain('"stream":"');
      expect(payload).toContain('"id":"1"');
      expect(payload).not.toContain('model');
    } finally {
      stream.response.destroy();
      await server.close();
    }
  });

  it('serves a silent reconnect snapshot of currently revealed messages mid-batch', async () => {
    const publisher = new PresentationPublisher();
    const pacing = manualScheduler();
    const paced = createPacedPublication(publisher, { schedule: pacing.schedule, random: () => 0 });
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    const first = await openSse(port);
    try {
      const publication = paced.publish(batch);
      await waitFor(() => first.chunks.join('').includes('Hola'));

      const reconnected = await openSse(port);
      try {
        await waitFor(() => reconnected.chunks.join('').includes('Hola'));
        const reconnectSnapshot = JSON.parse(
          reconnected.chunks.join('').split('\n\n')
            .filter((frame) => frame.startsWith('event: snapshot'))
            .at(-1)!
            .slice('event: snapshot\ndata: '.length),
        );
        expect(reconnectSnapshot.messages.map((message: { message: string }) => message.message))
          .toStrictEqual(['Hola']);

        pacing.fireNext();
        await waitFor(() => reconnected.chunks.join('').includes('Vamos'));
        expect(first.chunks.join('')).toContain('Vamos');
        pacing.fireNext();
        await publication;
      } finally {
        reconnected.response.destroy();
      }
    } finally {
      first.response.destroy();
      await server.close();
    }
  });
});

describe('paced serve composition', () => {
  it('paces batch publication through an injected pacing composition', async () => {
    const lines: SessionInputResult[] = [
      { kind: 'line', value: 'accepted event' },
      { kind: 'line', value: '/exit' },
    ];
    const bridge: SessionCliBridge = {
      login: vi.fn(async () => ({})),
      text: vi.fn(async () => result),
      close: vi.fn(async () => {}),
    };
    const server = {
      start: vi.fn(async () => 4321),
      close: vi.fn(async () => {}),
    };
    const stop = vi.fn(() => {});
    let publisher: PresentationPublisher | undefined;
    const pendingReveals: Array<() => void> = [];
    const createPresentationServer = vi.fn((createdPublisher: PresentationPublisher) => {
      publisher = createdPublisher;
      return server;
    });
    const runtime: ServeCliRuntime = {
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
      createPresentationServer,
    };
    runtime.createPacedPublication = (createdPublisher: PresentationPublisher) => ({
      publish: (messages, signal) => {
        createdPublisher.publish([messages[0]!]);
        void signal;
        return new Promise<void>((resolve) => {
          pendingReveals.push(() => {
            for (const message of messages.slice(1)) createdPublisher.publish([message]);
            resolve();
          });
        });
      },
      stop,
    });

    const running = runServeCli(['--count', '2'], runtime);
    await vi.waitFor(() => {
      expect(publisher?.snapshot().messages).toHaveLength(1);
    });
    expect(publisher?.snapshot().messages.map((message) => message.username)).toStrictEqual(['Ana']);

    for (const flush of [...pendingReveals]) flush();
    expect(await running).toBe(0);

    expect(publisher?.snapshot().messages.map((message) => message.username)).toStrictEqual(['Ana', 'Beto']);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(server.close.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
  });

  it('paces the real default controller on the default serve path with deterministic fake timers', async () => {
    vi.useFakeTimers();
    try {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const lines: SessionInputResult[] = [
        { kind: 'line', value: 'accepted event' },
        { kind: 'line', value: '/exit' },
      ];
      const bridge: SessionCliBridge = {
        login: vi.fn(async () => ({})),
        text: vi.fn(async () => result),
        close: vi.fn(async () => {}),
      };
      const server = { start: vi.fn(async () => 4321), close: vi.fn(async () => {}) };
      let publisher: PresentationPublisher | undefined;
      const runtime: ServeCliRuntime = {
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
        createPresentationServer: vi.fn((createdPublisher: PresentationPublisher) => {
          publisher = createdPublisher;
          return server;
        }),
      };

      const running = runServeCli(['--count', '2'], runtime);
      await vi.advanceTimersByTimeAsync(0);
      expect(publisher?.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(publisher?.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola']);

      await vi.advanceTimersByTimeAsync(1);
      expect(publisher?.snapshot().messages.map((message) => message.message)).toStrictEqual(['Hola', 'Vamos']);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(await running).toBe(0);
      expect(bridge.text).toHaveBeenCalledTimes(1);
      expect(randomSpy).toHaveBeenCalled();
      expect(server.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
