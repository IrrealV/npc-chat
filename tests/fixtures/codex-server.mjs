import { createInterface } from 'node:readline';
const mode = process.argv[2];
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, params) => send({ method, params });
if (mode === 'stubborn') process.on('SIGTERM', () => {});
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (!request.method) return;
  const { id, method, params } = request;
  if (method === 'initialize') return send({ id, result: {} });
  if (method === 'initialized') return;
  if (method === 'echo') return send({ id, result: params });
  if (method === 'crash') return process.exit(7);
  if (method === 'hang') return;
  if (method === 'malformed') return process.stdout.write('{broken}\n');
  if (method === 'error') return send({ id, error: { code: -1, message: 'SECRET raw provider detail' } });
  if (method === 'block') return send({ id: 'server-request-42', method: params.method, params: { secret: 'not for logs' } });
  if (method === 'fragment') {
    const bytes = Buffer.from(JSON.stringify({ id, result: 'caída 🙃' }) + '\n');
    for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
    return;
  }
  if (method === 'fault-during-drain') {
    process.stdout.write([
      { id, result: {} },
      { method: 'mcpServer/startupStatus/updated', params: { status: 'starting' } },
    ].map((frame) => JSON.stringify(frame) + '\n').join(''));
    return;
  }
  if (method === 'turn/start') {
    if (['completion-fault-burst', 'drain-fault'].includes(mode)) {
      const frames = [
        { id, result: { turn: { id: 'turn' } } },
        { method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', delta: 'Qué caída.' } },
        { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } },
      ];
      if (mode === 'completion-fault-burst') frames.push({ method: 'mcpServer/startupStatus/updated', params: { status: 'starting' } });
      process.stdout.write(frames.map((frame) => JSON.stringify(frame) + '\n').join(''));
      return;
    }
    event('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta: 'Qué ' });
    if (mode === 'slow-start') {
      setTimeout(() => send({ id, result: { turn: { id: 'turn' } } }), 30);
      return;
    }
    send({ id, result: { turn: { id: 'turn' } } });
    if (!['wait', 'no-interrupt-completion'].includes(mode)) {
      event('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta: 'caída.' });
      event('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: mode === 'failed' ? 'failed' : 'completed', error: 'untrusted detail' } });
    }
    return;
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} });
    if (mode !== 'no-interrupt-completion') event('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'interrupted' } });
  }
});
if (mode === 'stubborn') setInterval(() => {}, 1000);
