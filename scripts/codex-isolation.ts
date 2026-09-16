import { captureIsolated, VERSION } from '../src/codex/isolation.js';
import { CodexBridge } from '../src/codex/bridge.js';
import { BridgeError } from '../src/codex/rpc.js';

let bridge: CodexBridge | undefined;
try {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const hidden = [process.cwd(), process.env.HOME].filter((path): path is string => !!path && path !== '/home/probe');
  const check = [
    'set -eu', '[ "$HOME" = /home/probe ]', '[ "$CODEX_HOME" = /home/probe/.codex ]',
    '[ "$PWD" = /work ]', '[ -z "${OPENAI_API_KEY+x}" ]', '[ -z "${NODE_OPTIONS+x}" ]',
    '[ -z "${DBUS_SESSION_BUS_ADDRESS+x}" ]', '[ -z "${HTTPS_PROXY+x}" ]',
    '[ ! -e /home/probe/.codex/auth.json ]', '[ ! -e /root ]',
    '[ -x /bin/bwrap ]', '/bin/bwrap --version > /dev/null',
    ...hidden.map((path) => `[ ! -e ${quote(path)} ]`),
    'printf isolation-ok',
  ].join('; ');
  if (await captureIsolated([], { check }) !== 'isolation-ok') throw new Error();
  const version = (await captureIsolated(['--version'])).trim();
  if (version !== `codex-cli ${VERSION}`) throw new Error();
  bridge = await CodexBridge.start(); // Real initialize/initialized and strict effective CONFIG validation; no login.
  await bridge.close();
  bridge = undefined;
  console.log(JSON.stringify({ isolation: 'passed', version, bridgeStart: 'passed',
    effectiveConfig: 'validated', child: 'closed', auth: 'not_started' }));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof BridgeError ? error.code : 'isolation_check_failed', fallback: 'forbidden' }));
  process.exitCode = 1;
} finally {
  await bridge?.close();
}
