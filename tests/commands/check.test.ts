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
    expect(result.stderr).toContain('no thresholds configured');
    expect(result.stderr).toContain('skipping gate check');
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
  it('exits 0, emits two pass lines on stderr and machine summary on stdout', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(87.3, 64.1),
      json: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.overall).toBe('pass');
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(true);
    // stderr human lines
    expect(result.stderr).toContain('patch coverage 87.3% (threshold 80) — pass');
    expect(result.stderr).toContain('project coverage 64.1% (threshold 60) — pass');
    expect(result.stderr).toContain('✅');
    expect(result.stderr).not.toContain('❌');
    // stdout machine summary
    expect(result.stdout).toContain('PATCH: 87.3% / 80% — PASS');
    expect(result.stdout).toContain('PROJECT: 64.1% / 60% — PASS');
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
  it('exits 1, marks patch as fail and project as pass', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(42.7, 64.1),
      json: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.overall).toBe('fail');
    expect(result.patchPass).toBe(false);
    expect(result.projectPass).toBe(true);
    expect(result.stderr).toContain('❌ patch coverage 42.7% (threshold 80) — fail');
    expect(result.stderr).toContain('✅ project coverage 64.1% (threshold 60) — pass');
    expect(result.stdout).toContain('PATCH: 42.7% / 80% — FAIL');
    expect(result.stdout).toContain('PROJECT: 64.1% / 60% — PASS');
  });
});

describe('runCheck — both fail', () => {
  it('exits 1 with two fail lines', () => {
    const result = run({
      config: makeConfig({ patch: 80, project: 60 }),
      diff: makeDiff(10, 20),
      json: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.overall).toBe('fail');
    expect(result.patchPass).toBe(false);
    expect(result.projectPass).toBe(false);
    const failCount = (result.stderr.match(/❌/g) ?? []).length;
    expect(failCount).toBe(2);
    expect(result.stderr).not.toContain('✅');
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
    expect(result.stderr).toContain('87.3%');
    expect(result.stderr).toContain('64.1%');
  });
});
