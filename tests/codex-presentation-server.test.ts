import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { TextResult } from '../src/codex/bridge.js';
import { generateManualChatBatch, type ManualChatMessage } from '../src/npc/chat.js';
import { PresentationPublisher } from '../src/npc/publisher.js';
import { createPresentationServer } from '../src/npc/presentation-server.js';

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: string };

function request(port: number, path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

type SseStream = { response: IncomingMessage; chunks: string[]; state: { ended: boolean } };

function openSse(port: number): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/events' });
    request.once('response', (response) => {
      const chunks: string[] = [];
      const state = { ended: false };
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => chunks.push(chunk));
      response.on('end', () => { state.ended = true; });
      resolve({ response, chunks, state });
    });
    request.once('error', reject);
    request.end();
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition_not_observed');
}

function snapshotCount(stream: SseStream): number {
  return stream.chunks.join('').split('\n\n')
    .filter((frame) => frame.startsWith('event: snapshot\n')).length;
}

async function validatedLargeBatch(): Promise<ManualChatMessage[]> {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    username: String(index) + String.fromCharCode(0).repeat(31),
    message: String.fromCharCode(0).repeat(200),
  }));
  const result: TextResult = {
    response: JSON.stringify(messages), status: 'completed', model: 'fixture',
    requestedModel: 'fixture', resolvedModel: 'fixture', codexVersion: 'fixture',
    serviceTier: 'default', effort: 'low', firstDeltaMs: 1, totalMs: 2,
  };
  return (await generateManualChatBatch({ text: async () => result }, 'fixture', { count: 10 })).messages;
}

