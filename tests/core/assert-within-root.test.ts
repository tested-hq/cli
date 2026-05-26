import { describe, it, expect } from 'vitest';
import { assertWithinRoot } from '../../src/core/assert-within-root.js';

describe('assertWithinRoot', () => {
  it('passes when resolved path is inside root', () => {
    expect(() => assertWithinRoot('/repo', '/repo/src/auth.ts')).not.toThrow();
    expect(() => assertWithinRoot('/repo/', '/repo/src/auth.ts')).not.toThrow();
  });

  it('throws when resolved path escapes root via ..', () => {
    expect(() => assertWithinRoot('/repo', '/etc/passwd')).toThrow(
      /outside repository root/,
    );
    expect(() => assertWithinRoot('/repo', '/repo/../etc/passwd')).toThrow(
      /outside repository root/,
    );
  });

  it('throws when path equals root itself (must be a file inside)', () => {
    expect(() => assertWithinRoot('/repo', '/repo')).toThrow(
      /outside repository root/,
    );
  });

  it('throws when path is a sibling of root with shared prefix', () => {
    // /repo-evil starts with /repo but is not inside it
    expect(() => assertWithinRoot('/repo', '/repo-evil/x')).toThrow(
      /outside repository root/,
    );
  });
});
