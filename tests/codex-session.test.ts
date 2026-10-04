import { describe, expect, it, vi } from 'vitest';
import { CodexBridge, type TextResult } from '../src/codex/bridge.js';
import { BridgeError, type Notice } from '../src/codex/rpc.js';
import {
  generateManualChatBatch,
  ManualChatError,
  prepareManualChatRequest,
  type ManualChatMessage,
  type ManualChatTurn,
} from '../src/npc/chat.js';
import { ManualChatSession } from '../src/npc/session.js';

const provenance: Omit<TextResult, 'response'> = {
  status: 'completed', model: 'gpt-test', requestedModel: 'gpt-test', resolvedModel: 'gpt-test',
  codexVersion: '0.154.0', serviceTier: 'default', effort: 'low', firstDeltaMs: 1, totalMs: 2,
};

function response(messages: ManualChatMessage[]): TextResult {
  return { response: JSON.stringify(messages), ...provenance };
}

function pair(returning = 'Ana'): ManualChatMessage[] {
  return [{ username: returning, message: 'Volví' }, { username: 'NewUser', message: 'Hola' }];
}

function cancellationRaceBridge(controller: AbortController, abortOnCall: number) {
  const listeners = new Set<(notice: Notice) => void>();
  let calls = 0;
  const rpc = {
    request: async (method: string) => {
      if (method !== 'turn/start') throw new Error(method);
      calls += 1;
      for (const listener of [...listeners]) {
        listener({ method: 'item/agentMessage/delta', params: {
          threadId: 'thread', turnId: `turn-${calls}`, delta: JSON.stringify(pair('Ana')),
        } });
      }
      for (const listener of [...listeners]) {
        listener({ method: 'turn/completed', params: {
          threadId: 'thread', turn: { id: `turn-${calls}`, status: 'completed' },
        } });
      }
      if (calls === abortOnCall) controller.abort();
      return { turn: { id: `turn-${calls}` } };
    },
    subscribe: (notice: (value: Notice) => void) => {
      listeners.add(notice);
      return () => { listeners.delete(notice); };
    },
    close: async () => {},
  };
  const bridge = new CodexBridge(rpc);
  bridge.prepareThread = async () => ({ threadId: 'thread', model: 'fake' });
  bridge.checkUsage = async () => {};
  return { bridge, calls: () => calls, listeners };
}

function turn(index: number, size = 10): ManualChatTurn {
  return {
    event: `event-${index}-${'e'.repeat(size)}`,
    messages: [
      { username: `User${index}`, message: `message-${index}-${'m'.repeat(size)}` },
      { username: `Other${index}`, message: 'ok' },
    ],
  };
}

