import { describe, it, expect } from 'vitest';
import { assertSafeGitRef } from '../src/git-ref.js';

describe('assertSafeGitRef', () => {
  it('accepts normal branch/tag/sha refs', () => {
    expect(assertSafeGitRef('origin/main')).toBe('origin/main');
    expect(assertSafeGitRef('main')).toBe('main');
    expect(assertSafeGitRef('feature/foo-bar')).toBe('feature/foo-bar');
    expect(assertSafeGitRef('v1.2.3')).toBe('v1.2.3');
    expect(assertSafeGitRef('abc1234deadbeef')).toBe('abc1234deadbeef');
    expect(assertSafeGitRef('HEAD')).toBe('HEAD');
    expect(assertSafeGitRef('origin/main~1')).toBe('origin/main~1');
  });

  it('rejects empty, leading dash, and bad charset', () => {
    expect(() => assertSafeGitRef('')).toThrow(/empty/);
    expect(() => assertSafeGitRef('--output=/tmp/x')).toThrow(/start with/);
    expect(() => assertSafeGitRef('foo;rm -rf')).toThrow(/invalid/);
    expect(() => assertSafeGitRef('foo bar')).toThrow(/invalid/);
    expect(() => assertSafeGitRef('a'.repeat(300))).toThrow(/invalid|long/);
  });
});
