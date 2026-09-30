export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** True when a human can answer prompts on this terminal. */
  isTTY?: boolean;
  /** Reads a secret: piped stdin, or a hidden prompt on a terminal. */
  readSecret?: (message: string) => Promise<string>;
  /** Asks for one line of free text on a terminal. */
  readLine?: (message: string) => Promise<string>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The real terminal: prompts only when both stdin and stderr are TTYs. */
export function liveIo(): Io {
  const isTTY = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    isTTY,
    readSecret: async (message) => {
      if (!isTTY) return readStdin();
      const { password } = await import('@inquirer/prompts');
      return password({ message, mask: '*' }, { output: process.stderr });
    },
    readLine: async (message) => {
      const { input } = await import('@inquirer/prompts');
      return input({ message }, { output: process.stderr });
    },
  };
}
