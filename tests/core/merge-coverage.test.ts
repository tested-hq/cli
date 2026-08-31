import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoverage } from '../../src/core/coverage.js';
import { mergeFileCoverage } from '../../src/core/merge-coverage.js';
import { computePatchCoverage } from '../../src/core/patch.js';
import { computeProjectCoverage } from '../../src/core/project.js';

const shardsDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/shards');

async function parseShard(name: string) {
  return parseCoverage({ path: join(shardsDir, name), repoRoot: '/repo' });
}

describe('mergeFileCoverage — union of shards (not last-file-wins)', () => {
  it('keeps files from both shards; last shard does not replace the first', async () => {
    const a = await parseShard('shard-a.lcov');
    const b = await parseShard('shard-b.lcov');
    expect(a.map((f) => f.path)).toEqual(['src/file1.ts']);
    expect(b.map((f) => f.path)).toEqual(['src/file2.ts']);

    const merged = mergeFileCoverage([a, b]);
    expect(merged.map((f) => f.path)).toEqual(['src/file1.ts', 'src/file2.ts']);

    const lastWins = mergeFileCoverage([b]);
    expect(lastWins.map((f) => f.path)).toEqual(['src/file2.ts']);
    expect(lastWins.some((f) => f.path === 'src/file1.ts')).toBe(false);
  });

  it('project totals equal the union, not an average of shard percents', async () => {
    const a = await parseShard('shard-a.lcov');
    const b = await parseShard('shard-b.lcov');
    const projectA = computeProjectCoverage(a);
    const projectB = computeProjectCoverage(b);
    // A: 2/3 covered (66.7), B: 2/3 covered (66.7). Average would stay 66.7
    // but with 3 executable if last-wins. Union is 4/6 = 66.7 with 6 exec.
    expect(projectA.totals.executable).toBe(3);
    expect(projectB.totals.executable).toBe(3);

    const merged = mergeFileCoverage([a, b]);
    const project = computeProjectCoverage(merged);
    expect(project.totals.executable).toBe(6);
    expect(project.totals.covered).toBe(4);
    expect(project.byFile.has('src/file1.ts')).toBe(true);
    expect(project.byFile.has('src/file2.ts')).toBe(true);

    const lastOnly = computeProjectCoverage(b);
    expect(lastOnly.totals.executable).toBe(3);
    expect(lastOnly.byFile.has('src/file1.ts')).toBe(false);
  });

  it('patch math is the union of added lines across shards', async () => {
    const a = await parseShard('shard-a.lcov');
    const b = await parseShard('shard-b.lcov');
    const addedByFile = new Map<string, Set<number>>([
      ['src/file1.ts', new Set([2, 3])],
      ['src/file2.ts', new Set([2, 3])],
    ]);

    const merged = mergeFileCoverage([a, b]);
    const patch = computePatchCoverage(merged, addedByFile);
    // file1: line 2 hit, line 3 miss; file2: line 2 miss, line 3 hit
    expect(patch.totals.executable).toBe(4);
    expect(patch.totals.covered).toBe(2);
    expect(patch.byFile.has('src/file1.ts')).toBe(true);
    expect(patch.byFile.has('src/file2.ts')).toBe(true);

    const lastOnly = computePatchCoverage(b, addedByFile);
    expect(lastOnly.totals.executable).toBe(2);
    expect(lastOnly.byFile.has('src/file1.ts')).toBe(false);
  });

  it('maxes overlapping hits (does not average, does not keep the last shard)', async () => {
    const a = await parseShard('overlap-a.lcov');
    const b = await parseShard('overlap-b.lcov');
    const merged = mergeFileCoverage([a, b]);
    expect(merged).toHaveLength(1);
    const hits = new Map(merged[0]!.statements.map((s) => [s.startLine, s.hits]));
    // A: 5, 0, 1  B: 1, 9, 0  → max 5, 9, 1
    expect(hits.get(1)).toBe(5);
    expect(hits.get(2)).toBe(9);
    expect(hits.get(3)).toBe(1);

    const lastWinsHits = new Map(b[0]!.statements.map((s) => [s.startLine, s.hits]));
    expect(lastWinsHits.get(1)).toBe(1);
    expect(lastWinsHits.get(3)).toBe(0);

    const averaged = (5 + 1) / 2;
    expect(hits.get(1)).not.toBe(averaged);
  });
});
