import { readFile } from 'node:fs/promises';
import { spawnIsolated, captureIsolated, LOCAL, VERSION } from './isolation.js';
import { BridgeError, Rpc, safeCause, type Notice } from './rpc.js';
import { accountSummary, assertIncludedUsage, assertLoginReadinessSchema, assertThread, CONFIG, selectModel, serverCommand, threadParams } from './policy.js';
import { verifyProtocol } from './schema.js';

export type Transport = Pick<Rpc, 'request' | 'subscribe' | 'close'>;
export type Ceremony = { verificationUrl: string; userCode: string };
export type TextResult = {
  response: string; status: 'completed' | 'interrupted'; model: string;
  requestedModel: string; resolvedModel: string; codexVersion: string;
  serviceTier: 'default'; effort: 'low'; firstDeltaMs: number | null; totalMs: number;
};

// Subscribe before issuing a request; notifications can precede its response.
export function observe<T>(rpc: Transport, match: (notice: Notice) => T | undefined, timeoutMs: number, timeoutCode: string) {
  let dispose = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { dispose(); reject(new BridgeError(timeoutCode)); }, timeoutMs);
    const unsubscribe = rpc.subscribe((notice) => {
      try {
        const result = match(notice);
        if (result !== undefined) { dispose(); resolve(result); }
      } catch (error) { dispose(); reject(error instanceof BridgeError ? error : new BridgeError('protocol_error')); }
    }, (error) => { dispose(); reject(error); });
    dispose = () => { clearTimeout(timer); unsubscribe(); };
  });
  void promise.catch(() => {}); // May reject before the request's response arrives.
  return { promise, dispose: () => dispose() };
}

export class CodexBridge {
  private active = false;
  constructor(readonly rpc: Transport, readonly turnTimeoutMs = 30_000) {
    if (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs < 1 || turnTimeoutMs > 120_000) throw new BridgeError('invalid_timeout');
  }

  static async start(): Promise<CodexBridge> {
    await verifyProtocol();
    try {
      const [completion, update] = await Promise.all(['AccountLoginCompletedNotification', 'AccountUpdatedNotification']
        .map(async (name) => JSON.parse(await readFile(`${LOCAL}/schema-${VERSION}-json/v2/${name}.json`, 'utf8'))));
      assertLoginReadinessSchema(completion, update);
    } catch { throw new BridgeError('pinned_schema_missing_or_incompatible'); }
    if ((await captureIsolated(['--version'])).trim() !== `codex-cli ${VERSION}`) throw new BridgeError('version_mismatch');
    const rpc = new Rpc(await spawnIsolated(serverCommand(), { network: true }));
    try {
      await rpc.start();
      const { config } = await rpc.request('config/read', { includeLayers: false });
      for (const [key, expected] of Object.entries(CONFIG)) {
        const actual = key.split('.').reduce((value: any, part) => value?.[part], config);
        if (actual !== expected) throw new BridgeError('effective_config_mismatch', key);
      }
      return new CodexBridge(rpc);
    } catch (error) { await rpc.close(); throw error; }
  }

