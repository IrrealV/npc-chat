import type { ChildProcessWithoutNullStreams } from 'node:child_process';

// Diagnostic literals only, from the pinned 0.154.0 generated schemas; not permission rules.
const ACTIVITY_METHODS = [
  'thread/environment/connected', 'hook/started', 'hook/completed',
  'mcpServer/oauthLogin/completed', 'mcpServer/startupStatus/updated', 'mcpServer/event/stream/notification',
  'command/exec/outputDelta', 'process/outputDelta', 'process/exited', 'fs/changed',
  'item/commandExecution/outputDelta', 'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta', 'item/fileChange/patchUpdated', 'item/mcpToolCall/progress',
  'item/started', 'item/completed',
] as const;
const ITEM_TYPES = [
  'userMessage', 'hookPrompt', 'agentMessage', 'functionCallOutput', 'plan', 'reasoning',
  'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall',
  'subAgentActivity', 'webSearch', 'imageView', 'sleep', 'imageGeneration',
  'enteredReviewMode', 'exitedReviewMode', 'contextCompaction',
] as const;
const MCP_STARTUP_STATES = ['starting', 'ready', 'failed', 'cancelled'] as const;
type ActivityInput = { method?: unknown; itemType?: unknown; status?: unknown };
const literal = <T extends string>(known: readonly T[], value: unknown): T | 'unrecognized' =>
  known.find((entry) => entry === value) ?? 'unrecognized';

function projectActivity(activity?: ActivityInput) {
  const method = literal(ACTIVITY_METHODS, activity?.method);
  return { method,
    ...(method === 'item/started' || method === 'item/completed'
      ? { itemType: literal(ITEM_TYPES, activity?.itemType) } : {}),
    ...(method === 'mcpServer/startupStatus/updated'
      ? { status: literal(MCP_STARTUP_STATES, activity?.status) } : {}),
  };
}

const QUOTA_CATEGORIES = [
  'ordinary_permission_unavailable', 'ordinary_permission_denied', 'buckets_missing_or_invalid',
  'spend_control_blocked', 'spend_control_missing_or_invalid', 'reached_type_present_or_invalid',
  'windows_missing_or_invalid', 'windows_absent', 'windows_exhausted',
] as const;
export type QuotaCategory = typeof QUOTA_CATEGORIES[number];

export class BridgeError extends Error {
  readonly activity?: ReturnType<typeof projectActivity>;
  constructor(readonly code: string, readonly category?: string, activity?: ActivityInput) {
    super(code);
    if (code === 'blocked_activity') this.activity = projectActivity(activity);
  }
}

export function projectBridgeError(error: unknown) {
  // Rebuild the output: never serialize the error, cause, params, or attached object wholesale.
  const category = error instanceof BridgeError
    ? error.code === 'included_usage_unavailable'
      ? QUOTA_CATEGORIES.find((known) => known === error.category) : error.category
    : undefined;
  return { error: error instanceof BridgeError ? error.code : 'runtime_setup_failed',
    ...(category ? { category } : {}),
    ...(error instanceof BridgeError && error.code === 'blocked_activity'
      ? { activity: projectActivity(error.activity) } : {}),
  };
}

export function safeCause(value: unknown): string {
  const message = typeof value === 'string' ? value : '';
  if (message.includes('text realtime output modality requires realtime v2')) return 'text_requires_realtime_v2';
  if (message.includes('realtime conversation requires API key auth')) return 'realtime_websocket_requires_api_key';
  return 'provider_error';
}

export type Notice = { method: string; params: Record<string, any> };
function blockedCategory(method: string): string {
  if (method.includes('commandExecution') || method === 'execCommandApproval') return 'command';
  if (method.includes('fileChange') || method === 'applyPatchApproval') return 'file';
  if (method.includes('/tool/')) return 'tool';
  if (method.includes('/permissions/')) return 'permissions';
  return 'unknown';
}

