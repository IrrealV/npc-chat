import { CodexBridge } from '../src/codex/bridge.js';
import { runLogoutCli, type LogoutCliRuntime } from '../src/npc/logout-cli.js';

const runtime: LogoutCliRuntime = {
  start: () => CodexBridge.startPersistent(),
  stdout: process.stdout,
  stderr: process.stderr,
  isStdinTTY: process.stdin.isTTY === true,
  isStderrTTY: process.stderr.isTTY === true,
  onSignal: (listener) => {
    process.on('SIGINT', listener);
    process.on('SIGTERM', listener);
  },
  offSignal: (listener) => {
    process.off('SIGINT', listener);
    process.off('SIGTERM', listener);
  },
};

try {
  process.exitCode = await runLogoutCli(process.argv.slice(2), runtime);
} catch {
  process.stderr.write('{"error":"runtime_setup_failed"}\n');
  process.exitCode = 1;
}
