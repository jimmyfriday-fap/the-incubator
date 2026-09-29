/**
 * Exit-code contract shared by every CLI command and generated script.
 * 0 pass, 1 the tool itself broke, 2 a policy or gate finding, 130 interrupted.
 */
export const ExitCode = {
  Ok: 0,
  ToolError: 1,
  Policy: 2,
  Interrupted: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
