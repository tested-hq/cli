import { describe, expect, it } from 'vitest';
import {
  evaluateFlags,
  filterFilesByFlag,
  flagsPass,
  MISSING_FLAG_REASON,
  pathMatchesFlag,
  resolveFlagThresholds,
  unknownFlagError,
} from '../../src/core/flags.js';
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
    thresholds: { patch: 80, project: 50 },
    flags: {
      frontend: {
        paths: ['apps/web/**', 'packages/ui/**'],
        thresholds: { patch: 90 },
      },
      backend: { paths: ['apps/api/**'] },
    },
  };
}

const web = file('apps/web/ui.ts', [1, 1, 1, 1, 1, 0]);
const api = file('apps/api/srv.ts', [1, 1, 1, 1, 1, 1]);

/** Added lines 2–6 in each package (line 1 is pre-existing). */
function addedBoth(): Map<string, Set<number>> {
  return new Map([
    ['apps/web/ui.ts', new Set([2, 3, 4, 5, 6])],
    ['apps/api/srv.ts', new Set([2, 3, 4, 5, 6])],
  ]);
}

describe('pathMatchesFlag', () => {
  it('matches package globs', () => {
    expect(pathMatchesFlag('apps/web/ui.ts', ['apps/web/**'])).toBe(true);
    expect(pathMatchesFlag('packages/ui/button.ts', ['packages/ui/**'])).toBe(true);
    expect(pathMatchesFlag('apps/api/srv.ts', ['apps/web/**'])).toBe(false);
  });
});

describe('filterFilesByFlag', () => {
  it('keeps only matching paths', () => {
    const matched = filterFilesByFlag([web, api], ['apps/web/**']);
    expect(matched.map((f) => f.path)).toEqual(['apps/web/ui.ts']);
  });
});

describe('resolveFlagThresholds', () => {
  it('inherits global floors and overlays flag overrides', () => {
    expect(
      resolveFlagThresholds({ paths: ['apps/web/**'], thresholds: { patch: 90 } }, {
        patch: 80,
        project: 50,
      }),
    ).toEqual({ patch: 90, project: 50 });
    expect(resolveFlagThresholds({ paths: ['apps/api/**'] }, { patch: 80, project: 50 })).toEqual({
      patch: 80,
      project: 50,
    });
  });
});

describe('evaluateFlags', () => {
  it('fails frontend patch 80% against a 90 floor while backend passes', () => {
    const results = evaluateFlags({
      config: config(),
      files: [web, api],
      addedByFile: addedBoth(),
    });
    const frontend = results.find((f) => f.name === 'frontend');
    const backend = results.find((f) => f.name === 'backend');
    expect(frontend?.status).toBe('fail');
    expect(frontend?.patch).toMatchObject({ pct: 80, threshold: 90, pass: false, executable: 5, covered: 4 });
    expect(backend?.status).toBe('pass');
    expect(backend?.patch).toMatchObject({ pct: 100, threshold: 80, pass: true, executable: 5, covered: 5 });
    expect(frontend?.patchCheck).toBe('tested.dev / patch / frontend');
    expect(backend?.projectCheck).toBe('tested.dev / project / backend');
    expect(flagsPass(results)).toBe(false);
  });

  it('does not copy backend totals onto a missing frontend flag', () => {
    const results = evaluateFlags({
      config: config(),
      files: [api],
      addedByFile: addedBoth(),
    });
    const frontend = results.find((f) => f.name === 'frontend');
    const backend = results.find((f) => f.name === 'backend');
    expect(frontend?.status).toBe('missing');
    expect(frontend?.present).toBe(false);
    expect(frontend?.reason).toBe(MISSING_FLAG_REASON);
    expect(frontend?.patch.executable).toBe(0);
    expect(frontend?.patch.covered).toBe(0);
    expect(frontend?.patch.pct).toBe(0);
    expect(frontend?.project.executable).toBe(0);
    expect(frontend?.patch.pass).toBe(false);
    expect(backend?.status).toBe('pass');
    expect(backend?.patch.executable).toBe(5);
    expect(frontend?.project.executable).not.toBe(backend?.project.executable);
    expect(frontend?.project.pct).not.toBe(backend?.project.pct);
    expect(flagsPass(results)).toBe(false);
  });

  it('scopes --flag to that coverage file and omits the other package', () => {
    const results = evaluateFlags({
      config: config(),
      files: [api],
      addedByFile: addedBoth(),
      onlyFlag: 'backend',
    });
    expect(results.map((f) => f.name)).toEqual(['backend']);
    expect(results[0]?.status).toBe('pass');
    expect(flagsPass(results)).toBe(true);
  });

  it('throws on an unknown --flag', () => {
    expect(() =>
      evaluateFlags({
        config: config(),
        files: [web],
        addedByFile: addedBoth(),
        onlyFlag: 'mobile',
      }),
    ).toThrow(/unknown flag "mobile"/);
    expect(unknownFlagError('mobile', ['frontend', 'backend']).message).toContain('frontend, backend');
  });
});
