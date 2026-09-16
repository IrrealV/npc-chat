import { captureIsolated, LOCAL, VERSION } from '../src/codex/isolation.js';
import { verifyProtocol } from '../src/codex/schema.js';

try {
  const version = (await captureIsolated(['--version'])).trim();
  if (version !== `codex-cli ${VERSION}`) throw new Error();
  for (const [generator, format] of [['generate-ts', 'ts'], ['generate-json-schema', 'json']]) {
    await captureIsolated(['app-server', generator, '--experimental', '--out', '/output'], {
      output: `${LOCAL}/schema-${VERSION}-${format}`,
    });
  }
  await verifyProtocol();
  console.log(JSON.stringify({ version, experimentalSchema: 'generated_and_checked', authStore: 'ephemeral_supported', authenticated: false }));
} catch {
  console.error(JSON.stringify({ error: 'isolated_protocol_generation_failed' }));
  process.exitCode = 1;
}
