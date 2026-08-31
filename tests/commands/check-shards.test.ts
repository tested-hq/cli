import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeTempRepo } from '../helpers/temp-repo.js';
import { formatIncompleteCheck } from '../../src/commands/check.js';
import { resolveCoverageMerge } from '../../src/core/coverage-merge.js';

const YAML = [
  'base: main',
  'coverage:',
  '  path: coverage/coverage-final.json',
  'thresholds:',
  '  patch: 80',
  '  project: 90',
  '',
].join('\n');

let repo: string;

beforeAll(async () => {
  const made = await makeTempRepo({ yaml: YAML, hits: [1, 1, 1] });
  repo = made.repo;
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('tested check — incomplete shards do not conclude the gate', () => {
  it('skips evaluation on --parts 2 --part 1 (would pass if we graded shard 1)', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json', '--parts', '2', '--part', '1'], {
      cwd: repo,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      complete: boolean;
      part: number;
      totalParts: number;
      note: string;
    };
    expect(parsed.overall).toBe('pending');
    expect(parsed.complete).toBe(false);
    expect(parsed.part).toBe(1);
    expect(parsed.totalParts).toBe(2);
    expect(parsed.note).toMatch(/incomplete/);
    expect(parsed).not.toMatchObject({ overall: 'pass', patch: expect.anything() });
  });

  it('skips on --incomplete even when local coverage would pass', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json', '--incomplete'], {
      cwd: repo,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ overall: 'pending', complete: false });
  });

  it('evaluates the gate on --parts 2 --part 2 (last part)', async () => {
    const result = await invokeCli(['check', '--base', 'main', '--json', '--parts', '2', '--part', '2'], {
      cwd: repo,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { overall: string; patch: { pass: boolean } };
    expect(parsed.overall).toBe('pass');
    expect(parsed.patch.pass).toBe(true);
  });

  it('formatIncompleteCheck never reports overall pass', () => {
    const state = resolveCoverageMerge({ parts: '3', part: '1' }, {});
    const json = formatIncompleteCheck(state, true);
    expect(JSON.parse(json.stdout).overall).toBe('pending');
    expect(json.exitCode).toBe(0);
    const human = formatIncompleteCheck(state, false);
    expect(human.stdout).toBe('');
    expect(human.stderr).toMatch(/incomplete/);
    expect(human.stderr).not.toMatch(/\[PASS\]/);
  });
});
