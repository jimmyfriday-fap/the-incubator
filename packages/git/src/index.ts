/** GitHub repository names: letters, digits, `-`, `_`, `.`; not `.`/`..`; at most 100 chars. */
export function isValidRepoName(name: string): boolean {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..' && !name.endsWith('.git')
  );
}
