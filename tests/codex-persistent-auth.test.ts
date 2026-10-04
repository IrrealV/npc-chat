import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as isolation from '../src/codex/isolation.js';
import { CodexBridge } from '../src/codex/bridge.js';
import { PERSISTENT_CONFIG } from '../src/codex/policy.js';
import { resolveProfile } from '../src/codex/profile.js';
import { FLOCK_BINARY, FLOCK_CONFLICT_CODE } from '../src/codex/isolation.js';
import { runLogoutCli, type LogoutBridge, type LogoutCliRuntime } from '../src/npc/logout-cli.js';
import { BridgeError, type Notice } from '../src/codex/rpc.js';

// ---------------------------------------------------------------------------
// Native boundary mocks.
//
// Isolation (bwrap/flock spawn, `--version`) is fully injected. The runtime
// schema gates (`schema.verifyProtocol` and the readiness reads inside
// `verifyRuntime`) are real code paths, but every schema byte is served from
// the in-memory fixtures below. Any schema read without a fixture hits the
// tripwire and throws before touching the real, ignored `.local` caches, so a
// missing fixture can never silently depend on local machine state.
// ---------------------------------------------------------------------------
const schemaState = vi.hoisted(() => ({
  prefixes: [] as string[],
  fixtures: new Map<string, string>(),
  served: [] as string[],
  forbidden: [] as string[],
  verifyProtocolCalls: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = async (path: unknown, options?: unknown): Promise<unknown> => {
    const target = typeof path === 'string' ? path : String(path);
    if (schemaState.prefixes.some((prefix) => target.startsWith(prefix))) {
      const fixture = schemaState.fixtures.get(target);
      if (fixture === undefined) {
        schemaState.forbidden.push(target);
        throw new Error(`npc_schema_read_tripwire: ${target}`);
      }
      schemaState.served.push(target);
      return fixture;
    }
    return (actual.readFile as (p: unknown, o?: unknown) => Promise<unknown>)(path, options);
  };
  return { ...actual, readFile };
});

// The gate itself is wrapped only to record that the production path invoked it;
// the real implementation still runs against the fixture-backed reads.
vi.mock('../src/codex/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex/schema.js')>();
  return {
    ...actual,
    verifyProtocol: vi.fn(async () => {
      schemaState.verifyProtocolCalls += 1;
      await actual.verifyProtocol();
    }),
  };
});

vi.mock('../src/codex/isolation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex/isolation.js')>();
  return {
    ...actual,
    captureIsolated: vi.fn(async () => `codex-cli ${actual.VERSION}`),
    spawnPersistent: vi.fn(),
  };
});

type Frame = { id?: number; method?: string; params?: unknown };
type FakeServer = { child: ChildProcessWithoutNullStreams; frames: Frame[]; close: (code: number | null) => void };

function nest(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cursor = nested;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)!] = value;
  }
  return nested;
}

function fakeServerChild(options: { respond?: boolean; config?: Record<string, unknown>; logoutResult?: unknown; logoutError?: string } = {}): FakeServer {
  const respond = options.respond ?? true;
  const config = nest(options.config ?? {});
  const logoutResult = 'logoutResult' in options ? options.logoutResult : {};
  const emitter = new EventEmitter();
  const frames: Frame[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n').filter((value) => value.length > 0)) {
        const frame = JSON.parse(line) as Frame;
        frames.push(frame);
        if (!respond || frame.id === undefined || frame.method === undefined) continue;
        if (frame.method === 'account/logout' && options.logoutError !== undefined) {
          stdout.write(`${JSON.stringify({ id: frame.id, error: { code: -32000, message: options.logoutError } })}\n`);
          continue;
        }
        const result = frame.method === 'config/read' ? { config }
          : frame.method === 'account/logout' ? logoutResult : {};
        stdout.write(`${JSON.stringify({ id: frame.id, result })}\n`);
      }
      callback();
    },
  });
  let exited = false;
  const close = (code: number | null) => {
    if (exited) return;
    exited = true;
    emitter.emit('close', code, null);
  };
  stdin.on('finish', () => close(null));
  const child = Object.assign(emitter, { stdin, stdout, stderr, pid: 4242, killed: false, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
  return { child, frames, close };
}

// A transport failure (stdin error) is delivered before the owned process
// reports its exit status, exactly like a real early flock conflict.
function transportErrorChild(code: number): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('EPIPE')); } });
  let exited = false;
  const close = (status: number) => { if (exited) return; exited = true; emitter.emit('close', status, null); };
  stdin.on('error', () => {});
  stdin.on('error', () => setImmediate(() => close(code)));
  return Object.assign(emitter, { stdin, stdout, stderr, pid: 99, killed: false, kill: () => { close(code); return true; } }) as unknown as ChildProcessWithoutNullStreams;
}

// ---------------------------------------------------------------------------
// Owned-process registry.
//
// Every real spawn is registered before it is awaited or asserted on. The
// registry settles each entry from its own `error`/`close` handlers, so a
// failing assertion after readiness can never leak a kernel-held flock: hook
// cleanup terminates owned process groups and awaits real close before any
// fixture directory is removed.
// ---------------------------------------------------------------------------
type OwnedProcess = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly label: string;
  settled: Promise<void>;
  done: boolean;
  code: number | null | undefined;
  spawnError: Error | undefined;
};

const opened: CodexBridge[] = [];
const temporary: string[] = [];
const owned: OwnedProcess[] = [];
const KILL_GRACE_MS = 2000;

