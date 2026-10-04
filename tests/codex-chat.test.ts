import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexBridge, type TextResult, type Transport } from '../src/codex/bridge.js';
import { generateManualChatBatch, ManualChatError } from '../src/npc/chat.js';
import { BridgeError, Rpc } from '../src/codex/rpc.js';

const provenance: Omit<TextResult, 'response' | 'status'> = {
  model: 'gpt-5.6-luna',
  requestedModel: 'gpt-5.6-luna',
  resolvedModel: 'gpt-5.6-luna',
  codexVersion: '0.154.0',
  serviceTier: 'default',
  effort: 'low',
  firstDeltaMs: 4,
  totalMs: 9,
};

function completed(response: string): TextResult {
  return { response, status: 'completed', ...provenance };
}

function fakeBridge(result: TextResult | Error) {
  const text = vi.fn<(prompt: string, options?: { signal?: AbortSignal }) => Promise<TextResult>>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { bridge: { text }, text };
}

function validMessages(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    username: index % 2 === 0 ? 'Ána' : 'Beto',
    message: index === 0 ? '¡Qué caída! 🙃' : `Mensaje ${index + 1}`,
  }));
}

function expectCode(code: string) {
  return expect.objectContaining({ code });
}

describe('manual chat batch validation', () => {
  it('returns the exact emoji batch and provenance after one text call', async () => {
    const messages = validMessages();
    messages[2] = { username: 'Ána', message: 'Otra vez 😅' };
    const { bridge, text } = fakeBridge(completed(JSON.stringify(messages)));
    const abort = new AbortController();

    const result = await generateManualChatBatch(bridge, 'El streamer dijo: "saltá"', { signal: abort.signal });

    expect(result).toStrictEqual({ messages, status: 'completed', ...provenance });
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[1]).toStrictEqual({ signal: abort.signal });
    const prompt = text.mock.calls[0]?.[0] ?? '';
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain(JSON.stringify('El streamer dijo: "saltá"'));
    expect(prompt).toContain('Spanish');
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('untrusted data');
  });

  it.each([2, 10])('accepts the exact requested boundary count %s', async (count) => {
    const messages = validMessages(count);
    const { bridge } = fakeBridge(completed(JSON.stringify(messages)));

    await expect(generateManualChatBatch(bridge, 'Gol inesperado', { count }))
      .resolves.toMatchObject({ messages });
  });

  it('counts username and message limits by Unicode code point', async () => {
    const messages = [
      { username: '😀'.repeat(32), message: '🎉'.repeat(200) },
      { username: 'B', message: 'ok' },
    ];
    const { bridge } = fakeBridge(completed(JSON.stringify(messages)));

    await expect(generateManualChatBatch(bridge, 'Evento', { count: 2 }))
      .resolves.toMatchObject({ messages });
  });

  it.each([
    ['username over limit', [{ username: '😀'.repeat(33), message: 'ok' }, { username: 'B', message: 'ok' }]],
    ['message over limit', [{ username: 'A', message: '🎉'.repeat(201) }, { username: 'B', message: 'ok' }]],
    ['blank username', [{ username: '  ', message: 'ok' }, { username: 'B', message: 'ok' }]],
    ['blank message', [{ username: 'A', message: '\n' }, { username: 'B', message: 'ok' }]],
  ])('rejects %s', async (_name, messages) => {
    const { bridge } = fakeBridge(completed(JSON.stringify(messages)));

    await expect(generateManualChatBatch(bridge, 'Evento', { count: 2 }))
      .rejects.toEqual(expectCode('invalid_response'));
  });

  it.each([
    ['malformed JSON', '[{"username":'],
    ['object root', '{"username":"A","message":"x"}'],
    ['wrong count', JSON.stringify(validMessages(4))],
  ])('rejects %s without repair or retry', async (_name, response) => {
    const { bridge, text } = fakeBridge(completed(response));

    await expect(generateManualChatBatch(bridge, 'Evento'))
      .rejects.toEqual(expectCode('invalid_response'));
    expect(text).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['extra key', [{ username: 'A', message: 'x', emoji: '🙃' }, { username: 'B', message: 'y' }], 2],
    ['missing key', [{ username: 'A' }, { username: 'B', message: 'y' }], 2],
    ['wrong field type', [{ username: 1, message: 'x' }, { username: 'B', message: 'y' }], 2],
    ['null item', [null, { username: 'B', message: 'y' }], 2],
  ])('rejects %s at item validation without repair or retry', async (_name, items, count) => {
    expect(items).toHaveLength(count);
    const { bridge, text } = fakeBridge(completed(JSON.stringify(items)));

    await expect(generateManualChatBatch(bridge, 'Evento', { count }))
      .rejects.toEqual(expectCode('invalid_response'));
    expect(text).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['trim-equivalent', [{ username: ' Ana ', message: 'x' }, { username: 'Ana', message: 'y' }]],
    ['case-equivalent', [{ username: 'Beto', message: 'x' }, { username: 'bEtO', message: 'y' }]],
  ])('requires two identities after %s normalization', async (_name, pair) => {
    const { bridge } = fakeBridge(completed(JSON.stringify(pair)));

    await expect(generateManualChatBatch(bridge, 'Evento', { count: 2 }))
      .rejects.toEqual(expectCode('invalid_response'));
  });

  it.each([
    ['empty', ''],
    ['blank', '  \n'],
    ['wrong type', 42],
  ])('rejects an %s event before calling text', async (_name, event) => {
    const { bridge, text } = fakeBridge(completed(JSON.stringify(validMessages())));

    await expect(generateManualChatBatch(bridge, event as string))
      .rejects.toEqual(expectCode('invalid_event'));
    expect(text).not.toHaveBeenCalled();
  });

  it.each([1, 11, 2.5, Number.NaN, '5'])('rejects invalid count %s before calling text', async (count) => {
    const { bridge, text } = fakeBridge(completed(JSON.stringify(validMessages())));

    await expect(generateManualChatBatch(bridge, 'Evento', { count: count as number }))
      .rejects.toEqual(expectCode('invalid_count'));
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects escaped prompt overflow before calling text', async () => {
    const { bridge, text } = fakeBridge(completed(JSON.stringify(validMessages())));

    await expect(generateManualChatBatch(bridge, '"\\'.repeat(4000)))
      .rejects.toEqual(expectCode('prompt_limit'));
    expect(text).not.toHaveBeenCalled();
  });

  it('bounds raw response parsing consistently with the bridge response limit', async () => {
    const { bridge } = fakeBridge(completed(' '.repeat(64_001)));

    await expect(generateManualChatBatch(bridge, 'Evento'))
      .rejects.toEqual(expectCode('response_limit'));
  });

  it('rejects interrupted valid-looking output and keeps partial deltas internal', async () => {
    const interrupted = { ...completed(JSON.stringify(validMessages())), status: 'interrupted' as const };
    const { bridge } = fakeBridge(interrupted);

    await expect(generateManualChatBatch(bridge, 'Evento'))
      .rejects.toEqual(expectCode('interrupted_result'));
  });

  it('forwards bridge errors unchanged and never retries', async () => {
    const failure = new BridgeError('included_usage_unavailable', 'windows_exhausted');
    const { bridge, text } = fakeBridge(failure);

    await expect(generateManualChatBatch(bridge, 'Evento')).rejects.toBe(failure);
    expect(text).toHaveBeenCalledTimes(1);
  });
});