  async login(ceremony: (value: Ceremony) => void, timeoutMs = 180_000): Promise<ReturnType<typeof accountSummary>> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new BridgeError('invalid_timeout');
    let unsubscribe = () => {};
    let loginId: string | undefined;
    let failure: BridgeError | undefined;
    let rejectStop!: (error: BridgeError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    void stopped.catch(() => {});
    const fail = (error: BridgeError) => {
      failure ??= error;
      unsubscribe();
      rejectStop(failure);
    };
    const timer = setTimeout(() => fail(new BridgeError('login_timeout')), timeoutMs);
    const request = (method: string, params: unknown) => failure ? Promise.reject(failure)
      : Promise.race([this.rpc.request(method, params), stopped]);
    try {
      const current = await request('account/read', { refreshToken: false });
      if (current?.account !== null) return accountSummary(current);
      let completedId: string | undefined;
      let updatedAfterCompletion = false;
      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
      const releaseIfReady = () => {
        if (loginId !== undefined && completedId === loginId && updatedAfterCompletion) resolveReady();
      };
      // One subscription retains both events even before login/start returns its ID.
      // account/updated has no login ID and is only an ordered readiness barrier.
      unsubscribe = this.rpc.subscribe(({ method, params }) => {
        if (method === 'account/login/completed') {
          if (params.success !== true || typeof params.loginId !== 'string'
            || (loginId !== undefined && params.loginId !== loginId)
            || (completedId !== undefined && params.loginId !== completedId)) {
            fail(new BridgeError('login_failed'));
            return;
          }
          completedId = params.loginId;
        } else if (method === 'account/updated' && completedId !== undefined) {
          updatedAfterCompletion = true;
        }
        releaseIfReady();
      }, fail);
      // No token fields, API auth, browser launching, keyring, or credential file access.
      const login = await request('account/login/start', { type: 'chatgptDeviceCode' });
      if (login?.type !== 'chatgptDeviceCode' || typeof login.loginId !== 'string'
        || typeof login.userCode !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(login.userCode)) throw new BridgeError('managed_login_unavailable');
      const url = new URL(login.verificationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password || url.port) throw new BridgeError('unexpected_login_origin');
      loginId = login.loginId;
      if (completedId !== undefined && completedId !== loginId) throw new BridgeError('login_failed');
      if (failure) throw failure;
      ceremony({ verificationUrl: url.href, userCode: login.userCode });
      releaseIfReady();
      await Promise.race([ready, stopped]);
      const finalAccount = await request('account/read', { refreshToken: false });
      if (failure) throw failure;
      return accountSummary(finalAccount);
    } catch (error) {
      unsubscribe();
      if (loginId) await this.rpc.request('account/login/cancel', { loginId }).catch(() => {});
      await this.close();
      throw error instanceof BridgeError ? error : new BridgeError('login_failed');
    } finally { clearTimeout(timer); unsubscribe(); }
  }