function ownProcess(child: ChildProcessWithoutNullStreams, label: string): OwnedProcess {
  const entry: OwnedProcess = { child, label, settled: Promise.resolve(), done: false, code: undefined, spawnError: undefined };
  entry.settled = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; entry.done = true; resolve(); };
    // An `error` event only records diagnostics. A child that fails to spawn
    // still emits `close` (ENOENT -> close -2), while a child that reports an
    // error without closing must stay unsettled so cleanup can still signal
    // its process group instead of leaking it.
    const onError = (error: Error) => { entry.spawnError ??= error; };
    const onClose = (code: number | null) => { entry.code = code; child.off('error', onError); finish(); };
    child.on('error', onError);
    child.once('close', onClose);
  });
  owned.push(entry);
  return entry;
}

function spawnOwned(binary: string, argv: string[], label: string): OwnedProcess {
  const child = spawn(binary, argv, { stdio: 'pipe', detached: true }) as ChildProcessWithoutNullStreams;
  const entry = ownProcess(child, label);
  child.stdout.resume();
  child.stderr.resume();
  return entry;
}

// A synthetic child for the cleanup-ownership regressions. It never spawns a
// real process: the test drives `error`/`close` by hand, and `process.kill` is
// mocked in those tests so no synthetic PID can reach the OS.
type SyntheticChild = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly pid: number;
  emitError: (error: Error) => void;
  emitClose: (code: number | null) => void;
};

function syntheticChild(pid: number): SyntheticChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(emitter, {
    stdin, stdout, stderr, pid, killed: false, kill: () => true,
  }) as unknown as ChildProcessWithoutNullStreams;
  return {
    child, pid,
    emitError: (error) => emitter.emit('error', error),
    emitClose: (code) => emitter.emit('close', code, null),
  };
}

