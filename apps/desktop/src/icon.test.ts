import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktop = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(path.join(desktop, rel), 'utf8');

describe('the app icon (plan 031)', () => {
  it('is a 512×512 PNG with transparency', () => {
    const png = readFileSync(path.join(desktop, 'build/icon.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    // Colour type 6 is RGBA: the corners stay transparent around the egg.
    expect(png[25]).toBe(6);
  });

  it('is named by the packaging config, copied into the app, and shown by the window', () => {
    const yml = read('electron-builder.yml');
    expect(yml).toMatch(/^linux:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml).toMatch(/^mac:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml).toMatch(/^win:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml.match(/icon: build\/icon\.png/g)).toHaveLength(3);
    // The .exe carries the icon without being signed (signExecutable, not signAndEditExecutable).
    expect(yml).toMatch(/^ {2}signExecutable: false$/m);
    expect(yml).not.toContain('signAndEditExecutable');
    expect(read('scripts/build.mjs')).toContain("copy('apps/desktop/build/icon.png', 'icon.png');");
    expect(read('src/main.ts')).toContain("icon: path.join(appRoot, 'icon.png'),");
  });
});