const owned: { rpc: Rpc; subscribers: Set<object> }[] = [];
const account = { account: { type: 'chatgpt', planType: 'plus' } };
const quota = { ordinaryUsageAllowed: true, rateLimits: { normalModelSlug: null,
  primary: { usedPercent: 1 }, secondary: { usedPercent: 2 }, rateLimitReachedType: null,
  spendControlReached: false }, rateLimitsByLimitId: null };
const model = { model: 'gpt-5.6-luna', hidden: false, inputModalities: ['text'],
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }] };

async function setupFixture(mode: 'chat-success' | 'chat-malformed') {
  const rpc = new Rpc(spawn(process.execPath, ['tests/fixtures/codex-server.mjs', mode], {
    env: {}, stdio: 'pipe',
  }), 500);
  const subscribers = new Set<object>();
  owned.push({ rpc, subscribers });
  await rpc.start();
  const calls: string[] = [];
  const transport: Transport = {
    request: async (method: string, params: unknown) => {
      calls.push(method);
      if (method === 'account/read') return account;
      if (method === 'account/rateLimits/read') return quota;
      if (method === 'model/list') return { data: [model], nextCursor: null };
      if (method === 'thread/start') return { model: model.model, modelProvider: 'openai',
        serviceTier: 'default', reasoningEffort: 'low', instructionSources: [],
        sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'on-request',
        approvalsReviewer: 'user', thread: { id: 'thread', ephemeral: true, path: null, environments: [] } };
      return rpc.request(method, params);
    },
    subscribe: (notice, fault) => {
      const subscription = {};
      subscribers.add(subscription);
      const dispose = rpc.subscribe(notice, fault);
      return () => { subscribers.delete(subscription); dispose(); };
    },
    close: rpc.close.bind(rpc),
  };
  return { bridge: new CodexBridge(transport, 1000), calls, rpc };
}

afterEach(async () => {
  await Promise.all(owned.splice(0).map(async ({ rpc, subscribers }) => {
    const remaining = subscribers.size;
    await rpc.close();
    expect(remaining).toBe(0);
    expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
  }));
});

describe('manual chat batch with owned RPC fixture', () => {
  it('uses one turn after quota and returns validated provenance', async () => {
    const { bridge, calls } = await setupFixture('chat-success');

    const result = await generateManualChatBatch(bridge, 'Caída inesperada', { count: 2 });

    expect(result.messages).toStrictEqual([
      { username: 'Luz', message: 'Eso salió perfecto 😅' },
      { username: 'Mateo', message: 'La gravedad ganó otra vez.' },
    ]);
    expect(result).toMatchObject({ status: 'completed', model: model.model,
      requestedModel: model.model, resolvedModel: model.model, codexVersion: '0.154.0',
      serviceTier: 'default', effort: 'low' });
    expect(calls.filter((method) => method === 'turn/start')).toHaveLength(1);
    expect(calls.indexOf('account/rateLimits/read')).toBeLessThan(calls.indexOf('turn/start'));
  });

  it('rejects malformed fixture output after one turn and still tears down', async () => {
    const { bridge, calls } = await setupFixture('chat-malformed');

    await expect(generateManualChatBatch(bridge, 'Caída inesperada', { count: 2 }))
      .rejects.toBeInstanceOf(ManualChatError);
    expect(calls.filter((method) => method === 'turn/start')).toHaveLength(1);
  });
});
