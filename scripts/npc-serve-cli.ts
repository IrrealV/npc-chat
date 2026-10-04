import { CodexBridge } from '../src/codex/bridge.js';
import { createPresentationServer } from '../src/npc/presentation-server.js';
import { runServeCli, type ServeCliRuntime } from '../src/npc/serve-cli.js';
import { createSessionInput } from '../src/npc/session-cli.js';

const runtime: ServeCliRuntime = {
  start: () => CodexBridge.startPersistent(),
  stdout: process.stdout,
  stderr: process.stderr,
  isStdinTTY: process.stdin.isTTY === true,
  isStderrTTY: process.stderr.isTTY === true,
  createInput: (onInterrupt, onError) =>
    createSessionInput(process.stdin, process.stderr, onInterrupt, onError),
  onSignal: (listener) => {
    process.on('SIGINT', listener);
    process.on('SIGTERM', listener);
  },
  offSignal: (listener) => {
    process.off('SIGINT', listener);
    process.off('SIGTERM', listener);
  },
  createPresentationServer: (publisher, port) => createPresentationServer({ publisher, port }),
};

try {
  process.exitCode = await runServeCli(process.argv.slice(2), runtime);
} catch {
  process.stderr.write('{"error":"runtime_setup_failed"}\n');
  process.exitCode = 1;
}
