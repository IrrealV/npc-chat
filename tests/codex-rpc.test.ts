import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError, Rpc, safeCause, projectBridgeError } from '../src/codex/rpc.js';

const clients: Rpc[] = [];
function fixture(mode = '', timeout = 500): Rpc {
  const child = spawn(process.execPath, ['tests/fixtures/codex-server.mjs', mode], { env: {}, stdio: 'pipe' });
  const rpc = new Rpc(child, timeout);
  clients.push(rpc);
  return rpc;
}
afterEach(async () => { await Promise.all(clients.splice(0).map((rpc) => rpc.close())); });

describe('owned stdio fixture', () => {
  it('initializes once, preserves fragmented UTF-8 and immediate responses', async () => {
    const rpc = fixture();
    await rpc.start();
    await expect(rpc.request('fragment', {})).resolves.toBe('caída 🙃');
    await expect(rpc.request('echo', { value: 2 })).resolves.toEqual({ value: 2 });
    await expect(rpc.start()).rejects.toMatchObject({ code: 'already_started' });
  });
  it('projects provider errors without raw messages', async () => {
    const rpc = fixture();
    await rpc.start();
    await expect(rpc.request('error', {})).rejects.toMatchObject({ code: 'provider_error' });
  });
  it.each(['crash', 'malformed', 'hang'])('rejects and tears down on %s', async (method) => {
    const rpc = fixture('', 100);
    await rpc.start();
    await expect(rpc.request(method, {})).rejects.toBeInstanceOf(Error);
    await rpc.close();
    expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
  });
  it('force-kills and reaps a child ignoring EOF and SIGTERM', async () => {
    const rpc = fixture('stubborn');
    await rpc.start();
    await rpc.close();
    expect(rpc.child.signalCode).toBe('SIGKILL');
  });
});

function mockPipe() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: () => { queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true; },
  });
  const sent: any[] = [];
  child.stdin.on('data', (data: Buffer) => {
    const frame = JSON.parse(data.toString());
    sent.push(frame);
    if (frame.method === 'initialize') child.stdout.write(JSON.stringify({ id: frame.id, result: {} }) + '\n');
  });
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0, null)));
  const rpc = new Rpc(child as unknown as ChildProcessWithoutNullStreams);
  clients.push(rpc);
  return { rpc, child, sent };
}

describe('synchronous transport and fail-closed server requests (mocked)', () => {
  it.each([
    ['item/commandExecution/requestApproval', 42, 'command'],
    ['item/fileChange/requestApproval', 'opaque-id', 'file'],
    ['item/tool/call', 'tool-id', 'tool'],
    ['item/permissions/requestApproval', 'permissions-id', 'permissions'],
    ['unknown/provider/request', 7, 'unknown'],
  ])('denies %s preserving its exact ID', async (method, id, category) => {
    const { rpc, child, sent } = mockPipe();
    await rpc.start();
    expect(sent.map((frame) => frame.method)).toEqual(['initialize', 'initialized']);
    expect(sent[0]).not.toHaveProperty('jsonrpc');
    const pending = rpc.request('waiting', {}).catch((error) => error);
    child.stdout.write(JSON.stringify({ id, method, params: { private: 'untrusted detail' } }) + '\n');
    const error = await pending;
    expect(error).toMatchObject({ code: 'blocked_server_request', category });
    expect(projectBridgeError(error)).toEqual({ error: 'blocked_server_request', category });
    expect(sent.at(-1)).toEqual({ id, error: { code: -32601, message: 'Client forbids tools and permission grants' } });
    expect(JSON.stringify(sent)).not.toContain('untrusted detail');
  });
  it.each([
    ['thread/environment/connected', {}],
    ['hook/started', {}],
    ['item/started', { item: { type: 'commandExecution' } }],
  ])('stops forbidden activity notification %s', async (method, params) => {
    const { rpc, child } = mockPipe();
    await rpc.start();
    const pending = expect(rpc.request('waiting', {})).rejects.toMatchObject({ code: 'blocked_activity' });
    child.stdout.write(JSON.stringify({ method, params }) + '\n');
    await pending;
  });
  it('projects a blocked item identity without its payload and still closes', async () => {
    const { rpc, child } = mockPipe();
    let closed = false;
    child.once('close', () => { closed = true; });
    await rpc.start();
    const pending = rpc.request('waiting', {}).catch((error) => error);
    child.stdout.write(JSON.stringify({ method: 'item/started', params: {
      threadId: 'UNTRUSTED_PAYLOAD', item: { type: 'commandExecution', command: 'UNTRUSTED_PAYLOAD', cwd: 'UNTRUSTED_PAYLOAD' },
    } }) + '\n');
    const error = await pending;
    expect(projectBridgeError(error)).toEqual({ error: 'blocked_activity', category: 'tool',
      activity: { method: 'item/started', itemType: 'commandExecution' } });
    expect(JSON.stringify(projectBridgeError(error))).not.toContain('UNTRUSTED_PAYLOAD');
    await rpc.close();
    expect(closed).toBe(true);
  });
  it('rejects invalid UTF-8 instead of replacing bytes', async () => {
    const { rpc, child } = mockPipe();
    await rpc.start();
    const pending = expect(rpc.request('waiting', {})).rejects.toMatchObject({ code: 'protocol_error' });
    child.stdout.write(Buffer.from([0xff, 0x0a]));
    await pending;
  });
  it('retains only known safe Live compatibility causes', () => {
    expect(safeCause('text realtime output modality requires realtime v2')).toBe('text_requires_realtime_v2');
    expect(safeCause('realtime conversation requires API key auth')).toBe('realtime_websocket_requires_api_key');
    expect(safeCause('untrusted personal detail')).toBe('provider_error');
  });
});

