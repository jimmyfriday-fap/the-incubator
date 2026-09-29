export const LLM_ADAPTER_IDS = [
  'claude-cli',
  'copilot-cli',
  'cursor-cli',
  'anthropic-api',
  'fake',
] as const;
export type LlmAdapterId = (typeof LLM_ADAPTER_IDS)[number];

export function isLlmAdapterId(value: string): value is LlmAdapterId {
  return (LLM_ADAPTER_IDS as readonly string[]).includes(value);
}
