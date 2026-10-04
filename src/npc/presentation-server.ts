import { createServer, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { PresentationPublisher, type PresentationSnapshot } from './publisher.js';
import {
  OVERLAY_HTML,
  PANEL_HTML,
  PRESENTATION_CSS,
  PRESENTATION_SCRIPT,
  PRESENTATION_SCRIPT_PATH,
  PRESENTATION_STYLE_PATH,
} from './presentation-view.js';

const HOST = '127.0.0.1';
const CLIENT_LIMIT = 8;
const STALL_TIMEOUT_MS = 5_000;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
} as const;

type EventClient = { response: ServerResponse; release: () => void };
type StallScheduler = (expire: () => void) => () => void;

export type PresentationServer = {
  start: () => Promise<number>;
  close: () => Promise<void>;
};

export type PresentationServerOptions = {
  publisher: PresentationPublisher;
  port?: number;
  writeEvent?: (response: ServerResponse, payload: string) => boolean;
  scheduleStall?: StallScheduler;
};

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType });
  response.end(body);
}

function encodeSnapshot(snapshot: PresentationSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

function scheduleStallDefault(expire: () => void): () => void {
  const timer = setTimeout(expire, STALL_TIMEOUT_MS);
  timer.unref();
  return () => clearTimeout(timer);
}

export function createPresentationServer(options: PresentationServerOptions): PresentationServer {
  const requestedPort = options.port ?? 4177;
  const clients = new Set<EventClient>();
  const sockets = new Set<Socket>();
  let canonicalOrigin = '';
  let isStarted = false;
  let closePromise: Promise<void> | undefined;

  const server = createServer((request, response) => {
    const reject = (status: number): void => send(response, status, 'text/plain; charset=utf-8', 'Request rejected.\n');
    if (request.method !== 'GET') return reject(405);
    if ((request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
      || request.headers['transfer-encoding'] !== undefined) return reject(400);
    if (request.headers.host !== canonicalOrigin.slice('http://'.length)) return reject(403);
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== canonicalOrigin) return reject(403);
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
      return reject(403);
    }

    if (request.url === '/') return send(response, 200, 'text/html; charset=utf-8', PANEL_HTML);
    if (request.url === '/overlay') return send(response, 200, 'text/html; charset=utf-8', OVERLAY_HTML);
    if (request.url === PRESENTATION_SCRIPT_PATH) {
      return send(response, 200, 'text/javascript; charset=utf-8', PRESENTATION_SCRIPT);
    }
    if (request.url === PRESENTATION_STYLE_PATH) {
      return send(response, 200, 'text/css; charset=utf-8', PRESENTATION_CSS);
    }
    if (request.url !== '/events') return reject(404);
    if (clients.size >= CLIENT_LIMIT) return reject(503);

    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    });
    const scheduleStall = options.scheduleStall ?? scheduleStallDefault;
    let unsubscribe = (): void => {};
    let cancelStall: (() => void) | undefined;
    let pendingPayload = '';
    let isBlocked = false;
    let isReleased = false;
    let client: EventClient;

    const clearStall = (): void => {
      cancelStall?.();
      cancelStall = undefined;
    };
    const release = (): void => {
      if (isReleased) return;
      isReleased = true;
      clearStall();
      pendingPayload = '';
      unsubscribe();
      response.off('drain', onDrain);
      request.off('close', release);
      response.off('close', release);
      response.off('error', release);
      clients.delete(client);
    };
    const expire = (): void => {
      release();
      response.destroy();
      response.socket?.destroy();
    };
    const beginStall = (): void => {
      isBlocked = true;
      cancelStall = scheduleStall(expire);
    };
    const writePayload = (payload: string): void => {
      if (isReleased) return;
      try {
        const didWrite = options.writeEvent?.(response, payload) ?? response.write(payload);
        if (!didWrite) beginStall();
      } catch {
        expire();
      }
    };
    const onDrain = (): void => {
      if (isReleased || !isBlocked) return;
      clearStall();
      isBlocked = false;
      if (pendingPayload.length === 0) return;
      const latestPayload = pendingPayload;
      pendingPayload = '';
      writePayload(latestPayload);
    };
    const deliver = (snapshot: PresentationSnapshot): void => {
      const payload = encodeSnapshot(snapshot);
      if (isBlocked) {
        pendingPayload = payload;
        return;
      }
      writePayload(payload);
    };

    client = { response, release };
    clients.add(client);
    request.once('close', release);
    response.once('close', release);
    response.once('error', release);
    response.on('drain', onDrain);
    const subscribed = options.publisher.subscribe(deliver);
    if (isReleased) subscribed();
    else unsubscribe = subscribed;
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 2_000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return {
    start: async () => {
      if (isStarted) throw new Error('presentation_server_already_started');
      isStarted = true;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => { server.off('listening', onListening); reject(error); };
        const onListening = (): void => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(requestedPort, HOST);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('presentation_address_unavailable');
      canonicalOrigin = `http://${HOST}:${address.port}`;
      return address.port;
    },
    close: () => {
      closePromise ??= new Promise<void>((resolve) => {
        for (const client of [...clients]) {
          client.release();
          client.response.destroy();
        }
        for (const socket of [...sockets]) socket.destroy();
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      return closePromise;
    },
  };
}
