import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeTempRepo } from '../helpers/temp-repo.js';

/**
 * Same gate numbers as the Istanbul CLI check tests: patch 80 / project 90.
 * lcov DA lines 1–3 match the Istanbul statement map so pass/fail is identical.
 */
const YAML = [
  'base: main',
  'coverage:',
  '  path: coverage/lcov.info',
  '  # format omitted — auto-detect from lcov.info',
  'thresholds:',
  '  patch: 80',
  '  project: 90',
  '',
].join('\n');

const YAML_EXPLICIT = [
  'base: main',
  'coverage:',
  '  format: lcov',
  '  path: coverage/lcov.info',
  'thresholds:',
  '  patch: 80',
  '  project: 90',
  '',
].join('\n');

let failRepo: string;
let passRepo: string;
let explicitRepo: string;

beforeAll(async () => {
  const fail = await makeTempRepo({
    yaml: YAML,
    hits: [1, 0, 0],
    coverageKind: 'lcov',
  });
  failRepo = fail.repo;

  const pass = await makeTempRepo({
    yaml: YAML,
    hits: [1, 1, 1],
    coverageKind: 'lcov',
  });
  passRepo = pass.repo;

  const explicit = await makeTempRepo({
    yaml: YAML_EXPLICIT,
    hits: [1, 0, 0],
    coverageKind: 'lcov',
  });
  explicitRepo = explicit.repo;
});

afterAll(async () => {
  await rm(failRepo, { recursive: true, force: true });
  await rm(passRepo, { recursive: true, force: true });
  await rm(explicitRepo, { recursive: true, force: true });
});

describe('tested check against lcov (same thresholds as Istanbul)', () => {
  it('fails when newly added lines are uncovered (patch under 80)', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json'], {
      cwd: failRepo,
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      patch: { pct: number; pass: boolean; threshold: number };
      project: { pct: number; pass: boolean; threshold: number };
    };
    expect(parsed.patch.threshold).toBe(80);
    expect(parsed.project.threshold).toBe(90);
    expect(parsed.patch.pass).toBe(false);
    expect(parsed.patch.pct).toBe(0);
    expect(parsed.project.pct).toBe(33.3);
    expect(parsed.overall).toBe('fail');
  });

  it('passes when every executable line is hit', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json'], {
      cwd: passRepo,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      patch: { pct: number; pass: boolean };
      project: { pct: number; pass: boolean };
    };
    expect(parsed.patch.pass).toBe(true);
    expect(parsed.project.pass).toBe(true);
    expect(parsed.patch.pct).toBe(100);
    expect(parsed.project.pct).toBe(100);
    expect(parsed.overall).toBe('pass');
  });

  it('accepts explicit coverage.format: lcov', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json'], {
      cwd: explicitRepo,
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { overall: string };
    expect(parsed.overall).toBe('fail');
  });
});
