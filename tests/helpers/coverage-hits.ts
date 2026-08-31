import { expect } from 'vitest';
import type { FileCoverage } from '../../src/core/istanbul.js';

/** Canonical mixed file used by every format fixture: 1=3, 5=0, 9=2, 10=0. */
export const MIXED_LINE_HITS: Readonly<Record<number, number>> = {
  1: 3,
  5: 0,
  9: 2,
  10: 0,
};

export function hitsByLine(file: FileCoverage): Record<number, number> {
  const out: Record<number, number> = {};
  for (const s of file.statements) {
    out[s.startLine] = s.hits;
  }
  return out;
}

/**
 * Assert the mixed covered/uncovered pattern. Fails if a parser swaps
 * hits (e.g. JaCoCo `mi` instead of `ci`, or gcov `#####` skipped).
 */
export function expectMixedHits(file: FileCoverage | undefined, path: string): void {
  expect(file, `missing coverage for ${path}`).toBeDefined();
  const byLine = hitsByLine(file!);
  expect(byLine[1], `${path}: line 1 must be covered (3 hits)`).toBe(3);
  expect(byLine[5], `${path}: line 5 must be uncovered (0 hits)`).toBe(0);
  expect(byLine[9], `${path}: line 9 must be covered (2 hits)`).toBe(2);
  expect(byLine[10], `${path}: line 10 must be uncovered (0 hits)`).toBe(0);
  expect(file!.statements.some((s) => s.hits === 0)).toBe(true);
  expect(file!.statements.some((s) => s.hits > 0)).toBe(true);
}
