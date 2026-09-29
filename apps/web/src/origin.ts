/** The only Origin the localhost server accepts. */
export function expectedOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  return origin === expectedOrigin(port);
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}`;
}
