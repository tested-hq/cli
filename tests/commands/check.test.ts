import { describe, it, expect } from 'vitest';
import { runCheck, type CheckInput } from '../../src/commands/check.js';
import type { DiffOutput, TestedConfig } from '../../src/schemas.js';

function makeConfig(
  thresholds: { patch: number; project: number } | undefined,
): TestedConfig {
  return {
    ignores: [],
    coverage: { format: 'istanbul-json', path: 'coverage/coverage-final.json' },
    base: 'main',
    testRunner: null,
    ...(thresholds ? { thresholds } : {}),
  };
}

function makeDiff(patchPct: number, projectPct: number): DiffOutput {
  return {
    schemaVersion: 1,
    base: 'main',
    head: 'abc1234',
    patch: { executable: 100, covered: Math.round(patchPct), pct: patchPct },
    project: {
      executable: 1000,
      covered: Math.round(projectPct * 10),
      pct: projectPct,
      delta: null,
    },
    files: [],
    ignored: [],
  };
}

function run(input: CheckInput) {
  return runCheck(input);
}

describe('runCheck — no thresholds configured', () => {
  it('returns skipped=true and exitCode=0 when thresholds is missing', () => {
    const result = run({
      config: makeConfig(undefined),
      diff: makeDiff(0, 0),
      json: false,
    });
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('no thresholds');
    expect(result.stderr).toContain('gate skipped');
    expect(result.stdout).toBe('');
  });

  it('still skips even when --json is passed', () => {
    const result = run({
      config: makeConfig(undefined),
      diff: makeDiff(0, 0),
      json: true,
    });
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('runCheck — both thresholds pass', () => {
  it('exits 0 with a single clear layout on stdout (no stderr duplicate)', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(87.3, 64.1),
      json: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.overall).toBe('pass');
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(true);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('coverage gate');
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).toContain('Patch');
    expect(result.stdout).toContain('87.3%');
    expect(result.stdout).toContain('threshold 80');
    expect(result.stdout).toContain('Project');
    expect(result.stdout).toContain('64.1%');
    expect(result.stdout).toContain('threshold 60');
    // No machine-summary duplication of FAIL/PASS lines on stderr.
    expect(result.stdout).not.toMatch(/^PATCH:/m);
  });

  it('treats coverage exactly at the threshold as pass', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(80, 60),
      json: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(true);
  });
});

describe('runCheck — patch fails, project passes', () => {
  it('exits 1 with fail badge and next-action tip', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(42.7, 64.1),
      json: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.overall).toBe('fail');
    expect(result.patchPass).toBe(false);
    expect(result.projectPass).toBe(true);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[FAIL]');
    expect(result.stdout).toContain('42.7%');
    expect(result.stdout).toContain('threshold 80');
    expect(result.stdout).toContain('64.1%');
    expect(result.stdout).toContain('threshold 60');
    expect(result.stdout).toContain('tested diff');
  });
});

describe('runCheck — both fail', () => {
  it('exits 1 with overall fail', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(10, 20),
      json: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.overall).toBe('fail');
    expect(result.patchPass).toBe(false);
    expect(result.projectPass).toBe(false);
    expect(result.stdout).toContain('[FAIL]');
    expect(result.stdout).toContain('tested diff');
  });
});

describe('runCheck — --json output', () => {
  it('emits machine-readable JSON on stdout with the expected shape', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(87.3, 64.1),
      json: true,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      patch: { pct: number; threshold: number; pass: boolean };
      project: { pct: number; threshold: number; pass: boolean };
      overall: string;
    };
    expect(parsed.patch).toEqual({ pct: 87.3, threshold: 80, pass: true });
    expect(parsed.project).toEqual({ pct: 64.1, threshold: 60, pass: true });
    expect(parsed.overall).toBe('pass');
  });

  it('json mode still sets exitCode=1 when failing, and includes overall=fail', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(42.7, 64.1),
      json: true,
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { overall: string };
    expect(parsed.overall).toBe('fail');
  });

  it('json mode produces no human stderr output (machine consumers do not need it)', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(10, 20),
      json: true,
    });
    expect(result.stderr).toBe('');
  });
});

describe('runCheck — number formatting', () => {
  it('rounds percentages to one decimal place in human output', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(87.34567, 64.111),
      json: false,
    });
    expect(result.stdout).toContain('87.3%');
    expect(result.stdout).toContain('64.1%');
  });
});

describe('runCheck — empty patch (0 executable)', () => {
  function emptyPatchDiff(projectPct: number): DiffOutput {
    return {
      schemaVersion: 1,
      base: 'main',
      head: 'abc1234',
      patch: { executable: 0, covered: 0, pct: 0 },
      project: {
        executable: 1000,
        covered: Math.round(projectPct * 10),
        pct: projectPct,
        delta: null,
      },
      files: [],
      ignored: [],
    };
  }

  it('skips patch gate and fails only on project when project is low', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: emptyPatchDiff(27.6),
      json: false,
    });
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('no executable lines in the patch');
    expect(result.stdout).toContain('patch gate skipped');
    expect(result.stdout).toContain('[SKIP]');
    expect(result.stdout).toContain('[FAIL]');
    expect(result.stdout).not.toMatch(/Patch\s+0(?:\.0)?%/);
  });

  it('passes overall when project meets threshold and patch is empty', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: emptyPatchDiff(64),
      json: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.overall).toBe('pass');
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).toContain('[SKIP]');
    expect(result.stdout).toContain('no executable lines in the patch');
    expect(result.stdout).toContain('patch gate skipped');
    expect(result.stdout).not.toMatch(/Patch\s+0(?:\.0)?%/);
  });

  it('json names the skip so agents do not treat 0% as a fail', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: emptyPatchDiff(64),
      json: true,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      patch: { pass: boolean; skipped?: boolean; reason?: string; pct: number };
      overall: string;
      note?: string;
    };
    expect(parsed.patch.pass).toBe(true);
    expect(parsed.patch.skipped).toBe(true);
    expect(parsed.patch.reason).toBe('no executable lines in the patch');
    expect(parsed.note).toBe('no executable lines in the patch');
    expect(parsed.overall).toBe('pass');
    // pct stays numeric for shape stability; skipped+reason is the signal.
    expect(parsed.patch.pct).toBe(0);
  });
});