describe('loopback presentation HTTP server', () => {
  it('serves only exact GET assets with strict browser security headers', async () => {
    const publisher = new PresentationPublisher();
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    try {
      for (const [path, type] of [
        ['/', 'text/html'], ['/overlay', 'text/html'],
        ['/presentation.js', 'text/javascript'], ['/presentation.css', 'text/css'],
      ]) {
        const response = await request(port, path!);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain(type);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
        expect(response.headers['content-security-policy']).toContain("default-src 'none'");
        expect(response.headers['content-security-policy']).not.toContain("'unsafe-inline'");
      }
      expect((await request(port, '/missing')).status).toBe(404);
      expect((await request(port, '/', { method: 'POST' })).status).toBe(405);
      expect((await request(port, '/', { headers: { 'Content-Length': '1' } })).status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it.each([
    [{ Host: 'localhost:1' }, 403],
    [{ Origin: 'null' }, 403],
    [{ Origin: 'http://example.test' }, 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
  ])('rejects hostile request headers %j', async (headers, status) => {
    const server = createPresentationServer({ publisher: new PresentationPublisher(), port: 0 });
    const port = await server.start();
    try {
      expect((await request(port, '/', { headers })).status).toBe(status);
    } finally {
      await server.close();
    }
  });

  it('allows an omitted Origin and sends complete snapshots on connect and publication', async () => {
    const publisher = new PresentationPublisher();
    publisher.publish([{ username: 'Ana', message: 'Antes' }]);
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    const stream = await openSse(port);
    try {
      await waitFor(() => stream.chunks.join('').includes('Antes'));
      publisher.publish([{ username: 'Beto', message: 'Después' }]);
      await waitFor(() => stream.chunks.join('').includes('Después'));
      const payload = stream.chunks.join('');
      const frames = payload.split('\n\n').filter((frame) => frame.startsWith('event: snapshot'));
      const latest = JSON.parse(frames.at(-1)!.slice('event: snapshot\ndata: '.length));
      expect(payload).toContain('event: snapshot');
      expect(typeof latest.stream).toBe('string');
      expect(latest.stream.length).toBeGreaterThan(0);
      expect(latest.messages.map((message: { id: string; username: string; message: string }) => (
        { id: message.id, username: message.username, message: message.message }
      ))).toStrictEqual([
        { id: '1', username: 'Ana', message: 'Antes' },
        { id: '2', username: 'Beto', message: 'Después' },
      ]);
      expect(payload).not.toContain('model');
      expect(payload).not.toContain('event input');
    } finally {
      stream.response.destroy();
      await server.close();
    }
  });

  it('caps concurrent streams at eight and permits reconnect after disconnect', async () => {
    const server = createPresentationServer({ publisher: new PresentationPublisher(), port: 0 });
    const port = await server.start();
    const streams = await Promise.all(Array.from({ length: 8 }, () => openSse(port)));
    try {
      expect((await request(port, '/events')).status).toBe(503);
      streams[0]!.response.destroy();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const replacement = await openSse(port);
      expect(replacement.response.statusCode).toBe(200);
      replacement.response.destroy();
    } finally {
      for (const stream of streams) stream.response.destroy();
      await server.close();
    }
  });

  it('keeps a real consuming socket open through sustained large valid snapshots', async () => {
    const batch = await validatedLargeBatch();
    const publisher = new PresentationPublisher();
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    const stream = await openSse(port);
    try {
      for (let index = 0; index < 10; index += 1) {
        publisher.publish(batch);
        const expectedCount = index + 2;
        await waitFor(() => snapshotCount(stream) === expectedCount || stream.state.ended);
      }
      expect(snapshotCount(stream)).toBe(11);
      expect(stream.state.ended).toBe(false);
    } finally {
      stream.response.destroy();
      await server.close();
    }
  });

  it('keeps a full 100-message reconnect open for subsequent snapshots', async () => {
    const batch = await validatedLargeBatch();
    const publisher = new PresentationPublisher();
    for (let index = 0; index < 10; index += 1) publisher.publish(batch);
    const server = createPresentationServer({ publisher, port: 0 });
    const port = await server.start();
    const first = await openSse(port);
    try {
      await waitFor(() => snapshotCount(first) === 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(first.state.ended).toBe(false);
      first.response.destroy();

      const reconnect = await openSse(port);
      try {
        await waitFor(() => snapshotCount(reconnect) === 1);
        publisher.publish(batch);
        await waitFor(() => snapshotCount(reconnect) === 2 || reconnect.state.ended);
        expect(snapshotCount(reconnect)).toBe(2);
        expect(reconnect.state.ended).toBe(false);
      } finally {
        reconnect.response.destroy();
      }
    } finally {
      first.response.destroy();
      await server.close();
    }
  });

  it('coalesces one latest snapshot while blocked and resumes it on drain', async () => {
    const publisher = new PresentationPublisher();
    const payloads: string[] = [];
    let shouldBlock = false;
    let blockedResponse: import('node:http').ServerResponse | undefined;
    let scheduledStalls = 0;
    let canceledStalls = 0;
    const server = createPresentationServer({
      publisher,
      port: 0,
      writeEvent: (response, payload) => {
        payloads.push(payload);
        response.write(payload);
        if (!shouldBlock) return true;
        shouldBlock = false;
        blockedResponse = response;
        return false;
      },
      scheduleStall: () => {
        scheduledStalls += 1;
        return () => { canceledStalls += 1; };
      },
    });
    const port = await server.start();
    const stream = await openSse(port);
    try {
      shouldBlock = true;
      publisher.publish([{ username: 'Ana', message: 'blocked' }]);
      publisher.publish([{ username: 'Beto', message: 'obsolete' }]);
      publisher.publish([{ username: 'Cata', message: 'latest' }]);
      expect(payloads).toHaveLength(2);
      expect(scheduledStalls).toBe(1);
      blockedResponse?.emit('drain');
      await waitFor(() => payloads.length === 3);
      expect(payloads[2]).toContain('latest');
      expect(JSON.parse(payloads[2]!.split('data: ')[1]!.trim()).messages).toHaveLength(3);
      expect(canceledStalls).toBe(1);
      expect(stream.state.ended).toBe(false);
    } finally {
      stream.response.destroy();
      await server.close();
    }
  });

  it('destroys a stalled stream, cancels owned state, and reuses its slot', async () => {
    const publisher = new PresentationPublisher();
    let expire: (() => void) | undefined;
    let cancellations = 0;
    let shouldBlock = false;
    const server = createPresentationServer({
      publisher,
      port: 0,
      writeEvent: (response, payload) => {
        response.write(payload);
        if (!shouldBlock) return true;
        shouldBlock = false;
        return false;
      },
      scheduleStall: (callback) => {
        expire = callback;
        return () => { cancellations += 1; };
      },
    });
    const port = await server.start();
    const streams = await Promise.all(Array.from({ length: 8 }, () => openSse(port)));
    try {
      expect((await request(port, '/events')).status).toBe(503);
      shouldBlock = true;
      publisher.publish([{ username: 'Ana', message: 'blocked' }]);
      expect(typeof expire).toBe('function');
      expire?.();
      await waitFor(() => streams.some((stream) => stream.response.destroyed));
      const replacement = await openSse(port);
      expect(replacement.response.statusCode).toBe(200);
      replacement.response.destroy();
      expect(cancellations).toBe(1);
    } finally {
      for (const stream of streams) stream.response.destroy();
      await server.close();
    }
  });

  it('fails a busy port and closes active streams and sockets deterministically', async () => {
    const first = createPresentationServer({ publisher: new PresentationPublisher(), port: 0 });
    const port = await first.start();
    const stream = await openSse(port);
    const second = createPresentationServer({ publisher: new PresentationPublisher(), port });
    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await second.close();
    await first.close();
    await waitFor(() => stream.response.destroyed);
    expect(stream.response.destroyed).toBe(true);
  });
});
