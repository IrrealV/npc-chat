import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexBridge } from '../src/codex/bridge.js';
import { serverCommand } from '../src/codex/policy.js';
import { BridgeError, type Notice } from '../src/codex/rpc.js';

const managedAccount = { account: { type: 'chatgpt', planType: 'plus', email: 'fixture@example.invalid' } };
const syntheticLogin = { type: 'chatgptDeviceCode', loginId: 'fixture', verificationUrl: 'https://auth.openai.com/fixture', userCode: 'TEST-CODE' };
const fixtures: CodexBridge[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function authFixture(options: { initial?: any; holdStart?: boolean; holdFinalRead?: boolean } = {}) {
  const listeners = new Set<{ notice: (value: Notice) => void; fault: (error: BridgeError) => void }>();
  const calls: { method: string; params: any }[] = [];
  let cached = 'initial' in options ? options.initial : { account: null };
  let closed = false;
  let submitted!: () => void;
  const started = new Promise<void>((resolve) => { submitted = resolve; });
  let releaseStart!: () => void;
  const startResponse = new Promise<typeof syntheticLogin>((resolve) => { releaseStart = () => resolve(syntheticLogin); });
  if (!options.holdStart) releaseStart();
  const rpc = {
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'account/read') {
        if (options.holdFinalRead && calls.filter((call) => call.method === method).length === 2) return new Promise(() => {});
        return cached;
      }
      if (method === 'account/login/start') { submitted(); return startResponse; }
      return {};
    },
    subscribe: (notice: (value: Notice) => void, fault: (error: BridgeError) => void) => {
      const listener = { notice, fault };
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const listener of listeners) listener.fault(new BridgeError('transport_closed'));
    },
  };
  const bridge = new CodexBridge(rpc);
  fixtures.push(bridge);
  return { bridge, calls, started, releaseStart, listeners, isClosed: () => closed,
    setAccount: (response: any) => { cached = response; },
    emit: (method: string, params: Record<string, any>) => {
      for (const listener of listeners) listener.notice({ method, params });
    },
  };
}
function login(fixture: ReturnType<typeof authFixture>, timeoutMs = 100) {
  return fixture.bridge.login(() => {}, timeoutMs).then((value) => ({ value }), (error) => ({ error }));
}
const completion = { loginId: 'fixture', success: true };
const updated = { authMode: null, planType: null }; // A readiness barrier, not an approval payload.
const accountReads = (fixture: ReturnType<typeof authFixture>) => fixture.calls.filter((call) => call.method === 'account/read');
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((bridge) => bridge.close()));
  vi.useRealTimers();
});

