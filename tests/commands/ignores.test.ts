import { describe, it, expect } from 'vitest';
import { formatIgnoresList } from '../../src/commands/ignores.js';

describe('formatIgnoresList', () => {
  it('renders human format', () => {
    const text = formatIgnoresList(['scripts/**', 'tests/**'], false);
    expect(text).toBe('scripts/**\ntests/**');
  });
  it('renders JSON format', () => {
    const text = formatIgnoresList(['scripts/**', 'tests/**'], true);
    expect(JSON.parse(text)).toEqual({ ignores: ['scripts/**', 'tests/**'] });
  });
});
