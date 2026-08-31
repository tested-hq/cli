import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeFlagRepo } from '../helpers/flag-repo.js';
import { runCheck } from '../../src/commands/check.js';
import type { DiffOutput, TestedConfig } from '../../src/schemas.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

function makeConfig(): TestedConfig {
  return {
    ignores: [],
    coverage: { path: 'coverage/coverage-final.json' },
    base: 'main',
    testRunner: null,
    thresholds: { patch: 80, project: 50 },
    flags: {
      frontend: { paths: ['apps/web/**'], thresholds: { patch: 90 } },
      backend: { paths: ['apps/api/**'] },
    },
  };
}

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

/** Combined 9/10 = 90% patch — passes global 80. Frontend 4/5 = 80% fails flag 90. */
function combinedDiff(): DiffOutput {
  return {
    schemaVersion: 1,
    base: 'main',
    head: 'abc',
    patch: { executable: 10, covered: 9, pct: 90 },
    project: { executable: 12, covered: 11, pct: 91.7, delta: null },
    files: [],
    ignored: [],
  };
}

const web = file('apps/web/ui.ts', [1, 1, 1, 1, 1, 0]);
const api = file('apps/api/srv.ts', [1, 1, 1, 1, 1, 1]);
const added = new Map([
  ['apps/web/ui.ts', new Set([2, 3, 4, 5, 6])],
  ['apps/api/srv.ts', new Set([2, 3, 4, 5, 6])],
]);

describe('runCheck — flags vs global floor', () => {
  it('fails overall when only the frontend flag misses (global would pass)', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: combinedDiff(),
      json: true,
      files: [web, api],
      addedByFile: added,
    });
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(true);
    expect(result.overall).toBe('fail');
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      flags: {
        frontend: { status: string; patch: { pct: number; pass: boolean; patchCheck?: string } };
        backend: { status: string; patch: { pct: number; pass: boolean } };
      };
    };
    expect(parsed.overall).toBe('fail');
    expect(parsed.flags.frontend.status).toBe('fail');
    expect(parsed.flags.frontend.patch.pct).toBe(80);
    expect(parsed.flags.frontend.patch.pass).toBe(false);
    expect(parsed.flags.backend.status).toBe('pass');
    expect(result.flagResults.find((f) => f.name === 'frontend')?.patchCheck).toBe(
      'tested.dev / patch / frontend',
    );
  });

  it('missing frontend is skipped, not a 0% fail copied from backend', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: {
        ...combinedDiff(),
        patch: { executable: 5, covered: 5, pct: 100 },
        project: { executable: 6, covered: 6, pct: 100, delta: null },
      },
      json: true,
      files: [api],
      addedByFile: added,
    });
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      flags: {
        frontend: {
          status: string;
          present: boolean;
          skipped?: boolean;
          patch: { executable?: number; pct?: number; pass?: boolean; skipped?: boolean };
          project: { executable?: number; pct?: number; skipped?: boolean };
        };
        backend: { status: string; patch: { executable: number; pct: number } };
      };
    };
    expect(parsed.flags.frontend.status).toBe('missing');
    expect(parsed.flags.frontend.present).toBe(false);
    expect(parsed.flags.frontend.skipped).toBe(true);
    expect(parsed.flags.frontend.patch.skipped).toBe(true);
    expect(parsed.flags.frontend.patch.pass).toBeUndefined();
    expect(parsed.flags.frontend.patch.executable).toBeUndefined();
    expect(parsed.flags.frontend.patch.pct).toBeUndefined();
    expect(parsed.flags.frontend.project.executable).toBeUndefined();
    expect(parsed.flags.backend.status).toBe('pass');
    expect(parsed.flags.backend.patch.executable).toBe(5);
    expect(parsed.overall).toBe('pass');
    expect(result.exitCode).toBe(0);
  });
});

describe('tested check — two-package fixture', () => {
  let both: string;
  let backendOnly: string;

  beforeAll(async () => {
    both = (await makeFlagRepo()).repo;
    backendOnly = (await makeFlagRepo({ includeFrontend: false })).repo;
  });

  afterAll(async () => {
    await rm(both, { recursive: true, force: true });
    await rm(backendOnly, { recursive: true, force: true });
  });

  it('fails frontend and passes backend (global floor alone would pass)', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json'], { cwd: both });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      patch: { pct: number; pass: boolean };
      project: { pass: boolean };
      flags: {
        frontend: { status: string; patch: { pct: number; pass: boolean }; patchCheck: string };
        backend: { status: string; patch: { pct: number; pass: boolean } };
      };
      overall: string;
    };
    expect(parsed.patch.pass).toBe(true);
    expect(parsed.project.pass).toBe(true);
    expect(parsed.patch.pct).toBeGreaterThanOrEqual(80);
    expect(parsed.flags.frontend.status).toBe('fail');
    expect(parsed.flags.frontend.patch.pct).toBe(80);
    expect(parsed.flags.frontend.patch.pass).toBe(false);
    expect(parsed.flags.frontend.patchCheck).toBe('tested.dev / patch / frontend');
    expect(parsed.flags.backend.status).toBe('pass');
    expect(parsed.flags.backend.patch.pass).toBe(true);
    expect(parsed.overall).toBe('fail');
  });

  it('prints both flags in human output', async () => {
    const result = await invokeCli(['check', '--base', 'main'], { cwd: both });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('frontend');
    expect(result.stdout).toContain('backend');
    expect(result.stdout).toContain('[FAIL]');
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).toContain('threshold 90');
  });

  it('missing frontend is skipped, not a 0% fail copied from backend', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json'], {
      cwd: backendOnly,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      flags: {
        frontend: {
          status: string;
          skipped?: boolean;
          patch: { executable?: number; pct?: number; pass?: boolean; skipped?: boolean };
        };
        backend: { status: string; patch: { executable: number; pct: number } };
      };
    };
    expect(parsed.overall).toBe('pass');
    expect(parsed.flags.frontend.status).toBe('missing');
    expect(parsed.flags.frontend.skipped).toBe(true);
    expect(parsed.flags.frontend.patch.skipped).toBe(true);
    expect(parsed.flags.frontend.patch.executable).toBeUndefined();
    expect(parsed.flags.frontend.patch.pct).toBeUndefined();
    expect(parsed.flags.frontend.patch.pass).toBeUndefined();
    expect(parsed.flags.backend.status).toBe('pass');
    expect(parsed.flags.backend.patch.executable).toBeGreaterThan(0);
  });

  it('human output marks a missing flag without 0%', async () => {
    const result = await invokeCli(['check', '--base', 'main'], { cwd: backendOnly });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('frontend');
    expect(result.stdout).toContain('[MISSING]');
    expect(result.stdout).toContain('backend');
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).not.toMatch(/frontend[\s\S]{0,80}0\.0%/);
    expect(result.stdout).not.toContain('no carryforward');
  });

  it('scopes --flag backend so a backend-only upload can pass', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json', '--flag', 'backend'], {
      cwd: backendOnly,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      flags: Record<string, { status: string }>;
    };
    expect(parsed.overall).toBe('pass');
    expect(Object.keys(parsed.flags)).toEqual(['backend']);
    expect(parsed.flags['backend']?.status).toBe('pass');
  });

  it('rejects an unknown --flag', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--flag', 'mobile'], {
      cwd: both,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown flag "mobile"');
  });
});
