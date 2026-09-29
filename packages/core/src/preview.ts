import { existsSync } from 'node:fs';
import path from 'node:path';
import { specHash, type IncubatorSpec } from '@incubator/spec';
import { PAIRED_PREFIX, render, type RenderResult } from '@incubator/templates';
import { planDelta } from '@incubator/analyzer';

export type PreviewStatus = 'create' | 'identical' | 'proposed' | 'owned';

export interface PreviewFile {
  path: string;
  bytes: number;
  mode: '0644' | '0755';
  pack: string;
  /** adopt only: what adopting does with this file. */
  status?: PreviewStatus;
}

export interface Preview {
  specHash: string;
  files: PreviewFile[];
}

/**
 * The file tree a spec renders to, held in memory (no workspace needed). For adopt, each file carries
 * its delta status against the run's clone. Cached per spec hash, so repeated previews are cheap.
 */
export class PreviewCache {
  readonly #cache = new Map<string, Promise<RenderResult>>();

  private rendered(spec: IncubatorSpec): Promise<RenderResult> {
    const key = specHash(spec);
    let hit = this.#cache.get(key);
    if (!hit) {
      hit = render(spec);
      hit.catch(() => this.#cache.delete(key));
      if (this.#cache.size >= 8) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(key, hit);
    }
    return hit;
  }

  async preview(spec: IncubatorSpec, adoptRepo?: string): Promise<Preview> {
    const result = await this.rendered(spec);
    const status = new Map<string, PreviewStatus>();
    if (adoptRepo && existsSync(path.join(adoptRepo, '.git'))) {
      const d = planDelta(result, adoptRepo);
      for (const k of ['create', 'identical', 'proposed', 'owned'] as const)
        for (const p of d[k]) status.set(p, k);
    }
    const files = [...result.files.values()]
      .filter((f) => !adoptRepo || !f.path.startsWith(PAIRED_PREFIX))
      .map((f) => {
        const s = status.get(f.path);
        return {
          path: f.path,
          bytes: f.bytes.length,
          mode: f.mode,
          pack: f.pack,
          ...(s ? { status: s } : {}),
        };
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { specHash: specHash(spec), files };
  }

  /** One rendered file's bytes, looked up by exact path in the render (never the file system). */
  async file(spec: IncubatorSpec, filePath: string): Promise<Buffer | null> {
    return (await this.rendered(spec)).files.get(filePath)?.bytes ?? null;
  }
}
