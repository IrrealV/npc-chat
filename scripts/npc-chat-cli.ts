import { CodexBridge } from '../src/codex/bridge.js';
import { runManualChatCli, type ChatCliRuntime } from '../src/npc/chat-cli.js';

const runtime: ChatCliRuntime = {
  start: () => CodexBridge.startPersistent(),
  stdout: process.stdout,
  stderr: process.stderr,
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
  process.exitCode = await runManualChatCli(process.argv.slice(2), runtime);
} catch {
  process.stderr.write('{"error":"runtime_setup_failed"}\n');
  process.exitCode = 1;
}
