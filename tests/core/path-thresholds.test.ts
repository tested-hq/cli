import { describe, expect, it } from 'vitest';
import {
  evaluatePathThresholds,
  MISSING_PATH_REASON,
  pathThresholdsPass,
  pathThresholdsToJson,
  resolvePathThresholds,
} from '../../src/core/path-thresholds.js';
import { PathsJsonSchema } from '../../src/schemas.js';
import type { FileCoverage } from '../../src/core/istanbul.js';
import type { TestedConfig } from '../../src/schemas.js';

function file(path: string, hits: readonly number[]): FileCoverage {
  return {
    path,
    absPath: `/repo/${path}`,
    statements: hits.map((h, i) => ({
      id: String(i),
      startLine: i + 1,
      endLine: i + 1,
      hits: h,
    })),
  };
}

function config(): TestedConfig {
  return {
    ignores: [],
    coverage: { path: 'coverage/coverage-final.json' },
    base: 'main',
    testRunner: null,
    thresholds: {
      patch: 80,
      project: 50,
      paths: [
        { glob: 'src/api/**', patch: 90, project: 90 },
        { glob: 'src/cli/**', patch: 70, project: 70 },
      ],
    },
  };
}

const api = file('src/api/handler.ts', [1, 1, 1, 1, 1, 0]);
const cli = file('src/cli/main.ts', [1, 1, 1, 1, 1, 1]);

/** Added lines 2–6 in each path (line 1 is pre-existing). */
function addedBoth(): Map<string, Set<number>> {
  return new Map([
    ['src/api/handler.ts', new Set([2, 3, 4, 5, 6])],
    ['src/cli/main.ts', new Set([2, 3, 4, 5, 6])],
  ]);
}

describe('resolvePathThresholds', () => {
  it('inherits global floors and overlays per-path overrides', () => {
    expect(
      resolvePathThresholds({ glob: 'src/api/**', patch: 90 }, { patch: 80, project: 50 }),
    ).toEqual({ patch: 90, project: 50 });
    expect(resolvePathThresholds({ glob: 'src/cli/**' }, { patch: 80, project: 50 })).toEqual({
      patch: 80,
      project: 50,
    });
  });
});

describe('evaluatePathThresholds', () => {
  it('fails src/api/** at 80% against a 90 floor while src/cli/** passes 70', () => {
    const results = evaluatePathThresholds({
      config: config(),
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    const apiResult = results.find((p) => p.glob === 'src/api/**');
    const cliResult = results.find((p) => p.glob === 'src/cli/**');
    expect(apiResult?.status).toBe('fail');
    expect(apiResult?.patch).toMatchObject({
      pct: 80,
      threshold: 90,
      pass: false,
      executable: 5,
      covered: 4,
    });
    expect(cliResult?.status).toBe('pass');
    expect(cliResult?.patch).toMatchObject({
      pct: 100,
      threshold: 70,
      pass: true,
      executable: 5,
      covered: 5,
    });
    expect(pathThresholdsPass(results)).toBe(false);
  });

  it('skips a glob with no files this run (not a 0% fail)', () => {
    const results = evaluatePathThresholds({
      config: config(),
      files: [cli],
      addedByFile: addedBoth(),
    });
    const apiResult = results.find((p) => p.glob === 'src/api/**');
    const cliResult = results.find((p) => p.glob === 'src/cli/**');
    expect(apiResult?.status).toBe('missing');
    expect(apiResult?.present).toBe(false);
    expect(apiResult?.reason).toBe(MISSING_PATH_REASON);
    expect(apiResult?.patch.skipped).toBe(true);
    expect(apiResult?.patch.executable).toBeUndefined();
    expect(apiResult?.patch.pct).toBeUndefined();
    expect(cliResult?.status).toBe('pass');
    expect(pathThresholdsPass(results)).toBe(true);
  });

  it('returns no results when paths are not configured (flags-only still works)', () => {
    const results = evaluatePathThresholds({
      config: {
        ...config(),
        thresholds: { patch: 80, project: 50 },
        flags: { frontend: { paths: ['apps/web/**'] } },
      },
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    expect(results).toEqual([]);
  });
});

describe('pathThresholdsToJson', () => {
  it('emits per-path pct + threshold + pass for the scorecard', () => {
    const results = evaluatePathThresholds({
      config: config(),
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    const json = pathThresholdsToJson(results);
    expect(() => PathsJsonSchema.parse(json)).not.toThrow();
    expect(json).toHaveLength(2);
    expect(json[0]).toMatchObject({
      glob: 'src/api/**',
      status: 'fail',
      present: true,
      patch: { pct: 80, threshold: 90, pass: false },
      project: { threshold: 90, pass: false },
    });
    expect(json[1]).toMatchObject({
      glob: 'src/cli/**',
      status: 'pass',
      present: true,
      patch: { pct: 100, threshold: 70, pass: true },
      project: { threshold: 70, pass: true },
    });
  });
});
