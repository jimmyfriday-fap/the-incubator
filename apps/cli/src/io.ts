export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** True when a human can answer prompts on this terminal. */
  isTTY?: boolean;
}
