import { CodexBridge } from '../src/codex/bridge.js';
import { probeLive } from '../src/codex/live.js';
import { EVENT, PROMPT } from '../src/codex/policy.js';
import { BridgeError, projectBridgeError } from '../src/codex/rpc.js';
import { verifyProtocol } from '../src/codex/schema.js';

const command = process.argv[2] ?? 'smoke';
const abort = new AbortController();
let bridge: CodexBridge | undefined;
let phase = 'startup';
const stop = () => {
  abort.abort();
  if (phase !== 'text') void bridge?.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  if (!['login', 'probe', 'live', 'smoke'].includes(command)) throw new BridgeError('unknown_command');
  // A human-capable verifier must own the one-time managed ceremony. Never redirect it to a file.
  if (!process.stderr.isTTY) throw new BridgeError('interactive_auth_terminal_required');
  await verifyProtocol();
  const startup = performance.now();
  bridge = await CodexBridge.start();
  const startupMs = performance.now() - startup;
  if (abort.signal.aborted) throw new BridgeError('aborted');
  phase = 'auth';
  const authStart = performance.now();
  const account = await bridge.login((ceremony) => {
    process.stderr.write(`Open ${ceremony.verificationUrl} in your browser and enter ${ceremony.userCode}.\n`);
  });
  console.log(JSON.stringify({ phase: 'setup', account, authStorage: 'ephemeral', startupMs, authMs: performance.now() - authStart }));
  if (abort.signal.aborted) throw new BridgeError('aborted');
  if (command === 'probe' || command === 'smoke') {
    phase = 'text';
    const result = await bridge.text(PROMPT, { signal: abort.signal });
    console.log(JSON.stringify({ phase: 'text', event: EVENT, ...result }));
    if (result.status !== 'completed') throw new BridgeError('aborted');
  }
  if (abort.signal.aborted) throw new BridgeError('aborted');
  if (command === 'live' || command === 'smoke') {
    phase = 'live';
    console.log(JSON.stringify({ phase: 'live', ...await probeLive(bridge) }));
  }
} catch (error) {
  console.error(JSON.stringify({ phase, ...projectBridgeError(error) }));
  process.exitCode = 1;
} finally {
  await bridge?.close();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
