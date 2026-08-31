import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeDiff } from '../../src/core/computeDiff.js';
import { loadConfig } from '../../src/config.js';
import { makeTempRepo } from '../helpers/temp-repo.js';

const YAML = [
  'base: main',
  'coverage:',
  '  path:',
  '    - coverage/shard-a.lcov',
  '    - coverage/shard-b.lcov',
  'thresholds:',
  '  patch: 80',
  '  project: 50',
  '',
].join('\n');

function lcov(filePath: string, hits: [number, number, number]): string {
  return [`SF:${filePath}`, `DA:1,${hits[0]}`, `DA:2,${hits[1]}`, `DA:3,${hits[2]}`, 'end_of_record', ''].join(
    '\n',
  );
}

let repo: string;

beforeAll(async () => {
  const made = await makeTempRepo({
    yaml: YAML,
    extraFiles: { 'src/file2.ts': 'export const x = 1;\n' },
    featureFiles: {
      'src/auth.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
      'src/file2.ts': 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n',
    },
  });
  repo = made.repo;
  await mkdir(join(repo, 'coverage'), { recursive: true });
  await writeFile(join(repo, 'coverage/shard-a.lcov'), lcov(join(repo, 'src/auth.ts'), [1, 1, 1]));
  await writeFile(join(repo, 'coverage/shard-b.lcov'), lcov(join(repo, 'src/file2.ts'), [1, 1, 1]));
}, 60_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('computeDiff merges coverage.path list', () => {
  it('includes both shard files; last file alone would drop src/auth.ts', async () => {
    const config = await loadConfig({ cwd: repo });
    expect(config.coverage.path).toEqual(['coverage/shard-a.lcov', 'coverage/shard-b.lcov']);

    const merged = await computeDiff({ cwd: repo, config, baseRef: 'main' });
    const paths = merged.files.map((f) => f.path);
    expect(paths).toContain('src/auth.ts');
    expect(paths).toContain('src/file2.ts');
    expect(merged.project.executable).toBeGreaterThanOrEqual(6);
    expect(merged.patch.executable).toBe(4);
    expect(merged.patch.covered).toBe(4);
    expect(merged.patch.pct).toBe(100);

    const lastOnly = await computeDiff({
      cwd: repo,
      config,
      baseRef: 'main',
      coveragePaths: ['coverage/shard-b.lcov'],
    });
    expect(lastOnly.files.map((f) => f.path)).toEqual(['src/file2.ts']);
    expect(lastOnly.files.some((f) => f.path === 'src/auth.ts')).toBe(false);
    expect(lastOnly.patch.executable).toBe(2);
  });
});
