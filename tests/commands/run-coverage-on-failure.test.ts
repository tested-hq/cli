import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveRunCommand } from '../../src/commands/run.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const vitestBin = join(repoRoot, 'node_modules', '.bin', 'vitest');

function writeFailingSuite(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fail-cov', type: 'module' }),
  );
  writeFileSync(
    join(dir, 'vitest.config.ts'),
    [
      "import { defineConfig } from 'vitest/config';",
      'export default defineConfig({',
      '  test: {',
      "    include: ['*.test.ts'],",
      "    coverage: { provider: 'v8', reporter: ['json'], reportsDirectory: './coverage' },",
      '  },',
      '});',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'fail.test.ts'),
    [
      "import { describe, it, expect } from 'vitest';",
      "describe('fail', () => {",
      '  it("fails", () => { expect(1).toBe(2); });',
      '});',
      '',
    ].join('\n'),
  );
}

function runVitest(dir: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(vitestBin, args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PATH: join(repoRoot, 'node_modules'),
    },
  });
}

describe('vitest coverage on test failure', () => {
  it('does not write coverage-final.json without reportOnFailure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-cov-off-'));
    try {
      writeFailingSuite(dir);
      const result = runVitest(dir, ['run', '--coverage']);
      expect(result.status).not.toBe(0);
      expect(existsSync(join(dir, 'coverage', 'coverage-final.json'))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes coverage-final.json when using tested run flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-cov-on-'));
    try {
      writeFailingSuite(dir);
      const resolved = resolveRunCommand({ runner: 'vitest', extraArgs: [] });
      expect(resolved.args).toContain('--coverage.reportOnFailure');
      const result = runVitest(dir, resolved.args.slice(1));
      expect(result.status).not.toBe(0);
      expect(existsSync(join(dir, 'coverage', 'coverage-final.json'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
