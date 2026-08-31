import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coveragePathList,
  parseAndMergeCoverage,
  parseCoverageFileList,
  resolveCoveragePaths,
} from '../../src/core/coverage-paths.js';

const shardsDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/shards');

describe('coveragePathList / parseCoverageFileList', () => {
  it('normalizes a string or list', () => {
    expect(coveragePathList('coverage/lcov.info')).toEqual(['coverage/lcov.info']);
    expect(coveragePathList(['a.lcov', ' b.xml '])).toEqual(['a.lcov', 'b.xml']);
  });

  it('splits newline or comma, not spaces', () => {
    expect(parseCoverageFileList('a.lcov,b.xml')).toEqual(['a.lcov', 'b.xml']);
    expect(parseCoverageFileList('a.lcov\nb.xml')).toEqual(['a.lcov', 'b.xml']);
    expect(parseCoverageFileList('coverage/my file.lcov')).toEqual(['coverage/my file.lcov']);
  });

  it('prefers --file over env over config', () => {
    expect(
      resolveCoveragePaths({
        files: ['cli.lcov'],
        env: { TESTED_COVERAGE_FILES: 'env.lcov' },
        configPath: 'config.lcov',
      }),
    ).toEqual(['cli.lcov']);
    expect(
      resolveCoveragePaths({
        env: { TESTED_COVERAGE_FILES: 'env.lcov,env.xml' },
        configPath: 'config.lcov',
      }),
    ).toEqual(['env.lcov', 'env.xml']);
    expect(resolveCoveragePaths({ configPath: ['a', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('parseAndMergeCoverage', () => {
  it('merges two shard fixtures into one FileCoverage list', async () => {
    const files = await parseAndMergeCoverage({
      paths: ['shard-a.lcov', 'shard-b.lcov'],
      cwd: shardsDir,
      repoRoot: shardsDir,
    });
    expect(files.map((f) => f.path)).toEqual(['src/file1.ts', 'src/file2.ts']);
  });
});
