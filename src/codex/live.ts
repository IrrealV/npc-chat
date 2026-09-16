import { observe, type CodexBridge } from './bridge.js';
import { LIVE_MODELS, PROMPT } from './policy.js';
import { BridgeError, safeCause, type Notice } from './rpc.js';

type Attempt = {
  requestedModel: string; resolvedModel: null; requestedVersion: 'v2' | 'v3'; resolvedVersion?: string;
  modality: 'text' | 'audio'; transport: 'websocket';
  phase: 'start_request' | 'waiting_started' | 'started' | 'waiting_text';
  outcome: 'not_available' | 'text_response' | 'audio_negotiated_only';
  cause?: string; response?: string; cleanup?: 'process_closed';
};

export async function probeLive(bridge: CodexBridge): Promise<{ attempts: Attempt[]; untested: string[] }> {
  const catalog = await bridge.catalog();
  // The first is source-advertised; the second is only attempted if also in the live catalog.
  const models: string[] = [LIVE_MODELS[0]];
  if (catalog.some((model) => model?.model === LIVE_MODELS[1] && model.hidden === false)) models.push(LIVE_MODELS[1]);
  const combinations = models.flatMap((model) => [
    { model, version: 'v3' as const, modality: 'text' as const },
    { model, version: 'v2' as const, modality: 'text' as const },
    { model, version: 'v3' as const, modality: 'audio' as const },
  ]);
  const attempts: Attempt[] = [];
  const untested = ['webrtc', 'existingCall', 'v1', 'audio input', 'audio output capture/playback', 'microphone'];
  for (const combination of combinations) {
    const { threadId } = await bridge.prepareThread();
    await bridge.checkUsage(combination.model);
    const attempt: Attempt = { requestedModel: combination.model, resolvedModel: null, requestedVersion: combination.version,
      modality: combination.modality, transport: 'websocket', phase: 'start_request', outcome: 'not_available' };
    const failure = ({ method, params }: Notice) => {
      if (params.threadId !== threadId) return;
      if (method === 'thread/realtime/error') throw new BridgeError(safeCause(params.message));
      if (method === 'thread/realtime/closed') throw new BridgeError('live_closed_without_output');
    };
    const started = observe(bridge.rpc, (notice) => {
      failure(notice);
      if (notice.params.threadId === threadId && notice.method === 'thread/realtime/started') return notice.params;
    }, bridge.turnTimeoutMs, 'live_start_timeout');
    let acceptingText = false;
    const text = observe(bridge.rpc, (notice) => {
      failure(notice);
      if (!acceptingText || notice.params.threadId !== threadId) return;
      let value: unknown;
      if (notice.method === 'thread/realtime/transcript/done' && notice.params.role === 'assistant') value = notice.params.text;
      if (notice.method === 'thread/realtime/item/completed' && notice.params.item?.type === 'transcriptSegment'
        && notice.params.item.role === 'assistant') value = notice.params.item.text;
      if (typeof value === 'string' && value.trim()) {
        if (value.length > 64_000) throw new BridgeError('response_limit');
        return value;
      }
    }, bridge.turnTimeoutMs, 'live_text_timeout');
    let acknowledged = false;
    try {
      await bridge.rpc.request('thread/realtime/start', {
        threadId, model: combination.model, version: combination.version, outputModality: combination.modality,
        transport: { type: 'websocket' }, includeStartupContext: false, clientManagedHandoffs: true,
        flushTranscriptTailOnSessionEnd: false, prompt: 'Reply briefly in Spanish. Never delegate or use tools.',
      });
      acknowledged = true;
      attempt.phase = 'waiting_started';
      const accepted = await started.promise;
      if (accepted.version !== combination.version) throw new BridgeError('live_version_mismatch');
      attempt.resolvedVersion = accepted.version;
      attempt.phase = 'started';
      if (combination.modality === 'text') {
        await bridge.checkUsage(combination.model);
        attempt.phase = 'waiting_text';
        acceptingText = true; // Accept early append responses, never startup greetings.
        await bridge.rpc.request('thread/realtime/appendText', { threadId, text: PROMPT, role: 'user' });
        attempt.response = await text.promise;
        attempt.outcome = 'text_response';
      } else {
        // Startup negotiation only: no audio supplied, captured, persisted, or played.
        attempt.outcome = 'audio_negotiated_only';
      }
    } catch (error) {
      if (!(error instanceof BridgeError) || ![
        'text_requires_realtime_v2', 'realtime_websocket_requires_api_key', 'provider_error',
        'live_start_timeout', 'live_text_timeout', 'live_closed_without_output', 'live_version_mismatch',
      ].includes(error.code)) throw error;
      attempt.cause = error.code;
    } finally {
      started.dispose();
      text.dispose();
      if (acknowledged) {
        await bridge.rpc.request('thread/realtime/stop', { threadId }).catch(async () => {
          attempt.cleanup = 'process_closed';
          await bridge.close();
        });
      }
    }
    attempts.push(attempt);
    // Only a known modality rejection permits the next distinct compatibility attempt.
    if (attempt.cleanup || (attempt.cause && attempt.cause !== 'text_requires_realtime_v2')) break;
  }
  for (const remaining of combinations.slice(attempts.length)) {
    untested.push(`${remaining.model}/${remaining.version}/${remaining.modality}`);
    if (remaining.modality === 'audio') untested.push('v3/audio');
  }
  if (!models.includes(LIVE_MODELS[1])) untested.push(`${LIVE_MODELS[1]}: not advertised by catalog`);
  return { attempts, untested: [...new Set(untested)] };
}
