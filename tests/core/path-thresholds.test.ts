import { describe, expect, it } from 'vitest';
import {
  evaluatePathThresholds,
  MISSING_PATH_REASON,
  pathThresholdsPass,
  pathThresholdsToJson,
  resolvePathThresholds,
  resolvePathThresholdsJson,
} from '../../src/core/path-thresholds.js';
import { EMPTY_PATCH_REASON } from '../../src/core/patch.js';
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

  it('returns no results when thresholds are missing or paths is empty', () => {
    const noThresholds = evaluatePathThresholds({
      config: { ...config(), thresholds: undefined },
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    const emptyList = evaluatePathThresholds({
      config: { ...config(), thresholds: { patch: 80, project: 50, paths: [] } },
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    expect(noThresholds).toEqual([]);
    expect(emptyList).toEqual([]);
    expect(pathThresholdsPass([])).toBe(true);
  });

  it('skips path patch when matched files have no executable added lines', () => {
    const results = evaluatePathThresholds({
      config: {
        ...config(),
        thresholds: {
          patch: 80,
          project: 50,
          paths: [{ glob: 'src/cli/**', patch: 90, project: 50 }],
        },
      },
      files: [cli],
      addedByFile: new Map(),
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('pass');
    expect(results[0]?.patch).toMatchObject({
      skipped: true,
      pass: true,
      reason: EMPTY_PATCH_REASON,
      threshold: 90,
    });
    expect(results[0]?.project).toMatchObject({ pct: 100, threshold: 50, pass: true });
    expect(pathThresholdsPass(results)).toBe(true);
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

  it('omits executable/pct on a skipped missing glob and on an empty path patch', () => {
    const missing = pathThresholdsToJson(
      evaluatePathThresholds({
        config: config(),
        files: [cli],
        addedByFile: addedBoth(),
      }),
    );
    const apiMissing = missing.find((p) => p.glob === 'src/api/**');
    expect(apiMissing).toMatchObject({
      status: 'missing',
      present: false,
      skipped: true,
      reason: MISSING_PATH_REASON,
      patch: { threshold: 90, skipped: true, reason: MISSING_PATH_REASON },
      project: { threshold: 90, skipped: true, reason: MISSING_PATH_REASON },
    });
    expect(apiMissing?.patch.pct).toBeUndefined();
    expect(apiMissing?.patch.executable).toBeUndefined();

    const emptyPatch = pathThresholdsToJson(
      evaluatePathThresholds({
        config: {
          ...config(),
          thresholds: {
            patch: 80,
            project: 50,
            paths: [{ glob: 'src/cli/**', patch: 90, project: 50 }],
          },
        },
        files: [cli],
        addedByFile: new Map(),
      }),
    );
    expect(emptyPatch[0]?.patch).toMatchObject({
      skipped: true,
      reason: EMPTY_PATCH_REASON,
      threshold: 90,
    });
    expect(emptyPatch[0]?.project.pass).toBe(true);
  });

  it('resolvePathThresholdsJson is undefined without paths and returns the array when set', () => {
    expect(
      resolvePathThresholdsJson({
        config: { ...config(), thresholds: { patch: 80, project: 50 } },
        files: [api, cli],
        addedByFile: addedBoth(),
      }),
    ).toBeUndefined();
    const json = resolvePathThresholdsJson({
      config: config(),
      files: [api, cli],
      addedByFile: addedBoth(),
    });
    expect(json).toHaveLength(2);
    expect(json?.[0]?.glob).toBe('src/api/**');
  });
});