const poison = 'UNTRUSTED_PAYLOAD';
const hostilePayload = { [poison]: poison, name: poison, id: poison, path: poison, url: poison,
  command: poison, tool: poison, arguments: poison, result: poison, text: poison, account: poison };
async function activityDiagnostic(method: string, params: Record<string, unknown>) {
  const { rpc, child } = mockPipe();
  let closed = false;
  child.once('close', () => { closed = true; });
  await rpc.start();
  const pending = rpc.request('waiting', {}).catch((error) => error);
  child.stdout.write(JSON.stringify({ method, params: { ...hostilePayload, ...params } }) + '\n');
  const error = await pending;
  expect(error.code).toBe('blocked_activity');
  const diagnostic = { phase: 'text', ...projectBridgeError(error) };
  expect(error.activity).toEqual(diagnostic.activity);
  expect(JSON.stringify(diagnostic)).not.toContain(poison);
  await rpc.close();
  expect(closed).toBe(true);
  return diagnostic;
}

describe('fixed quota error projection', () => {
  it.each([
    'ordinary_permission_unavailable', 'ordinary_permission_denied', 'buckets_missing_or_invalid',
    'spend_control_blocked', 'spend_control_missing_or_invalid', 'reached_type_present_or_invalid',
    'windows_missing_or_invalid', 'windows_absent', 'windows_exhausted',
  ])('projects only the allowed quota category %s, not attached fields or hooks', (category) => {
    const error = Object.assign(new BridgeError('included_usage_unavailable', category), {
      ...hostilePayload, message: poison, cause: hostilePayload, params: hostilePayload,
      activity: hostilePayload, toJSON: () => { throw new Error('must not serialize error'); },
    });
    expect(JSON.parse(JSON.stringify(projectBridgeError(error)))).toEqual({ error: 'included_usage_unavailable', category });
  });
  it.each([undefined, null, '', false, true, 42, NaN, Infinity, [], {}, poison, 'unsupported_plan',
    { toJSON: () => 'ordinary_permission_denied', toString: () => 'ordinary_permission_denied' },
  ].map((category) => ({ category })))('omits missing, invalid or arbitrary quota categories, case %#', ({ category }) => {
    const error = new BridgeError('included_usage_unavailable', category as string);
    expect(projectBridgeError(error)).not.toHaveProperty('category');
    expect(JSON.parse(JSON.stringify(projectBridgeError(error)))).toEqual({ error: 'included_usage_unavailable' });
  });
});

