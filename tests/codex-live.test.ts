import { describe, expect, it } from 'vitest';
import { CodexBridge } from '../src/codex/bridge.js';
import { probeLive } from '../src/codex/live.js';
import { BridgeError, type Notice } from '../src/codex/rpc.js';

function fixture(mode: 'rejections' | 'empty' | 'text' | 'greeting-only' | 'early-error', format: 'transcript' | 'item' = 'transcript') {
  const notices = new Set<(value: Notice) => void>();
  const attempts: any[] = [];
  const methods: string[] = [];
  const transcript = (text: string) => {
    for (const notice of notices) notice(format === 'transcript'
      ? { method: 'thread/realtime/transcript/done', params: { threadId: 'thread', role: 'assistant', text } }
      : { method: 'thread/realtime/item/completed', params: { threadId: 'thread', item: { type: 'transcriptSegment', role: 'assistant', text } } });
  };
  const rpc = {
    request: async (method: string, params: any) => {
      methods.push(method);
      if (method === 'thread/realtime/start') {
        attempts.push(params);
        if (mode === 'rejections') throw new BridgeError(params.version === 'v3'
          ? 'text_requires_realtime_v2' : 'realtime_websocket_requires_api_key');
        if (mode === 'text' || mode === 'greeting-only') for (const notice of notices) notice({ method: 'thread/realtime/started', params: { threadId: 'thread', version: params.version } });
        if (mode === 'text' || mode === 'greeting-only') transcript('Synthetic pre-prompt greeting');
        if (mode === 'early-error') for (const notice of notices) notice({ method: 'thread/realtime/error',
          params: { threadId: 'thread', message: 'realtime conversation requires API key auth' } });
      }
      // Emit synchronously inside append, before its acknowledgement resolves.
      if (method === 'thread/realtime/appendText' && mode === 'text') transcript('Vaya caída.');
      return {};
    },
    subscribe: (notice: (value: Notice) => void) => { notices.add(notice); return () => { notices.delete(notice); }; },
    close: async () => {},
  };
  const bridge = new CodexBridge(rpc, 20);
  bridge.prepareThread = async () => ({ threadId: 'thread', model: 'gpt-5.6-luna' });
  bridge.checkUsage = async () => {
    methods.push('usage-check');
    if (mode === 'text' || mode === 'greeting-only') transcript('Synthetic greeting during usage check');
  };
  bridge.catalog = async () => [];
  return { bridge, attempts, methods, notices };
}
describe('bounded experimental WebSocket Live probe (mocked)', () => {
  it('preserves known modality/auth causes and stops at API-auth requirement', async () => {
    const { bridge, attempts } = fixture('rejections');
    const result = await probeLive(bridge);
    expect(attempts.map((attempt) => [attempt.version, attempt.outputModality])).toEqual([['v3', 'text'], ['v2', 'text']]);
    expect(result.attempts.map((attempt: any) => attempt.cause)).toEqual(['text_requires_realtime_v2', 'realtime_websocket_requires_api_key']);
    expect(result.untested).toContain('webrtc');
    expect(result.untested).toContain('v3/audio');
    expect(attempts.every((attempt) => attempt.transport.type === 'websocket' && attempt.includeStartupContext === false)).toBe(true);
  });
  it('does not mistake an empty acknowledgement for a started session', async () => {
    const { bridge } = fixture('empty');
    const result = await probeLive(bridge);
    expect(result.attempts[0]).toMatchObject({ outcome: 'not_available', cause: 'live_start_timeout' });
  });
  it.each(['transcript', 'item'] as const)('rejects pre-prompt %s greetings when no text follows appendText', async (format) => {
    const { bridge, methods, notices } = fixture('greeting-only', format);
    const result = await probeLive(bridge);
    expect(result.attempts[0]).toMatchObject({ outcome: 'not_available', cause: 'live_text_timeout' });
    expect(result.attempts[0]).not.toHaveProperty('response');
    expect(result.attempts).toHaveLength(1);
    expect(methods.filter((method) => method === 'thread/realtime/appendText')).toHaveLength(1);
    expect(methods).toContain('thread/realtime/stop');
    expect(notices.size).toBe(0);
  });
  it.each(['transcript', 'item'] as const)('accepts post-append, pre-acknowledgement %s output, not greetings', async (format) => {
    const { bridge, methods } = fixture('text', format);
    const result = await probeLive(bridge);
    expect(result.attempts[0]).toMatchObject({ outcome: 'text_response', response: 'Vaya caída.', resolvedVersion: 'v3' });
    expect(methods[methods.indexOf('thread/realtime/appendText') - 1]).toBe('usage-check');
    expect(methods).toContain('thread/realtime/stop');
  });
  it('preserves early realtime errors and stops without appending', async () => {
    const { bridge, methods, notices } = fixture('early-error');
    const result = await probeLive(bridge);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ outcome: 'not_available', phase: 'waiting_started',
      cause: 'realtime_websocket_requires_api_key' });
    expect(methods).not.toContain('thread/realtime/appendText');
    expect(methods).toContain('thread/realtime/stop');
    expect(notices.size).toBe(0);
  });
});