describe('managed ephemeral authentication (synthetic fixtures only)', () => {
  it('waits for cache readiness after successful completion before one final account read', async () => {
    const fixture = authFixture();
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', completion);
    await flush();
    expect(accountReads(fixture)).toHaveLength(1);
    fixture.setAccount(managedAccount);
    fixture.emit('account/updated', updated);
    expect(await result).toEqual({ value: { type: 'chatgpt', planType: 'plus' } });
    expect(accountReads(fixture)).toHaveLength(2);
    expect(accountReads(fixture).every((call) => call.params.refreshToken === false)).toBe(true);
    expect(fixture.listeners.size).toBe(0);
  });
  it('retains completion and subsequent update that both precede the start response', async () => {
    const fixture = authFixture({ holdStart: true });
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', completion);
    fixture.setAccount(managedAccount);
    fixture.emit('account/updated', updated);
    expect(accountReads(fixture)).toHaveLength(1);
    fixture.releaseStart();
    expect(await result).toEqual({ value: { type: 'chatgpt', planType: 'plus' } });
    expect(accountReads(fixture)).toHaveLength(2);
    expect(fixture.calls.find((call) => call.method === 'account/login/start')?.params).toEqual({ type: 'chatgptDeviceCode' });
    expect(serverCommand()).toContain('cli_auth_credentials_store="ephemeral"');
    expect(serverCommand()).toContain('forced_login_method="chatgpt"');
    expect(fixture.listeners.size).toBe(0);
  });
  it('ignores account updates preceding completion', async () => {
    const fixture = authFixture();
    const result = login(fixture);
    await fixture.started;
    fixture.setAccount(managedAccount);
    fixture.emit('account/updated', { authMode: 'chatgpt', planType: 'plus' });
    fixture.emit('account/login/completed', completion);
    await flush();
    expect(accountReads(fixture)).toHaveLength(1);
    fixture.emit('account/updated', updated);
    expect(await result).toEqual({ value: { type: 'chatgpt', planType: 'plus' } });
  });
  it('uses one overall deadline through delayed start, completion and readiness', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = authFixture({ holdStart: true });
    let outcome: unknown;
    const result = login(fixture).then((value) => { outcome = value; });
    await fixture.started;
    await vi.advanceTimersByTimeAsync(60);
    fixture.releaseStart();
    await vi.advanceTimersByTimeAsync(20);
    fixture.emit('account/login/completed', completion);
    await vi.advanceTimersByTimeAsync(19);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(outcome).toMatchObject({ error: { code: 'login_timeout' } });
    expect(accountReads(fixture)).toHaveLength(1);
    expect(fixture.calls.map((call) => call.method)).toContain('account/login/cancel');
    expect(fixture.isClosed()).toBe(true);
    expect(fixture.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the same deadline while the final account read is pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = authFixture({ holdFinalRead: true });
    let outcome: unknown;
    const result = login(fixture).then((value) => { outcome = value; });
    await fixture.started;
    await vi.advanceTimersByTimeAsync(80);
    fixture.emit('account/login/completed', completion);
    fixture.setAccount(managedAccount);
    fixture.emit('account/updated', updated);
    await vi.advanceTimersByTimeAsync(19);
    expect(accountReads(fixture)).toHaveLength(2);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ error: { code: 'login_timeout' } });
    await result;
    expect(fixture.isClosed()).toBe(true);
    expect(fixture.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a failed completion immediately even before the start response', async () => {
    const fixture = authFixture({ holdStart: true });
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', { ...completion, success: false });
    expect(await result).toMatchObject({ error: { code: 'login_failed' } });
    expect(fixture.isClosed()).toBe(true);
    expect(fixture.listeners.size).toBe(0);
    fixture.releaseStart();
    await flush();
    expect(accountReads(fixture)).toHaveLength(1);
  });
  it('rejects a retained mismatched completion when the start ID becomes known', async () => {
    const fixture = authFixture({ holdStart: true });
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', { ...completion, loginId: 'different-fixture' });
    fixture.setAccount(managedAccount);
    fixture.emit('account/updated', updated);
    fixture.releaseStart();
    expect(await result).toMatchObject({ error: { code: 'login_failed' } });
    expect(accountReads(fixture)).toHaveLength(1);
    expect(fixture.calls.map((call) => call.method)).toContain('account/login/cancel');
    expect(fixture.listeners.size).toBe(0);
  });
  it.each([{ loginId: 'fixture', success: false }, { loginId: 'different-fixture', success: true }])(
    'immediately rejects failed or mismatched completion without waiting for an update: %j', async (event) => {
      const fixture = authFixture();
      const result = login(fixture);
      await fixture.started;
      await flush(); // Ensure the real start response, including the cancellable ID, was received.
      fixture.emit('account/login/completed', event);
      expect(await result).toMatchObject({ error: { code: 'login_failed' } });
      expect(accountReads(fixture)).toHaveLength(1);
      expect(fixture.calls.map((call) => call.method)).toContain('account/login/cancel');
      expect(fixture.isClosed()).toBe(true);
      expect(fixture.listeners.size).toBe(0);
    });
  it('rejects API-auth accounts and closes without starting login', async () => {
    const fixture = authFixture({ initial: { account: { type: 'apiKey' } } });
    expect(await login(fixture)).toMatchObject({ error: { code: 'subscription_auth_required', category: 'non_chatgpt_account' } });
    expect(fixture.calls.map((call) => call.method)).toEqual(['account/read']);
    expect(fixture.isClosed()).toBe(true);
  });
  it.each([
    [{ account: null }, 'account_missing'], [{}, 'account_missing'],
    [{ account: { type: 'apiKey' } }, 'non_chatgpt_account'],
    [{ account: { type: 'chatgpt', planType: 'free' } }, 'unsupported_plan'],
    [{ account: { type: 'chatgpt', planType: 'untrusted arbitrary detail' } }, 'invalid_account_shape'],
  ])('applies unchanged policy after readiness, without retries: %j', async (response, category) => {
    const fixture = authFixture();
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', completion);
    fixture.setAccount(response);
    fixture.emit('account/updated', { authMode: 'chatgpt', planType: 'plus' });
    expect(await result).toMatchObject({ error: { code: 'subscription_auth_required', category } });
    expect(accountReads(fixture)).toHaveLength(2);
    expect(fixture.calls.filter((call) => call.method === 'account/login/start')).toHaveLength(1);
    expect(fixture.isClosed()).toBe(true);
    expect(fixture.listeners.size).toBe(0);
  });
  it('uses an update reporting disallowed auth only as a barrier, then rejects the final account', async () => {
    const fixture = authFixture();
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', completion);
    fixture.setAccount({ account: { type: 'apiKey' } });
    fixture.emit('account/updated', { authMode: 'apikey', planType: 'free' });
    expect(await result).toMatchObject({ error: { code: 'subscription_auth_required', category: 'non_chatgpt_account' } });
    expect(accountReads(fixture)).toHaveLength(2);
    expect(fixture.listeners.size).toBe(0);
  });
  it('disposes readiness observers when the owned transport closes', async () => {
    const fixture = authFixture();
    const result = login(fixture);
    await fixture.started;
    fixture.emit('account/login/completed', completion);
    await flush();
    await fixture.bridge.close();
    expect(await result).toMatchObject({ error: { code: 'transport_closed' } });
    expect(accountReads(fixture)).toHaveLength(1);
    expect(fixture.listeners.size).toBe(0);
  });
});
