// Unit-suite isolation: any connection to a non-loopback host fails the test immediately.
import net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '']);

function hostOf(args: unknown[]): string {
  const first = args[0];
  if (Array.isArray(first)) return hostOf(first as unknown[]);
  if (first && typeof first === 'object') {
    const o = first as { host?: string; path?: string };
    return o.path ? '' : (o.host ?? '');
  }
  return typeof args[1] === 'string' ? args[1] : '';
}

type Connect = (this: net.Socket, ...a: unknown[]) => net.Socket;
const proto = net.Socket.prototype as unknown as { connect: Connect };
const original = proto.connect;
proto.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args);
  if (!LOOPBACK.has(host)) throw new Error(`unit tests must not touch the network (attempted ${host})`);
  return original.apply(this, args);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!LOOPBACK.has(url.hostname)) {
    return Promise.reject(new Error(`unit tests must not touch the network (fetch ${url.hostname})`));
  }
  return originalFetch(input, init);
};