describe('fixed activity metadata and CLI-safe error projection', () => {
  it.each([
    'thread/environment/connected', 'hook/started', 'hook/completed',
    'mcpServer/oauthLogin/completed', 'mcpServer/event/stream/notification',
    'command/exec/outputDelta', 'process/outputDelta', 'process/exited', 'fs/changed',
    'item/commandExecution/outputDelta', 'item/commandExecution/terminalInteraction',
    'item/fileChange/outputDelta', 'item/fileChange/patchUpdated', 'item/mcpToolCall/progress',
  ])('retains known blocked method %s, never its payload', async (method) => {
    expect(await activityDiagnostic(method, { status: poison, item: { type: poison } })).toEqual({
      phase: 'text', error: 'blocked_activity', category: method === 'thread/environment/connected' ? 'environment' : 'tool',
      activity: { method },
    });
  });
  it.each([
    'hookPrompt', 'functionCallOutput', 'plan', 'commandExecution', 'fileChange', 'mcpToolCall',
    'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity', 'webSearch', 'imageView', 'sleep',
    'imageGeneration', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction', poison, undefined,
  ].flatMap((itemType) => ['item/started', 'item/completed'].map((method) => ({ method, itemType }))))(
    'retains only fixed item types: $method/$itemType', async ({ method, itemType }) => {
      expect(await activityDiagnostic(method, { item: { ...hostilePayload, type: itemType }, status: poison })).toEqual({
        phase: 'text', error: 'blocked_activity', category: 'tool',
        activity: { method, itemType: itemType === poison || itemType === undefined ? 'unrecognized' : itemType },
      });
    });
  it.each(['starting', 'ready', 'failed', 'cancelled', poison, undefined])(
    'reports fixed MCP startup status %s without exempting it from rejection', async (status) => {
      expect(await activityDiagnostic('mcpServer/startupStatus/updated', { status })).toEqual({
        phase: 'text', error: 'blocked_activity', category: 'tool', activity: {
          method: 'mcpServer/startupStatus/updated', status: status === poison || status === undefined ? 'unrecognized' : status,
        },
      });
    });
  it.each(['hook/', 'mcpServer/', 'command/', 'process/', 'fs/',
    'item/commandExecution/', 'item/fileChange/', 'item/mcpToolCall/'])(
    'normalizes unknown methods still prohibited by existing prefix %s', async (prefix) => {
      expect(await activityDiagnostic(prefix + poison, { item: { type: poison }, status: poison })).toEqual({
        phase: 'text', error: 'blocked_activity', category: 'tool', activity: { method: 'unrecognized' },
      });
    });
  it('rebuilds mutated activity objects and never serializes accidental error fields or hooks', () => {
    const error = Object.assign(new BridgeError('blocked_activity', 'tool'), {
      message: poison, cause: hostilePayload, params: hostilePayload, account: hostilePayload,
      toJSON: () => hostilePayload,
      activity: { ...hostilePayload, method: 'item/completed', itemType: poison, status: poison, toJSON: () => hostilePayload },
    });
    const diagnostic = { phase: 'text', ...projectBridgeError(error) };
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual({ phase: 'text', error: 'blocked_activity', category: 'tool',
      activity: { method: 'item/completed', itemType: 'unrecognized' } });
    expect(JSON.stringify(diagnostic)).not.toContain(poison);
    expect(projectBridgeError(new Error(poison, { cause: hostilePayload }))).toEqual({ error: 'runtime_setup_failed' });
  });
  it('adds activity only to blocked_activity, preserving other code/category projections', () => {
    const error = Object.assign(new BridgeError('subscription_auth_required', 'unsupported_plan'), {
      message: poison, cause: hostilePayload, activity: { method: 'item/started', itemType: 'commandExecution' },
    });
    expect(projectBridgeError(error)).toEqual({ error: 'subscription_auth_required', category: 'unsupported_plan' });
    expect(new BridgeError('provider_error', undefined, { method: 'item/started' }).activity).toBeUndefined();
  });
  it('does not change previously permitted notification handling or add account payload logging', async () => {
    const { rpc, child, sent } = mockPipe();
    await rpc.start();
    const delivered: string[] = [];
    const faults: unknown[] = [];
    const unsubscribe = rpc.subscribe((notice) => { delivered.push(notice.method); }, (error) => { faults.push(error); });
    const methods = ['remoteControl/status/changed', 'thread/started', 'warning', 'account/updated', 'future/' + poison];
    for (const method of methods) child.stdout.write(JSON.stringify({ method, params: hostilePayload }) + '\n');
    for (const type of ['userMessage', 'agentMessage', 'reasoning']) {
      for (const method of ['item/started', 'item/completed']) child.stdout.write(JSON.stringify({ method, params: { item: { type } } }) + '\n');
    }
    expect(delivered).toHaveLength(methods.length + 6);
    expect(faults).toEqual([]);
    const pending = rpc.request('waiting', {});
    child.stdout.write(JSON.stringify({ id: sent.at(-1).id, result: {} }) + '\n');
    await expect(pending).resolves.toEqual({});
    unsubscribe();
  });
});
