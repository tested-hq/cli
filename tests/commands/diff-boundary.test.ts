import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { assertWithinRoot } from '../../src/core/assert-within-root.js';

describe('diff coverage.path boundary', () => {
  it('rejects coverage.path that escapes repoRoot', () => {
    const repoRoot = '/repo';
    const maliciousPath = resolve(repoRoot, '../../etc/passwd');
    expect(() => assertWithinRoot(repoRoot, maliciousPath)).toThrow(
      /outside repository root/,
    );
  });

  it('accepts a legitimate coverage path', () => {
    const repoRoot = '/repo';
    const legitimatePath = resolve(repoRoot, 'coverage/coverage-final.json');
    expect(() => assertWithinRoot(repoRoot, legitimatePath)).not.toThrow();
  });
});
