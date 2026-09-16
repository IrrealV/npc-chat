import { readFile } from 'node:fs/promises';
import { LOCAL, VERSION } from './isolation.js';
import { BridgeError } from './rpc.js';
import { threadParams } from './policy.js';

export async function verifyProtocol(): Promise<void> {
  try {
    const schema = async (name: string) => JSON.parse(await readFile(`${LOCAL}/schema-${VERSION}-json/v2/${name}.json`, 'utf8'));
    const thread = await schema('ThreadStartParams');
    for (const key of Object.keys(threadParams('gpt-5.6-luna'))) {
      if (!(key in thread.properties)) throw new Error();
    }
    if (!thread.properties.environments.description.includes('Empty disables environment access')) throw new Error();
    const threadResponse = await schema('ThreadStartResponse');
    if (!threadResponse.definitions.Thread.properties.environments.description.includes('An empty list means no environments are selected')) throw new Error();
    const live = await schema('ThreadRealtimeStartParams');
    for (const key of ['threadId', 'model', 'outputModality', 'transport', 'version', 'includeStartupContext', 'clientManagedHandoffs', 'flushTranscriptTailOnSessionEnd', 'prompt']) {
      if (!(key in live.properties)) throw new Error();
    }
    for (const value of ['v2', 'v3']) if (!live.definitions.RealtimeConversationVersion.enum.includes(value)) throw new Error();
    for (const value of ['text', 'audio']) if (!live.definitions.RealtimeOutputModality.enum.includes(value)) throw new Error();
    if (!live.definitions.ThreadRealtimeStartTransport.oneOf.some((variant: any) => variant.properties.type.enum.includes('websocket'))) throw new Error();
    const turn = await schema('TurnStartParams');
    for (const key of ['threadId', 'input', 'effort', 'serviceTier']) if (!(key in turn.properties)) throw new Error();
    const rates = await schema('GetAccountRateLimitsResponse');
    if (!rates.properties.ordinaryUsageAllowed || !rates.properties.rateLimitsByLimitId) throw new Error();
    const authMode = await readFile(`${LOCAL}/schema-${VERSION}-ts/v2/CliAuthCredentialsStoreMode.ts`, 'utf8');
    if (!authMode.includes('"ephemeral"')) throw new Error();
  } catch { throw new BridgeError('pinned_schema_missing_or_incompatible'); }
}