// Only ever signals a process-group leader that this suite spawned. Never
// signals a marker PID from an unknown origin or the test runner itself.
function signalOwned(entry: OwnedProcess, signal: NodeJS.Signals): void {
  const pid = entry.child.pid;
  if (pid === undefined || pid <= 1 || pid === process.pid) return;
  try { process.kill(-pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

async function settleWithin(entry: OwnedProcess, timeoutMs: number): Promise<boolean> {
  if (entry.done) return true;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref(); });
  try {
    return await Promise.race([entry.settled.then(() => true), expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function exitCode(entry: OwnedProcess): Promise<number | null> {
  await entry.settled;
  return entry.code ?? null;
}

async function terminateOwned(entry: OwnedProcess): Promise<void> {
  if (entry.done) return;
  const failures: unknown[] = [];
  try { entry.child.stdin.destroy(); } catch { /* stdin already closed */ }
  if (await settleWithin(entry, KILL_GRACE_MS)) return;
  // Every escalation runs even if an earlier signal throws: a failure to
  // signal one owner must not strand the owner in an unowned state. Failures
  // are collected and reported only after the whole escalation is attempted.
  const escalate = async (signal: NodeJS.Signals): Promise<boolean> => {
    try { signalOwned(entry, signal); }
    catch (error) { failures.push(error); }
    return await settleWithin(entry, KILL_GRACE_MS);
  };
  if (await escalate('SIGTERM')) return;
  if (await escalate('SIGKILL')) return;
  throw failures.length > 0
    ? new AggregateError(failures, `failed to terminate owned process ${entry.label}`)
    : new Error(`owned process ${entry.label} did not settle after SIGKILL`);
}

async function closeBridges(): Promise<void> {
  const bridges = opened.splice(0);
  await Promise.all(bridges.map(async (bridge) => {
    try { await bridge.close(); } catch { /* bridge already released its child */ }
  }));
}

async function disposeOwned(): Promise<void> {
  const pending = owned.splice(0);
  const failures: unknown[] = [];
  for (const entry of pending) {
    try { await terminateOwned(entry); }
    catch (error) { failures.push(error); }
    // Retain any owner that is not confirmed closed, under every failure mode,
    // so the hook can never delete evidence for a still-running owner.
    if (!entry.done) owned.push(entry);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `failed to settle ${failures.length} owned process(es)`);
  }
}

async function deleteFixtures(): Promise<void> {
  const directories = temporary.splice(0);
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
}

async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

// Event-based readiness: watch the containing directory and probe on change,
// with a single bounded timer. No sleep/poll loop and no second read channel.
async function waitForPath(path: string, timeoutMs = 4000): Promise<string> {
  const attempt = async (): Promise<string | undefined> => {
    try { return await readFile(path, 'utf8'); } catch { return undefined; }
  };
  const ready = await attempt();
  if (ready !== undefined) return ready;
  return await new Promise<string>((resolve, reject) => {
    const directory = dirname(path);
    const name = basename(path);
    let watcher: FSWatcher | undefined;
    let timer: NodeJS.Timeout | undefined;
    let done = false;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      watcher?.close();
      if (timer !== undefined) clearTimeout(timer);
      settle();
    };
    const probe = (): void => {
      void attempt().then((value) => { if (value !== undefined) finish(() => resolve(value)); });
    };
    const fail = (error: unknown): void => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    };
    try {
      watcher = watch(directory, (_event, filename) => {
        if (filename !== null && filename !== name) return;
        probe();
      });
      watcher.on('error', fail);
    } catch (error) {
      fail(error);
      return;
    }
    timer = setTimeout(() => fail(new Error(`timed out waiting for ${path}`)), timeoutMs);
    timer.unref();
    probe(); // Close the create-before-watch window deterministically.
  });
}

// ---------------------------------------------------------------------------
// In-memory public-shape schema fixtures. These mirror the pinned 0.154.0
// schemas closely enough to satisfy the real gates without reading any cache.
// ---------------------------------------------------------------------------
const json = (value: unknown): string => JSON.stringify(value);

const THREAD_START_PARAMS = {
  properties: {
    model: {}, modelProvider: {}, allowProviderModelFallback: {}, serviceTier: {}, cwd: {},
    approvalPolicy: {}, approvalsReviewer: {}, sandbox: {}, ephemeral: {},
    environments: { description: 'Empty disables environment access' },
    selectedCapabilityRoots: {}, dynamicTools: {}, experimentalRawEvents: {}, developerInstructions: {},
  },
};

const THREAD_START_RESPONSE = {
  definitions: { Thread: { properties: { environments: { description: 'An empty list means no environments are selected' } } } },
};

const THREAD_REALTIME_START_PARAMS = {
  properties: {
    threadId: {}, model: {}, outputModality: {}, transport: {}, version: {},
    includeStartupContext: {}, clientManagedHandoffs: {}, flushTranscriptTailOnSessionEnd: {}, prompt: {},
  },
  definitions: {
    RealtimeConversationVersion: { enum: ['v2', 'v3'] },
    RealtimeOutputModality: { enum: ['text', 'audio'] },
    ThreadRealtimeStartTransport: { oneOf: [{ properties: { type: { enum: ['websocket'] } } }] },
  },
};

const TURN_START_PARAMS = { properties: { threadId: {}, input: {}, effort: {}, serviceTier: {} } };

const RATE_LIMITS_RESPONSE = { properties: { ordinaryUsageAllowed: {}, rateLimitsByLimitId: {} } };

const LOGIN_COMPLETED_NOTIFICATION = {
  properties: { success: { type: 'boolean' }, loginId: { type: ['string', 'null'] } },
};

const ACCOUNT_UPDATED_NOTIFICATION = {
  properties: {
    authMode: { anyOf: [{ type: 'null' }, { $ref: '#/definitions/AuthMode' }] },
    planType: { anyOf: [{ type: 'null' }, { $ref: '#/definitions/PlanType' }] },
  },
};

const CLI_AUTH_CREDENTIALS_STORE_MODE = 'export type CliAuthCredentialsStoreMode = "ephemeral" | "file";\n';

const schemaJsonPath = (name: string): string => `${join(isolation.LOCAL, `schema-${isolation.VERSION}-json`, 'v2')}/${name}.json`;
const schemaTsPath = (name: string): string => `${join(isolation.LOCAL, `schema-${isolation.VERSION}-ts`, 'v2')}/${name}.ts`;

function installSchemaFixtures(): void {
  schemaState.fixtures = new Map<string, string>([
    [schemaJsonPath('ThreadStartParams'), json(THREAD_START_PARAMS)],
    [schemaJsonPath('ThreadStartResponse'), json(THREAD_START_RESPONSE)],
    [schemaJsonPath('ThreadRealtimeStartParams'), json(THREAD_REALTIME_START_PARAMS)],
    [schemaJsonPath('TurnStartParams'), json(TURN_START_PARAMS)],
    [schemaJsonPath('GetAccountRateLimitsResponse'), json(RATE_LIMITS_RESPONSE)],
    [schemaJsonPath('AccountLoginCompletedNotification'), json(LOGIN_COMPLETED_NOTIFICATION)],
    [schemaJsonPath('AccountUpdatedNotification'), json(ACCOUNT_UPDATED_NOTIFICATION)],
    [schemaTsPath('CliAuthCredentialsStoreMode'), CLI_AUTH_CREDENTIALS_STORE_MODE],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isolation.captureIsolated).mockReset();
  vi.mocked(isolation.captureIsolated).mockResolvedValue(`codex-cli ${isolation.VERSION}`);
  vi.mocked(isolation.spawnPersistent).mockReset();
  schemaState.prefixes = [
    `${join(isolation.LOCAL, `schema-${isolation.VERSION}-json`, 'v2')}/`,
    `${join(isolation.LOCAL, `schema-${isolation.VERSION}-ts`, 'v2')}/`,
  ];
  schemaState.served = [];
  schemaState.forbidden = [];
  schemaState.verifyProtocolCalls = 0;
  installSchemaFixtures();
});

// Shared cleanup used by the afterEach hook and by the cleanup-ownership
// regressions. Keeping the hook order single-sourced lets a test assert on the
// exact sequence the hook runs.
async function runCleanup(): Promise<void> {
  await closeBridges();
  await disposeOwned();
  // Fixtures are only removed once every registered owner is confirmed closed,
  // so a still-running owner keeps its evidence directory intact.
  if (owned.length > 0) {
    const labels = owned.map((entry) => entry.label).join(', ');
    throw new Error(`unsettled owned process(es) still registered; fixtures preserved for evidence: ${labels}`);
  }
  await deleteFixtures();
}

afterEach(async () => {
  await runCleanup();
});

// Minimal JSONL App Server stand-in used as a real flock child in kernel-level
// tests. It writes synthetic NONSECRET disk state and never sees real auth. It
// also self-exits after a bounded lifetime as an independent leak fallback.
const FAKE_CHILD_SOURCE = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "setTimeout(() => process.exit(0), 30_000).unref();",
  "const [mode, dataPath, markerPath, resultPath] = process.argv.slice(2);",
  "writeFileSync(markerPath, String(process.pid));",
  "if (mode === 'hold') writeFileSync(dataPath, 'NONSECRET');",
  "if (mode === 'read' || mode === 'peek') { let value = ''; try { value = readFileSync(dataPath, 'utf8'); } catch {} writeFileSync(resultPath, value); }",
  "if (mode === 'peek') process.exit(0);",
  "let buffer = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (chunk) => {",
  "  buffer += chunk;",
  "  let index;",
  "  while ((index = buffer.indexOf('\\n')) >= 0) {",
  "    const line = buffer.slice(0, index);",
  "    buffer = buffer.slice(index + 1);",
  "    let frame;",
  "    try { frame = JSON.parse(line); } catch { process.exit(3); }",
  "    if (frame.method === 'initialize') process.stdout.write(JSON.stringify({ id: frame.id, result: {} }) + '\\n');",
  "    else if (frame.method === 'config/read') {",
  "      if (mode === 'badjson') process.stdout.write('{not json}\\n');",
  "      else process.stdout.write(JSON.stringify({ id: frame.id, result: { config: {} } }) + '\\n');",
  "    }",
  "    else if (frame.id !== undefined) process.stdout.write(JSON.stringify({ id: frame.id, result: {} }) + '\\n');",
  "  }",
  "});",
  "process.stdin.on('end', () => process.exit(0));",
].join('\n');

type FlockFixture = { lock: string; data: string; marker: string; result: string; script: string };

async function flockFixture(): Promise<FlockFixture> {
  const directory = await temp('npc-flock-');
  const script = join(directory, 'fake-codex.mjs');
  await writeFile(script, FAKE_CHILD_SOURCE, { mode: 0o600 });
  return {
    lock: join(directory, 'codex.lock'), data: join(directory, 'state.txt'),
    marker: join(directory, 'marker.txt'), result: join(directory, 'result.txt'), script,
  };
}

function flockArgv(fixture: FlockFixture, mode: string): string[] {
  return ['-n', '-E', String(FLOCK_CONFLICT_CODE), fixture.lock, process.execPath, fixture.script, mode, fixture.data, fixture.marker, fixture.result];
}

function spawnFlock(fixture: FlockFixture, mode: string): OwnedProcess {
  return spawnOwned(FLOCK_BINARY, flockArgv(fixture, mode), `flock:${mode}`);
}

describe('persistent bridge lifecycle', () => {
  it('opens a persistent bridge and verifies only the expected effective config', async () => {
    const server = fakeServerChild({ config: PERSISTENT_CONFIG });
    const bridge = await CodexBridge.openPersistent(PERSISTENT_CONFIG, async () => server.child);
    opened.push(bridge);
    expect(server.frames.some((frame) => frame.method === 'initialize')).toBe(true);
    expect(server.frames.some((frame) => frame.method === 'config/read')).toBe(true);
  });

  it('maps a positively observed pre-initialization lock conflict exit to a fixed busy error', async () => {
    const server = fakeServerChild({ respond: false });
    const pending = CodexBridge.openPersistent({}, async () => server.child);
    setTimeout(() => server.close(100), 5);
    await expect(pending).rejects.toMatchObject({ code: 'profile_busy' });
    expect(server.child.stdin.writableEnded).toBe(true);
  });

  it('maps a pre-handshake exit 100 observed during cleanup to busy after a transport error', async () => {
    const child = transportErrorChild(FLOCK_CONFLICT_CODE);
    await expect(CodexBridge.openPersistent({}, async () => child)).rejects.toMatchObject({ code: 'profile_busy' });
  });

  it('does not map an unrelated pre-initialization exit status to busy', async () => {
    const server = fakeServerChild({ respond: false });
    const pending = CodexBridge.openPersistent({}, async () => server.child);
    setTimeout(() => server.close(7), 5);
    await expect(pending).rejects.toMatchObject({ code: 'transport_closed' });
  });

  it('does not confuse a post-handshake 100 exit with lock contention', async () => {
    const server = fakeServerChild({ config: {} });
    const bridge = await CodexBridge.openPersistent({}, async () => server.child);
    opened.push(bridge);
    server.close(100);
    await expect(bridge.rpc.request('account/logout', undefined)).rejects.toMatchObject({ code: 'transport_closed' });
  });

  it('rejects an unexpected effective config and tears down the owned child', async () => {
    const server = fakeServerChild({ config: { ...PERSISTENT_CONFIG, model_provider: 'other' } });
    await expect(CodexBridge.openPersistent(PERSISTENT_CONFIG, async () => server.child))
      .rejects.toMatchObject({ code: 'effective_config_mismatch' });
    expect(server.child.stdin.writableEnded).toBe(true);
  });

  it('sends account/logout with omitted params and no login or inference request', async () => {
    const server = fakeServerChild({ config: {}, logoutResult: {} });
    const bridge = await CodexBridge.openPersistent({}, async () => server.child);
    opened.push(bridge);
    await expect(bridge.logout()).resolves.toBeUndefined();
    const logout = server.frames.find((frame) => frame.method === 'account/logout');
    expect(logout).toBeDefined();
    expect(Object.hasOwn(logout!, 'params')).toBe(false);
    expect(JSON.stringify(logout)).toBe(`{"id":${logout!.id},"method":"account/logout"}`);
    const methods = server.frames.filter((frame) => typeof frame.method === 'string').map((frame) => frame.method);
    expect(methods).toEqual(['initialize', 'initialized', 'config/read', 'account/logout']);
  });

  it('accepts only an empty object logout result and rejects null or malformed responses', async () => {
    const accepted = fakeServerChild({ config: {}, logoutResult: {} });
    const acceptedBridge = await CodexBridge.openPersistent({}, async () => accepted.child);
    opened.push(acceptedBridge);
    await expect(acceptedBridge.logout()).resolves.toBeUndefined();

    for (const logoutResult of [null, 'unexpected', { success: false }]) {
      const server = fakeServerChild({ config: {}, logoutResult });
      const bridge = await CodexBridge.openPersistent({}, async () => server.child);
      opened.push(bridge);
      await expect(bridge.logout()).rejects.toMatchObject({ code: 'logout_failed' });
    }
  });
});

type Lifetime = {
  bridge: CodexBridge;
  calls: string[];
  setAccount: (value: unknown) => void;
  emit: (method: string, params: Record<string, unknown>) => void;
};
function lifetime(initial: unknown): Lifetime {
  const listeners = new Set<{ notice: (value: Notice) => void; fault: (error: BridgeError) => void }>();
  const calls: string[] = [];
  let cached = initial;
  const rpc = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'account/read') return cached;
      if (method === 'account/login/start') {
        return { type: 'chatgptDeviceCode', loginId: 'fixture', verificationUrl: 'https://auth.openai.com/fixture', userCode: 'ABCD-EFGH' };
      }
      return {};
    },
    subscribe: (notice: (value: Notice) => void, fault: (error: BridgeError) => void) => {
      const listener = { notice, fault };
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close: async () => {
      for (const listener of listeners) listener.fault(new BridgeError('transport_closed'));
      listeners.clear();
    },
  };
  return {
    bridge: new CodexBridge(rpc),
    calls,
    setAccount: (value: unknown) => { cached = value; },
    emit: (method, params) => { for (const listener of listeners) listener.notice({ method, params }); },
  };
}

