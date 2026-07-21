/**
 * git-ref.ts — Constrain git refs passed into git argv.
 *
 * Spawn uses argv arrays (no shell), so classic injection is unlikely, but
 * exotic refs can still cause surprising git behavior. Reject anything outside
 * a conservative charset and leading `-` (flag-like).
 */

/** Allowed git ref charset (branches, tags, SHAs, origin/foo, refs-ish). */
export const SAFE_GIT_REF_RE = /^[A-Za-z0-9_./@~^-]{1,256}$/;

export function assertSafeGitRef(ref: string): string {
  if (!ref) {
    throw new Error('git ref must not be empty');
  }
  if (ref.startsWith('-')) {
    throw new Error(`git ref must not start with '-': ${ref}`);
  }
  if (!SAFE_GIT_REF_RE.test(ref)) {
    throw new Error(
      `git ref contains invalid characters or is too long (max 256): ${ref}`,
    );
  }
  return ref;
}