  async catalog(): Promise<any[]> {
    const models: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const result = await this.rpc.request('model/list', { cursor, limit: 100, includeHidden: false });
      if (!Array.isArray(result?.data)) throw new BridgeError('protocol_error');
      models.push(...result.data);
      if (result.nextCursor === null) return models;
      if (typeof result.nextCursor !== 'string' || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    throw new BridgeError('catalog_pagination_limit');
  }

  async checkUsage(model: string): Promise<void> {
    accountSummary(await this.rpc.request('account/read', { refreshToken: false }));
    assertIncludedUsage(await this.rpc.request('account/rateLimits/read', {
      supportsLunaReserve: false, excludeResetCreditDetails: true,
    }), model);
  }

  async prepareThread(): Promise<{ threadId: string; model: string }> {
    const account = accountSummary(await this.rpc.request('account/read', { refreshToken: false }));
    const model = selectModel(await this.catalog(), account.planType);
    const result = await this.rpc.request('thread/start', threadParams(model));
    return { threadId: assertThread(result, model), model };
  }

  async text(prompt: string, options: { signal?: AbortSignal; onDelta?: (text: string) => Promise<void> | void } = {}): Promise<TextResult> {
    if (this.active) throw new BridgeError('turn_active');
    if (options.signal?.aborted) { await this.close(); throw new BridgeError('aborted'); }
    if (!prompt.trim() || prompt.length > 4000) throw new BridgeError('invalid_prompt');
    this.active = true;
    let failure: BridgeError | undefined;
    let rejectFault!: (error: BridgeError) => void;
    const transportFault = new Promise<never>((_, reject) => { rejectFault = reject; });
    void transportFault.catch(() => {});
    let unsubscribe = () => {};
    try {
      // Completion ends its event observer, not the text operation's fault lifetime.
      unsubscribe = this.rpc.subscribe(() => {}, (error) => {
        failure ??= error;
        rejectFault(failure);
      });
      const { threadId, model } = await Promise.race([this.prepareThread(), transportFault]);
      if (options.signal?.aborted) throw new BridgeError('aborted');
      await Promise.race([this.checkUsage(model), transportFault]);
      if (options.signal?.aborted) throw new BridgeError('aborted');
      const result = await this.runTurn(threadId, model, prompt, options, transportFault);
      if (failure) throw failure;
      if (result.status === 'interrupted') await this.close();
      return result;
    } catch (error) { await this.close(); throw error; }
    finally { unsubscribe(); this.active = false; }
  }

  private async runTurn(threadId: string, model: string, prompt: string, options: {
    signal?: AbortSignal; onDelta?: (text: string) => Promise<void> | void;
  }, transportFault: Promise<never>): Promise<TextResult> {
    const start = performance.now();
    let firstDeltaMs: number | null = null;
    let totalMs = 0;
    let response = '';
    let turnId: string | undefined;
    let observedTurnId: string | undefined;
    let finished = false;
    let interrupted = false;
    let callbacks = Promise.resolve();
    let callbackFailure: BridgeError | undefined;
    const completion = observe(this.rpc, ({ method, params }) => {
      if (params.threadId !== threadId) return;
      if (method === 'error') throw new BridgeError(safeCause(params.error?.message));
      if (method === 'model/rerouted') throw new BridgeError('model_rerouted');
      if (method === 'item/agentMessage/delta' || method === 'turn/completed') {
        const id = method === 'turn/completed' ? params.turn?.id : params.turnId;
        if (typeof id !== 'string' || (observedTurnId && observedTurnId !== id)) throw new BridgeError('turn_id_mismatch');
        observedTurnId = id;
      }
      if (method === 'item/agentMessage/delta') {
        if (typeof params.delta !== 'string') throw new BridgeError('protocol_error');
        if (params.delta.length && firstDeltaMs === null) firstDeltaMs = performance.now() - start;
        response += params.delta;
        if (response.length > 64_000) throw new BridgeError('response_limit');
        callbacks = callbacks.then(async () => { await options.onDelta?.(params.delta); }).catch(() => {
          callbackFailure = new BridgeError('delta_callback_failed');
        });
      }
      if (method === 'turn/completed') {
        finished = true;
        totalMs = performance.now() - start;
        return params.turn;
      }
    }, this.turnTimeoutMs, 'turn_timeout');
    let interruptRequest: Promise<unknown> | undefined;
    const interrupt = () => {
      if (turnId && !finished && !interrupted) {
        interrupted = true;
        interruptRequest = this.rpc.request('turn/interrupt', { threadId, turnId });
        void interruptRequest.catch(() => {});
      }
    };
    options.signal?.addEventListener('abort', interrupt, { once: true });
    let timer: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BridgeError('turn_timeout')), this.turnTimeoutMs);
      });
      const work = async (): Promise<TextResult> => {
        const started = await this.rpc.request('turn/start', {
          threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
          effort: 'low', serviceTier: 'default',
        });
        if (typeof started?.turn?.id !== 'string') throw new BridgeError('protocol_error');
        turnId = started.turn.id;
        if (options.signal?.aborted) interrupt();
        const turn = await completion.promise;
        if (observedTurnId !== turnId) throw new BridgeError('turn_id_mismatch');
        await interruptRequest;
        await callbacks;
        if (callbackFailure) throw callbackFailure;
        if (turn.status !== 'completed' && turn.status !== 'interrupted') throw new BridgeError('turn_failed');
        if (interrupted && turn.status !== 'interrupted') throw new BridgeError('interruption_not_confirmed');
        if (turn.status === 'completed' && !response.trim()) throw new BridgeError('empty_response');
        return { response, status: turn.status, model, requestedModel: model, resolvedModel: model,
          codexVersion: VERSION, serviceTier: 'default', effort: 'low', firstDeltaMs, totalMs };
      };
      return await Promise.race([work(), deadline, transportFault]);
    } finally {
      clearTimeout(timer);
      completion.dispose();
      options.signal?.removeEventListener('abort', interrupt);
    }
  }

  async close(): Promise<void> { await this.rpc.close(); }
}
