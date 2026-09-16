import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexBridge, type Transport } from '../src/codex/bridge.js';
import { Rpc } from '../src/codex/rpc.js';

const owned: { rpc: Rpc; subscribers: Set<object> }[] = [];
const account = { account: { type: 'chatgpt', planType: 'plus' } };
const quota = { ordinaryUsageAllowed: true, rateLimits: { normalModelSlug: null, primary: { usedPercent: 1 }, secondary: { usedPercent: 2 }, rateLimitReachedType: null, spendControlReached: false }, rateLimitsByLimitId: null };
export const model = { model: 'gpt-5.6-luna', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] };
async function setup(mode = '', turnTimeoutMs = 1000) {
  const rpc = new Rpc(spawn(process.execPath, ['tests/fixtures/codex-server.mjs', mode], { env: {}, stdio: 'pipe' }), 500);
  const subscribers = new Set<object>();
  owned.push({ rpc, subscribers });
  await rpc.start();
  const calls: string[] = [];
  const transport: Transport = {
    request: async (method: string, params: any) => {
      calls.push(method);
      if (method === 'account/read') return account;
      if (method === 'account/rateLimits/read') {
        expect(params).toEqual({ supportsLunaReserve: false, excludeResetCreditDetails: true });
        return quota;
      }
      if (method === 'model/list') return { data: [model], nextCursor: null };
      if (method === 'thread/start') {
        expect(params.environments).toEqual([]);
        return { model: model.model, modelProvider: 'openai', serviceTier: 'default', reasoningEffort: 'low',
          instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false },
          approvalPolicy: 'on-request', approvalsReviewer: 'user', thread: { id: 'thread', ephemeral: true, path: null, environments: [] } };
      }
      if (method === 'turn/start') expect(params).not.toHaveProperty('environments');
      return rpc.request(method, params);
    },
    subscribe: (notice, fault) => {
      const subscription = {};
      subscribers.add(subscription);
      const dispose = rpc.subscribe(notice, fault);
      return () => { subscribers.delete(subscription); dispose(); };
    }, close: rpc.close.bind(rpc),
  };
  return { bridge: new CodexBridge(transport, turnTimeoutMs), calls, rpc };
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async ({ rpc, subscribers }) => {
    const remaining = subscribers.size;
    await rpc.close();
    expect(remaining).toBe(0);
  }));
});

describe('text adapter with owned child and mocked account/catalog', () => {
  it('collects pre-response deltas and completion while awaiting ordered async callbacks', async () => {
    const { bridge, calls } = await setup();
    const deltas: string[] = [];
    const result = await bridge.text('fixture', { onDelta: async (delta) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      deltas.push(delta);
    } });
    expect(result.response).toBe('Qué caída.');
    expect(deltas).toEqual(['Qué ', 'caída.']);
    expect(result.status).toBe('completed');
    expect(result.firstDeltaMs).toBeGreaterThanOrEqual(0);
    expect(result.firstDeltaMs).not.toBeNull();
    expect(result.totalMs).toBeGreaterThanOrEqual(result.firstDeltaMs!);
    expect(calls.indexOf('account/rateLimits/read')).toBeLessThan(calls.indexOf('turn/start'));
  });
  it('rejects forbidden activity after completion in the same stdout burst and closes the child', async () => {
    const { bridge, rpc } = await setup('completion-fault-burst');
    await expect(bridge.text('fixture')).rejects.toMatchObject({ code: 'blocked_activity', category: 'tool' });
    expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
  });
  it('rejects promptly when transport faults while a completed turn is draining a stalled callback', async () => {
    const { bridge, rpc } = await setup('drain-fault', 2000);
    let entered!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { entered = resolve; });
    let completed!: () => void;
    const completion = new Promise<void>((resolve) => { completed = resolve; });
    const dispose = rpc.subscribe(({ method }) => { if (method === 'turn/completed') completed(); }, () => {});
    try {
      const text = bridge.text('fixture', { onDelta: () => { entered(); return new Promise(() => {}); } });
      const rejected = expect(text).rejects.toMatchObject({ code: 'blocked_activity', category: 'tool' });
      await Promise.all([callbackEntered, completion]);
      const start = performance.now();
      await rpc.request('fault-during-drain', {});
      await rejected;
      expect(performance.now() - start).toBeLessThan(1000);
      expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
    } finally { dispose(); }
  });
  it('does not create a turn for an already-aborted signal', async () => {
    const { bridge, calls, rpc } = await setup();
    await expect(bridge.text('fixture', { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toEqual([]);
    expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
  });
  it('interrupts an active turn, waits for interrupted, and disallows concurrent turns', async () => {
    const { bridge, calls } = await setup('wait');
    const abort = new AbortController();
    const result = expect(bridge.text('fixture', { signal: abort.signal, onDelta: () => { abort.abort(); } }))
      .resolves.toMatchObject({ status: 'interrupted' });
    await expect(bridge.text('other')).rejects.toMatchObject({ code: 'turn_active' });
    await result;
    expect(calls.filter((method) => method === 'turn/interrupt')).toHaveLength(1);
  });
  it('interrupts after the turn ID arrives when aborted during turn/start', async () => {
    const { bridge, calls } = await setup('slow-start');
    const abort = new AbortController();
    await expect(bridge.text('fixture', { signal: abort.signal, onDelta: () => { abort.abort(); } }))
      .resolves.toMatchObject({ status: 'interrupted' });
    expect(calls.filter((method) => method === 'turn/start')).toHaveLength(1);
    expect(calls.filter((method) => method === 'turn/interrupt')).toHaveLength(1);
  });
  it('does not claim interruption from an empty interrupt acknowledgement', async () => {
    const { bridge } = await setup('no-interrupt-completion', 40);
    const abort = new AbortController();
    await expect(bridge.text('fixture', { signal: abort.signal, onDelta: () => { abort.abort(); } }))
      .rejects.toMatchObject({ code: 'turn_timeout' });
  });
  it('bounds a stalled asynchronous delta consumer', async () => {
    const { bridge } = await setup('', 40);
    await expect(bridge.text('fixture', { onDelta: () => new Promise(() => {}) }))
      .rejects.toMatchObject({ code: 'turn_timeout' });
  });
  it('sanitizes failed turn and callback errors', async () => {
    const failed = await setup('failed');
    await expect(failed.bridge.text('fixture')).rejects.toMatchObject({ code: 'turn_failed' });
    const callback = await setup();
    await expect(callback.bridge.text('fixture', { onDelta: () => { throw new Error('untrusted detail'); } }))
      .rejects.toMatchObject({ code: 'delta_callback_failed' });
  });
  it('bounds a turn without completion and tears down the process', async () => {
    const { bridge, rpc } = await setup('wait', 40);
    await expect(bridge.text('fixture')).rejects.toMatchObject({ code: 'turn_timeout' });
    expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
  });
});
