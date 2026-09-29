// Unit-suite isolation: any connection to a non-loopback host fails the test immediately.
import net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '']);

function hostOf(args: unknown[]): string {
  const first = args[0];
  // net.connect() forwards its normalized argument array as a single argument.
  if (Array.isArray(first)) return hostOf(first as unknown[]);
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const o = first as { host?: string; path?: string };
    if (o.path) return ''; // unix socket / named pipe
    return o.host ?? '';
  }
  if (typeof first === 'string') return ''; // path-based IPC
  const second = args[1];
  return typeof second === 'string' ? second : '';
}

type Connect = (this: net.Socket, ...a: unknown[]) => net.Socket;
const proto = net.Socket.prototype as unknown as { connect: Connect };
const originalConnect = proto.connect;
proto.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args);
  if (!LOOPBACK.has(host)) {
    throw new Error(`unit tests must not touch the network (attempted ${host})`);
  }
  return originalConnect.apply(this, args);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!LOOPBACK.has(url.hostname) && url.hostname !== '[::1]') {
    return Promise.reject(
      new Error(`unit tests must not touch the network (fetch ${url.hostname})`),
    );
  }
  return originalFetch(input, init);
};