describe('contextual manual chat requests', () => {
  it('applies the same shared-only style to one-shot and new session preparation', () => {
    const oneShot = prepareManualChatRequest('Goal').prompt;
    const session = new ManualChatSession({ text: vi.fn(async () => response(pair())) });

    expect(session.prepare('Goal').prompt).toBe(oneShot);
    expect(oneShot).toContain('casual Spanish from Spain');
    expect(oneShot).toContain('colleagues sharing a live chat');
    expect(oneShot).toContain('Event data: "Goal"');
    expect(oneShot).not.toContain('Prior validated turns');
    expect(oneShot).not.toContain('Stable persona roster');
  });

  it('escapes included history and requires a returning included participant', async () => {
    const history = [{ event: 'He said "go"\\now', messages: pair(' Ana ') }];
    const text = vi.fn<(prompt: string) => Promise<TextResult>>(async () => response(pair('aNa')));

    const result = await generateManualChatBatch({ text }, 'Next', { count: 2, history });

    expect(result.messages[0]?.username).toBe('aNa');
    const prompt = text.mock.calls[0]?.[0] ?? '';
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain(JSON.stringify(history));
    expect(prompt).toContain('at least one participant from the included prior turns');
  });

  it('rejects a missing returner once without retry or repair', async () => {
    const messages = pair('SomeoneElse');
    expect(messages).toHaveLength(2);
    expect(messages.map(({ username }) => username)).not.toContain('User1');
    const text = vi.fn(async () => response(messages));

    await expect(generateManualChatBatch({ text }, 'Next', { count: 2, history: [turn(1)] }))
      .rejects.toEqual(expect.objectContaining({ code: 'invalid_response' }));
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('evicts whole oldest turns and derives the roster only from included history', async () => {
    const history = [turn(1, 900), turn(2, 900), turn(3, 900)];
    const prepared = prepareManualChatRequest('Current', 2, history);
    expect(prepared.prompt.length).toBeLessThanOrEqual(4000);
    expect(prepared.includedHistory.length).toBeGreaterThan(0);
    expect(prepared.includedHistory.length).toBeLessThan(3);
    expect(prepared.prompt).not.toContain('event-1-');
    expect(prepared.prompt).toContain('event-3-');

    const evictedOnly = pair('User1');
    const text = vi.fn(async () => response(evictedOnly));
    await expect(generateManualChatBatch({ text }, 'Current', { count: 2, history }))
      .rejects.toEqual(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('falls back to the original prompt and skips returner validation when all history is evicted', async () => {
    const huge = [turn(1, 3000)];
    const prepared = prepareManualChatRequest('Goal', 5, huge);
    expect(prepared.prompt).toBe(prepareManualChatRequest('Goal').prompt);
    expect(prepared.includedHistory).toStrictEqual([]);
    const contextFreeMessages = [
      { username: 'NobodyPrior', message: 'one' },
      { username: 'AnotherNew', message: 'two' },
      { username: 'NobodyPrior', message: 'three' },
      { username: 'AnotherNew', message: 'four' },
      { username: 'NobodyPrior', message: 'five' },
    ];
    const text = vi.fn(async () => response(contextFreeMessages));

    await expect(generateManualChatBatch({ text }, 'Goal', { history: huge })).resolves.toMatchObject({
      messages: contextFreeMessages,
    });
  });
});

describe('bounded manual chat session state', () => {
  it('generates three related events serially through one bridge and caps history at three', async () => {
    const prompts: string[] = [];
    const outputs = [pair('Ana'), pair('ana'), pair('ANA'), pair('Ana')];
    const text = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return response(outputs[prompts.length - 1] ?? pair());
    });
    const session = new ManualChatSession({ text }, 2);

    for (const event of ['one', 'two', 'three', 'four']) await session.generate(event);

    expect(text).toHaveBeenCalledTimes(4);
    expect(prompts[0]).not.toContain('Prior validated turns');
    expect(prompts[1]).toContain('one');
    expect(prompts[2]).toContain('two');
    expect(session.getHistory().map(({ event }) => event)).toStrictEqual(['two', 'three', 'four']);
  });

  it('does not append invalid input, failures, partial responses, or missing returners', async () => {
    const text = vi.fn<() => Promise<TextResult>>()
      .mockResolvedValueOnce(response(pair('Ana')))
      .mockRejectedValueOnce(new Error('transport'))
      .mockResolvedValueOnce({ ...response(pair('Ana')), status: 'interrupted' })
      .mockResolvedValueOnce(response([
        { username: 'NoReturner', message: 'x' },
        { username: 'OtherNew', message: 'y' },
      ]));
    const session = new ManualChatSession({ text }, 2);
    await session.generate('accepted');

    await expect(session.generate('   ')).rejects.toBeInstanceOf(ManualChatError);
    await expect(session.generate('failed')).rejects.toThrow('transport');
    await expect(session.generate('partial')).rejects.toEqual(expect.objectContaining({ code: 'interrupted_result' }));
    await expect(session.generate('missing')).rejects.toEqual(expect.objectContaining({ code: 'invalid_response' }));
    expect(session.getHistory().map(({ event }) => event)).toStrictEqual(['accepted']);
  });

  it.each([false, true])(
    'rejects a bridge completion canceled before return without corrupting history (prior=%s)',
    async (hasPrior) => {
      const controller = new AbortController();
      const fixture = cancellationRaceBridge(controller, hasPrior ? 2 : 1);
      const session = new ManualChatSession(fixture.bridge, 2);
      if (hasPrior) await session.generate('prior');
      const historyBefore = session.getHistory();

      await expect(session.generate('cancelled', controller.signal))
        .rejects.toEqual(expect.objectContaining({ code: 'aborted' }));

      expect(session.getHistory()).toStrictEqual(historyBefore);
      expect(fixture.calls()).toBe(hasPrior ? 2 : 1);
      expect(fixture.listeners.size).toBe(0);
    },
  );

  it('releases the reentrancy guard after the cancellation race without automatic retry', async () => {
    const controller = new AbortController();
    const fixture = cancellationRaceBridge(controller, 1);
    const session = new ManualChatSession(fixture.bridge, 2);
    const cancelled = session.generate('cancelled', controller.signal);

    await expect(session.generate('overlap')).rejects.toEqual(
      expect.objectContaining({ code: 'session_busy' }),
    );
    await expect(cancelled).rejects.toEqual(expect.objectContaining({ code: 'aborted' }));
    expect(fixture.calls()).toBe(1);
    expect(session.getHistory()).toStrictEqual([]);

    await expect(session.generate('after')).resolves.toMatchObject({ messages: pair('Ana') });
    expect(fixture.calls()).toBe(2);
    expect(session.getHistory().map(({ event }) => event)).toStrictEqual(['after']);
  });

  it('defensively copies history against caller and result mutation', async () => {
    const text = vi.fn(async () => response(pair('Ana')));
    const session = new ManualChatSession({ text }, 2);
    const result = await session.generate('first');
    result.messages[0]!.username = 'Mutated';
    const exposed = session.getHistory();
    exposed[0]!.event = 'changed';
    exposed[0]!.messages[0]!.username = 'Changed';

    expect(session.getHistory()).toStrictEqual([{ event: 'first', messages: pair('Ana') }]);
  });

  it('rejects public API reentrancy without starting a second text call', async () => {
    let finish!: (value: TextResult) => void;
    const text = vi.fn(() => new Promise<TextResult>((resolve) => { finish = resolve; }));
    const session = new ManualChatSession({ text }, 2);
    const first = session.generate('first');

    await expect(session.generate('second')).rejects.toEqual(expect.objectContaining({ code: 'session_busy' }));
    finish(response(pair('Ana')));
    await first;
    expect(text).toHaveBeenCalledTimes(1);
  });
});