describe('password reuse across bridge lifetimes', () => {
  it('completes the managed ceremony once and reuses the account on a later synthetic lifetime', async () => {
    const first = lifetime({ account: null });
    const ceremonies: string[] = [];
    const login = first.bridge.login((ceremony) => { ceremonies.push(ceremony.userCode); }, 200);
    await new Promise((resolve) => setImmediate(resolve));
    first.setAccount({ account: { type: 'chatgpt', planType: 'plus' } });
    first.emit('account/login/completed', { loginId: 'fixture', success: true });
    first.emit('account/updated', { authMode: null, planType: null });
    await expect(login).resolves.toEqual({ type: 'chatgpt', planType: 'plus' });
    expect(ceremonies).toEqual(['ABCD-EFGH']);
    await first.bridge.close();

    const second = lifetime({ account: { type: 'chatgpt', planType: 'plus' } });
    const secondCeremonies: string[] = [];
    await expect(second.bridge.login((ceremony) => { secondCeremonies.push(ceremony.userCode); }, 200))
      .resolves.toEqual({ type: 'chatgpt', planType: 'plus' });
    expect(secondCeremonies).toEqual([]);
    expect(second.calls).toEqual(['account/read']);
    await second.bridge.close();
  });
});

function cliRuntime(start: () => Promise<LogoutBridge>): { runtime: LogoutCliRuntime; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runtime: LogoutCliRuntime = {
    start,
    stdout: { write: (text) => { stdout.push(text); return true; } },
    stderr: { write: (text) => { stderr.push(text); return true; } },
    isStdinTTY: true,
    isStderrTTY: true,
    onSignal: () => {},
    offSignal: () => {},
  };
  return { runtime, stdout, stderr };
}

