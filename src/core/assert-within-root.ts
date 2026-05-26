/**
 * assert-within-root.ts — Reject any path that resolves outside a given
 * repository root.
 *
 * Used by commands that read user-supplied or coverage-derived paths so a
 * tampered `coverage-final.json` or `.tested.yaml` cannot exfiltrate
 * `/etc/passwd` via `../../..` style traversal.
 */

import { resolve, sep } from 'node:path';

export function assertWithinRoot(root: string, resolvedPath: string): void {
  // Append separator so /repo does not allow /repo-evil.
  const safeRoot = resolve(root) + sep;
  const safePath = resolve(resolvedPath);
  if (!safePath.startsWith(safeRoot)) {
    throw new Error(
      `Path traversal rejected: ${safePath} is outside repository root ${safeRoot}`,
    );
  }
}
