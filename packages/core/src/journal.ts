import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  truncateSync,
} from 'node:fs';
import { globalRedactor, type Clock } from '@incubator/runtime';

export interface JournalEntry {
  seq: number;
  ts: string;
  type: string;
  [field: string]: unknown;
}

/**
 * Append-only JSONL journal (ADR-010). Every append is fsync'd. A torn last line (crash mid-write)
 * is detected on read and truncated. Values pass through the Redactor before hitting disk.
 */
export class Journal {
  #seq: number;
  readonly repaired: boolean;

  constructor(
    readonly file: string,
    private readonly clock: Clock,
  ) {
    const { entries, repaired } = Journal.readFile(file, true);
    this.#seq = entries.at(-1)?.seq ?? 0;
    this.repaired = repaired;
  }

  static readFile(file: string, repair = false): { entries: JournalEntry[]; repaired: boolean } {
    if (!existsSync(file)) return { entries: [], repaired: false };
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const entries: JournalEntry[] = [];
    let goodBytes = 0;
    let repaired = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === '') continue;
      try {
        entries.push(JSON.parse(line) as JournalEntry);
        goodBytes += Buffer.byteLength(line, 'utf8') + 1;
      } catch {
        if (i < lines.length - 1 && lines.slice(i + 1).some((l) => l !== '')) {
          throw new Error(`journal ${file} is corrupt at line ${i + 1}`);
        }
        repaired = true;
        if (repair) truncateSync(file, goodBytes);
        break;
      }
    }
    return { entries, repaired };
  }

  entries(): JournalEntry[] {
    return Journal.readFile(this.file).entries;
  }

  append(type: string, fields: Record<string, unknown> = {}): JournalEntry {
    const entry: JournalEntry = {
      ...fields,
      seq: ++this.#seq,
      ts: this.clock.now().toISOString(),
      type,
    };
    const line = globalRedactor.redact(JSON.stringify(entry));
    const fd = openSync(this.file, 'a', 0o600);
    try {
      appendFileSync(fd, `${line}\n`, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return JSON.parse(line) as JournalEntry;
  }
}