describe('logout response and wire regressions', () => {
  async function wire(options: Parameters<typeof fakeServerChild>[0]): Promise<CodexBridge> {
    const server = fakeServerChild(options);
    const bridge = await CodexBridge.openPersistent({}, async () => server.child);
    opened.push(bridge);
    return bridge;
  }

  it.each([
    ['a null result', { logoutResult: null }],
    ['a failure object', { logoutResult: { success: false } }],
    ['a payload object', { logoutResult: { error: 'NONSECRET' } }],
  ])('rejects %s as an unconfirmed logout', async (_name, options) => {
    await expect((await wire({ config: {}, ...options })).logout()).rejects.toMatchObject({ code: 'logout_failed' });
  });

  it('projects a JSON-RPC logout error to a fixed code without the wire payload', async () => {
    const bridge = await wire({ config: {}, logoutError: 'NONSECRET' });
    const error = await bridge.logout().then(() => undefined, (reason) => reason as BridgeError);
    expect(error?.code).toBe('provider_error');
    expect(String(error?.message)).not.toContain('NONSECRET');
  });

  it('never reports confirmed success for a fake-wire null, failure or error', async () => {
    const cases: Array<[Parameters<typeof fakeServerChild>[0], string]> = [
      [{ config: {}, logoutResult: null }, '{"error":"logout_failed"}\n'],
      [{ config: {}, logoutResult: { success: false } }, '{"error":"logout_failed"}\n'],
      [{ config: {}, logoutError: 'NONSECRET' }, '{"error":"logout_failed"}\n'],
    ];
    for (const [options, expected] of cases) {
      const server = fakeServerChild(options);
      const app = cliRuntime(async () => {
        const value = await CodexBridge.openPersistent({}, async () => server.child);
        opened.push(value);
        return { logout: () => value.logout(), close: () => value.close() };
      });
      expect(await runLogoutCli(['--confirm'], app.runtime)).toBe(1);
      expect(app.stdout).toEqual([]);
      expect(app.stderr).toEqual([expected]);
      expect(app.stderr.join('')).not.toContain('NONSECRET');
    }

    const server = fakeServerChild({ config: {}, logoutResult: {} });
    const app = cliRuntime(async () => {
      const value = await CodexBridge.openPersistent({}, async () => server.child);
      opened.push(value);
      return { logout: () => value.logout(), close: () => value.close() };
    });
    expect(await runLogoutCli(['--confirm'], app.runtime)).toBe(0);
    expect(app.stdout).toEqual(['{"loggedOut":true}\n']);
    expect(app.stderr).toEqual([]);
  });
});