export class Rpc {
  private sequence = 0;
  private started = false;
  private ready = false;
  private failure?: BridgeError;
  private buffer = '';
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: BridgeError) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<{ notice: (value: Notice) => void; fault: (error: BridgeError) => void }>();
  private closing?: Promise<void>;
  private exited: Promise<void>;

  constructor(readonly child: ChildProcessWithoutNullStreams, readonly timeoutMs = 10_000) {
    this.exited = new Promise((resolve) => child.once('close', resolve));
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr.resume(); // Raw process output is never logged or retained.
    child.stdin.on('error', () => this.fail(new BridgeError('transport_error')));
    child.on('error', () => this.fail(new BridgeError('transport_error')));
    child.on('close', () => this.fail(new BridgeError('transport_closed')));
  }

  async start(): Promise<void> {
    if (this.started) throw new BridgeError('already_started');
    this.started = true;
    await this.request('initialize', {
      clientInfo: { name: 'npc_chat_batch1', title: 'Isolated text probe', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
    this.ready = true;
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.ready && method !== 'initialize') return Promise.reject(new BridgeError('not_initialized'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new BridgeError('request_timeout')), this.timeoutMs);
      // Register before write: a peer may answer synchronously or emit events first.
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  subscribe(notice: (value: Notice) => void, fault: (error: BridgeError) => void): () => void {
    const listener = { notice, fault };
    this.listeners.add(listener);
    if (this.failure) queueMicrotask(() => fault(this.failure!));
    return () => { this.listeners.delete(listener); };
  }

  private send(value: unknown): void {
    try { this.child.stdin.write(JSON.stringify(value) + '\n'); }
    catch { this.fail(new BridgeError('transport_error')); }
  }

  private consume(chunk: Buffer): void {
    if (this.failure) return;
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      if (this.buffer.length > 2_000_000) throw new Error();
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0 && !this.failure) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        if (typeof message.method === 'string') {
          if ('id' in message) {
            if (typeof message.id !== 'string' && !Number.isSafeInteger(message.id)) throw new Error();
            this.send({ id: message.id, error: { code: -32601, message: 'Client forbids tools and permission grants' } });
            this.fail(new BridgeError('blocked_server_request', blockedCategory(message.method)));
          } else {
            if (!message.params || typeof message.params !== 'object') throw new Error();
            const method = message.method;
            if (method === 'thread/environment/connected' || method.startsWith('hook/')
              || method.startsWith('mcpServer/') || method.startsWith('command/')
              || method.startsWith('process/') || method.startsWith('fs/')
              || /^item\/(commandExecution|fileChange|mcpToolCall)\//.test(method)
              || ((method === 'item/started' || method === 'item/completed')
                && !['userMessage', 'agentMessage', 'reasoning'].includes(message.params.item?.type))) {
              this.fail(new BridgeError('blocked_activity', method === 'thread/environment/connected' ? 'environment' : 'tool',
                { method, itemType: message.params.item?.type, status: message.params.status }));
              return;
            }
            if (method === 'configWarning' || method === 'model/rerouted') {
              this.fail(new BridgeError(method === 'configWarning' ? 'config_warning' : 'model_rerouted'));
              return;
            }
            for (const listener of this.listeners) listener.notice(message);
          }
        } else {
          const pending = this.pending.get(message.id);
          if (!pending || ('result' in message) === ('error' in message)) throw new Error();
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if ('error' in message) pending.reject(new BridgeError(safeCause(message.error?.message)));
          else pending.resolve(message.result);
        }
      }
    } catch { this.fail(new BridgeError('protocol_error')); }
  }

  private fail(error: BridgeError): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener.fault(error);
    void this.close();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      // Give a denial frame and EOF a chance to reach the owned process.
      this.child.stdin.end();
      const terminate = setTimeout(() => this.child.kill('SIGTERM'), 100);
      const kill = setTimeout(() => this.child.kill('SIGKILL'), 300);
      await this.exited;
      clearTimeout(terminate);
      clearTimeout(kill);
    })();
    this.fail(new BridgeError('closed'));
    return this.closing;
  }
}
