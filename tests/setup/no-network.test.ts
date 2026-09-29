import net from 'node:net';
import { describe, expect, it } from 'vitest';

describe('unit isolation', () => {
  it('blocks outbound fetch', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/must not touch the network/);
  });
  it('blocks outbound sockets but allows loopback', async () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(
      /must not touch the network/,
    );
    const server = net.createServer((s) => s.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const data = await new Promise<string>((resolve, reject) => {
      const c = net.connect({ host: '127.0.0.1', port });
      let buf = '';
      c.on('data', (b) => (buf += b.toString()));
      c.on('end', () => resolve(buf));
      c.on('error', reject);
    });
    server.close();
    expect(data).toBe('ok');
  });
});