describe('kernel flock profile locking', () => {
  const lockInode = async (fixture: FlockFixture): Promise<number> => (await stat(fixture.lock)).ino;

  it('rejects every repeated installed-flock conflict and reuses synthetic state', async () => {
    const fixture = await flockFixture();
    await rm(fixture.marker, { force: true });
    const owner = spawnFlock(fixture, 'hold');
    expect(Number(await waitForPath(fixture.marker))).toBeGreaterThan(0);
    const inode = await lockInode(fixture);

    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await exitCode(spawnFlock(fixture, 'hold'))).toBe(FLOCK_CONFLICT_CODE);
    }

    owner.child.stdin.end();
    expect(await exitCode(owner)).toBe(0);

    const reader = spawnFlock(fixture, 'peek');
    expect(await exitCode(reader)).toBe(0);
    expect(await readFile(fixture.result, 'utf8')).toBe('NONSECRET');
    expect(await lockInode(fixture)).toBe(inode);
  }, 15_000);

  it('reacquires the same lock inode after EOF, SIGTERM and SIGKILL owner exits', async () => {
    const fixture = await flockFixture();
    let inode = 0;
    for (const mode of ['eof', 'sigterm', 'sigkill'] as const) {
      await rm(fixture.marker, { force: true });
      const owner = spawnFlock(fixture, 'hold');
      await waitForPath(fixture.marker);
      inode ||= await lockInode(fixture);
      if (mode === 'eof') owner.child.stdin.end();
      else signalOwned(owner, mode === 'sigterm' ? 'SIGTERM' : 'SIGKILL');
      expect(await settleWithin(owner, KILL_GRACE_MS * 3)).toBe(true);

      const reader = spawnFlock(fixture, 'peek');
      expect(await exitCode(reader)).toBe(0);
      expect(await readFile(fixture.result, 'utf8')).toBe('NONSECRET');
      expect(await lockInode(fixture)).toBe(inode);
    }
  }, 20_000);

  it('maps every repeated real-flock conflict through the persistent bridge to busy', async () => {
    const fixture = await flockFixture();
    await rm(fixture.marker, { force: true });
    const owner = spawnFlock(fixture, 'hold');
    await waitForPath(fixture.marker);

    for (let attempt = 0; attempt < 4; attempt++) {
      const conflict = spawnFlock(fixture, 'hold');
      await expect(CodexBridge.openPersistent({}, async () => conflict.child))
        .rejects.toMatchObject({ code: 'profile_busy' });
    }

    owner.child.stdin.end();
    expect(await exitCode(owner)).toBe(0);
  }, 20_000);

  it('reuses synthetic disk state across two real flock bridge lifetimes', async () => {
    const fixture = await flockFixture();

    const first = spawnFlock(fixture, 'hold');
    const firstBridge = await CodexBridge.openPersistent({}, async () => first.child);
    opened.push(firstBridge);
    const inode = await lockInode(fixture);
    await firstBridge.close();

    const second = spawnFlock(fixture, 'read');
    const secondBridge = await CodexBridge.openPersistent({}, async () => second.child);
    opened.push(secondBridge);
    await secondBridge.close();

    expect(await readFile(fixture.data, 'utf8')).toBe('NONSECRET');
    expect(await readFile(fixture.result, 'utf8')).toBe('NONSECRET');
    expect(await lockInode(fixture)).toBe(inode);
  }, 20_000);

  it('releases the lock after a protocol failure and reacquires the same inode', async () => {
    const fixture = await flockFixture();
    const bad = spawnFlock(fixture, 'badjson');
    await expect(CodexBridge.openPersistent({}, async () => bad.child))
      .rejects.toMatchObject({ code: 'protocol_error' });
    expect(await settleWithin(bad, KILL_GRACE_MS * 3)).toBe(true);
    const inode = await lockInode(fixture);

    await rm(fixture.marker, { force: true });
    const owner = spawnFlock(fixture, 'hold');
    await waitForPath(fixture.marker);
    owner.child.stdin.end();
    expect(await exitCode(owner)).toBe(0);

    const reader = spawnFlock(fixture, 'peek');
    expect(await exitCode(reader)).toBe(0);
    expect(await readFile(fixture.result, 'utf8')).toBe('NONSECRET');
    expect(await lockInode(fixture)).toBe(inode);
  }, 20_000);

  it('terminates the owned owner after a caught failure and releases the lock before fixture removal', async () => {
    const fixture = await flockFixture();
    const owner = spawnFlock(fixture, 'hold');
    await waitForPath(fixture.marker);
    const inode = await lockInode(fixture);

    // Deliberately fail after the owner is ready. The same cleanup path the
    // afterEach net runs must terminate the owned group before deletion.
    const failure = await (async () => { throw new Error('injected post-readiness failure'); })().catch((error: Error) => error);
    expect(failure.message).toBe('injected post-readiness failure');

    await closeBridges();
    await disposeOwned();
    expect(owner.done).toBe(true);
    expect(await lockInode(fixture)).toBe(inode);

    const reader = spawnFlock(fixture, 'peek');
    expect(await exitCode(reader)).toBe(0);
    expect(await readFile(fixture.result, 'utf8')).toBe('NONSECRET');

    // Deletion only happens after the owned lock is demonstrably released.
    await deleteFixtures();
    expect(owner.done).toBe(true);
  }, 15_000);

  it('settles a failed spawn without leaking a process', async () => {
    const directory = await temp('npc-missing-');
    const entry = spawnOwned(join(directory, 'definitely-not-a-binary'), [], 'missing-binary');
    expect(await settleWithin(entry, KILL_GRACE_MS)).toBe(true);
    expect(entry.spawnError).toBeInstanceOf(Error);
    expect(entry.done).toBe(true);
    await terminateOwned(entry);
  });

  it('bounds event-based readiness for a path that never appears', async () => {
    const directory = await temp('npc-readiness-');
    await expect(waitForPath(join(directory, 'never.txt'), 250)).rejects.toThrow(/timed out waiting for/);
  });

  it('bounds settlement for a long-lived child and terminates it', async () => {
    const entry = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 'idle-child');
    expect(await settleWithin(entry, 200)).toBe(false);
    await terminateOwned(entry);
    expect(entry.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cleanup-ownership regressions.
//
// These synthetic children never spawn a real process. `process.kill` is
// mocked and timers are faked so the kernel grace periods advance instantly and
// no synthetic PID can reach the OS. They pin three failure modes the owned
// registry must survive:
//   1. an `error` event without a matching `close` must not settle the owner;
//   2. fixtures must not be deleted while an owner is still unsettled;
//   3. one failing termination must not skip the remaining owned owners, and
//      unfinished owners must stay registered.
// ---------------------------------------------------------------------------
describe('cleanup ownership regressions', () => {
  const registerSynthetic = (pid: number): { entry: OwnedProcess; synthetic: SyntheticChild } => {
    const synthetic = syntheticChild(pid);
    return { entry: ownProcess(synthetic.child, `synthetic:${pid}`), synthetic };
  };

  it('does not settle an owned entry on an error without a close', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.useFakeTimers();
    const { entry, synthetic } = registerSynthetic(910001);
    try {
      synthetic.emitError(new Error('injected spawn failure'));
      expect(entry.spawnError?.message).toBe('injected spawn failure');
      expect(entry.done).toBe(false);

      const termination = terminateOwned(entry).then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 10);
      expect(await termination).toBeInstanceOf(Error);

      expect(synthetic.child.stdin.destroyed).toBe(true);
      expect(entry.done).toBe(false);
      const signals = killSpy.mock.calls.map(([, signal]) => signal);
      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
      expect(owned).toContain(entry);
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
      synthetic.emitClose(0);
      await entry.settled;
    }
  });

  it('leaves fixtures in place when an owner is still unsettled', async () => {
    const directory = await temp('npc-owned-fixture-');
    const sentinel = join(directory, 'evidence.txt');
    await writeFile(sentinel, 'NONSECRET');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.useFakeTimers();
    const { entry, synthetic } = registerSynthetic(910002);
    try {
      const cleanup = runCleanup().then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 10);
      const cleanupError = await cleanup;
      expect(cleanupError).toBeInstanceOf(Error);
      expect((cleanupError as Error).message).toMatch(/owned process/);

      expect(await readFile(sentinel, 'utf8')).toBe('NONSECRET');
      expect(owned).toContain(entry);
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
      synthetic.emitClose(0);
      await entry.settled;
    }
  });

  it('attempts every owned owner when one termination fails and keeps the unfinished ones', async () => {
    const first = syntheticChild(910002);
    const second = syntheticChild(910003);
    const firstEntry = ownProcess(first.child, 'synthetic:first');
    const secondEntry = ownProcess(second.child, 'synthetic:second');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === -first.pid) {
        const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return true;
    });
    vi.useFakeTimers();
    try {
      const cleanup = disposeOwned().then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 10);
      expect(await cleanup).toBeInstanceOf(Error);

      expect(firstEntry.done).toBe(false);
      expect(secondEntry.done).toBe(false);
      expect(owned).toContain(firstEntry);
      expect(owned).toContain(secondEntry);
      expect(killSpy.mock.calls.some(([pid]) => pid === -second.pid)).toBe(true);
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
      first.emitClose(1);
      second.emitClose(0);
      await Promise.all([firstEntry.settled, secondEntry.settled]);
    }
  });
});

