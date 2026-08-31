import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimpleCov } from '../../../src/core/formats/simplecov.js';
import { expectMixedHits, hitsByLine } from '../../helpers/coverage-hits.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formats/simplecov.resultset.json',
);

describe('parseSimpleCov', () => {
  it('maps resultset line arrays (null = non-executable, index 0 = line 1)', () => {
    const files = parseSimpleCov(readFileSync(fixture, 'utf8'), '/repo');
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/auth.rb',
      'src/migrations/001.rb',
      'src/util.rb',
    ]);
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.rb'),
      'src/auth.rb',
    );
    expect(hitsByLine(files.find((f) => f.path === 'src/util.rb')!)).toEqual({
      2: 1,
      3: 1,
    });
  });

  it('accepts simplecov-json gem shape and legacy bare arrays', () => {
    const gem = {
      timestamp: 1710000000,
      command_name: 'RSpec',
      files: [
        {
          filename: '/repo/src/auth.rb',
          coverage: [3, null, null, null, 0, null, null, null, 2, 0],
        },
      ],
    };
    const files = parseSimpleCov(JSON.stringify(gem), '/repo');
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.rb'),
      'src/auth.rb',
    );

    const legacy = {
      RSpec: {
        coverage: {
          '/repo/src/auth.rb': [3, null, null, null, 0, null, null, null, 2, 0],
        },
      },
    };
    const legacyFiles = parseSimpleCov(JSON.stringify(legacy), '/repo');
    expectMixedHits(
      legacyFiles.find((f) => f.path === 'src/auth.rb'),
      'src/auth.rb',
    );
  });
});
