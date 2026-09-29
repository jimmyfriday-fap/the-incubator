import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Exec } from '@incubator/runtime';
import { capabilitiesFromHelp, notInstalled } from './probe.js';
import type { Capabilities } from './types.js';

interface Entry {
  version: string;
  help: string;
}

/**
 * Caches `--help` output per binary path and version (`~/.incubator/cache/probe.json`), so each
 * run costs one `--version` call per CLI. Without a file it is an in-memory cache.
 */
export class ProbeCache {
  #entries: Record<string, Entry> | undefined;
  constructor(private readonly file?: string) {}

  private async load(): Promise<Record<string, Entry>> {
    if (this.#entries) return this.#entries;
    try {
      this.#entries = this.file
        ? (JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Entry>)
        : {};
    } catch {
      this.#entries = {};
    }
    return this.#entries;
  }

  async get(exec: Exec, bin: string): Promise<Capabilities> {
    const resolved = await exec.which(bin);
    if (!resolved) return notInstalled(bin);
    const versionRun = await exec.run(bin, ['--version'], { timeoutMs: 15_000 });
    const version = (versionRun.stdout || versionRun.stderr).trim();
    const entries = await this.load();
    let entry = entries[resolved.path];
    if (!entry || entry.version !== version) {
      const help = await exec.run(bin, ['--help'], { timeoutMs: 15_000 });
      entry = { version, help: `${help.stdout}\n${help.stderr}` };
      entries[resolved.path] = entry;
      if (this.file) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
      }
    }
    return capabilitiesFromHelp(entry.version, entry.help, resolved.path);
  }
}