describe('production persistent startup', () => {
  // Explicit XDG_STATE_HOME isolation for the composed startup: an empty value
  // forces the home-based layout regardless of the inherited environment.
  const persistentOptions = (accountHome: string) => {
    const options = { accountHome, xdgStateHome: '', repoRoot: '/nonexistent-repo' };
    expect(resolveProfile(options).home).toBe(join(accountHome, '.local', 'state', 'npc-chat', 'codex-home'));
    return options;
  };

  it('isolates the composed startup from an inherited external XDG_STATE_HOME', async () => {
    const accountHome = await temp('npc-home-');
    const external = await temp('npc-inherited-xdg-');
    await writeFile(join(external, 'sentinel.txt'), 'NONSECRET', { mode: 0o600 });
    const inventory = await readdir(external);
    const sentinelMode = (await stat(join(external, 'sentinel.txt'))).mode & 0o777;
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = external;
    try {
      const server = fakeServerChild({ config: PERSISTENT_CONFIG });
      const spawnMock = vi.mocked(isolation.spawnPersistent).mockImplementation(async () => server.child);
      const bridge = await CodexBridge.startPersistent(persistentOptions(accountHome));
      opened.push(bridge);
      const [profile] = spawnMock.mock.calls[0];
      expect(profile.home).toBe(join(accountHome, '.local', 'state', 'npc-chat', 'codex-home'));
      expect(profile.lock).toBe(join(accountHome, '.local', 'state', 'npc-chat', 'codex.lock'));
      expect(await readdir(external)).toEqual(inventory);
      expect((await stat(join(external, 'sentinel.txt'))).mode & 0o777).toBe(sentinelMode);
      expect(await readFile(join(external, 'sentinel.txt'), 'utf8')).toBe('NONSECRET');
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it('runs the real runtime gates against in-memory fixtures and never reads the local caches', async () => {
    const accountHome = await temp('npc-home-');
    const server = fakeServerChild({ config: PERSISTENT_CONFIG });
    const spawnMock = vi.mocked(isolation.spawnPersistent).mockImplementation(async () => server.child);
    const outcome = await CodexBridge.startPersistent(persistentOptions(accountHome))
      .then((bridge) => { opened.push(bridge); return 'opened' as const; },
        (error: unknown) => (error instanceof Error ? error.message : String(error)));

    expect(schemaState.forbidden).toEqual([]);
    expect(outcome).toBe('opened');
    expect(schemaState.verifyProtocolCalls).toBe(1);
    expect(schemaState.served).toEqual(expect.arrayContaining([
      schemaJsonPath('ThreadStartParams'), schemaJsonPath('ThreadStartResponse'),
      schemaJsonPath('ThreadRealtimeStartParams'), schemaJsonPath('TurnStartParams'),
      schemaJsonPath('GetAccountRateLimitsResponse'),
      schemaJsonPath('AccountLoginCompletedNotification'), schemaJsonPath('AccountUpdatedNotification'),
      schemaTsPath('CliAuthCredentialsStoreMode'),
    ]));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [profile, command, options] = spawnMock.mock.calls[0];
    expect(profile.home).toBe(join(accountHome, '.local', 'state', 'npc-chat', 'codex-home'));
    expect((await stat(profile.lock)).mode & 0o777).toBe(0o600);
    expect(options).toEqual({ network: true });
    expect(command).toContain('cli_auth_credentials_store="file"');
    expect(server.frames.some((frame) => frame.method === 'initialize')).toBe(true);
  });

  it('prepares a private temp profile with owner-only directories', async () => {
    const accountHome = await temp('npc-home-');
    const server = fakeServerChild({ config: PERSISTENT_CONFIG });
    const spawnMock = vi.mocked(isolation.spawnPersistent).mockImplementation(async () => server.child);
    const bridge = await CodexBridge.startPersistent(persistentOptions(accountHome));
    opened.push(bridge);
    const [profile] = spawnMock.mock.calls[0];
    const base = join(accountHome, '.local', 'state', 'npc-chat');
    expect(profile.home).toBe(join(base, 'codex-home'));
    expect((await stat(profile.home)).mode & 0o777).toBe(0o700);
    expect((await stat(base)).mode & 0o777).toBe(0o700);
  });

  it('rejects a version-mismatched runtime before spawning the persistent server', async () => {
    const accountHome = await temp('npc-home-');
    vi.mocked(isolation.captureIsolated).mockResolvedValueOnce('codex-cli 0.0.0');
    const spawnMock = vi.mocked(isolation.spawnPersistent);
    await expect(CodexBridge.startPersistent(persistentOptions(accountHome)))
      .rejects.toMatchObject({ code: 'version_mismatch' });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(schemaState.forbidden).toEqual([]);
    expect(schemaState.verifyProtocolCalls).toBe(1);
  });

  it('rejects early when a required protocol schema fixture is absent, without reading the cache', async () => {
    const accountHome = await temp('npc-home-');
    schemaState.fixtures.delete(schemaJsonPath('ThreadStartParams'));
    const spawnMock = vi.mocked(isolation.spawnPersistent);
    await expect(CodexBridge.startPersistent(persistentOptions(accountHome)))
      .rejects.toMatchObject({ code: 'pinned_schema_missing_or_incompatible' });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(schemaState.verifyProtocolCalls).toBe(1);
    expect(schemaState.forbidden).toContain(schemaJsonPath('ThreadStartParams'));
  });

  it('rejects early when a readiness schema fixture is absent, without reading the cache', async () => {
    const accountHome = await temp('npc-home-');
    schemaState.fixtures.delete(schemaJsonPath('AccountUpdatedNotification'));
    const spawnMock = vi.mocked(isolation.spawnPersistent);
    await expect(CodexBridge.startPersistent(persistentOptions(accountHome)))
      .rejects.toMatchObject({ code: 'pinned_schema_missing_or_incompatible' });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(schemaState.forbidden).toContain(schemaJsonPath('AccountUpdatedNotification'));
  });
});
