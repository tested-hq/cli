import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invokeCli } from './helpers/invoke-cli.js';
import { makeTempRepo } from './helpers/temp-repo.js';

const YAML_WITH_THRESHOLDS = [
  'base: main',
  'testRunner: vitest',
  'thresholds:',
  '  patch: 80',
  '  project: 10',
  '',
].join('\n');

const YAML_NO_THRESHOLDS = ['base: main', 'testRunner: vitest', ''].join('\n');

let repo: string;
let noThresholdsRepo: string;
let missingCoverageRepo: string;

beforeAll(async () => {
  const a = await makeTempRepo({
    yaml: YAML_WITH_THRESHOLDS,
    hits: [1, 1, 0],
  });
  repo = a.repo;

  const b = await makeTempRepo({ yaml: YAML_NO_THRESHOLDS, hits: [1, 1, 0] });
  noThresholdsRepo = b.repo;

  const c = await makeTempRepo({ yaml: YAML_WITH_THRESHOLDS, hits: [1, 0, 0] });
  missingCoverageRepo = c.repo;
  await rm(join(missingCoverageRepo, 'coverage'), { recursive: true, force: true });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(noThresholdsRepo, { recursive: true, force: true });
  await rm(missingCoverageRepo, { recursive: true, force: true });
});

describe.sequential('public CLI commands (in-process)', () => {
  describe('tested diff', () => {
    it('prints a human report and exits 0', async () => {
      const result = await invokeCli(['diff', '--base', 'main'], { cwd: repo });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('coverage report');
      expect(result.stdout).toContain('Patch');
      expect(result.stdout).toContain('Project');
    });

    it('emits schema-v1 JSON with --json', async () => {
      const result = await invokeCli(['diff', '--base', 'main', '--json'], {
        cwd: repo,
      });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        base: string;
        patch: { executable: number };
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.base).toBe('main');
      expect(parsed.patch.executable).toBeGreaterThan(0);
    });

    it('accepts --with-base-coverage and still exits 0', async () => {
      const baseline = join(repo, 'coverage', 'baseline.json');
      await writeFile(
        baseline,
        await import('node:fs/promises').then((fs) =>
          fs.readFile(join(repo, 'coverage/coverage-final.json'), 'utf8'),
        ),
      );
      const result = await invokeCli(
        ['diff', '--base', 'main', '--json', '--with-base-coverage', 'coverage/baseline.json'],
        { cwd: repo },
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { project: { delta: number | null } };
      expect(parsed.project.delta).toBe(0);
    });

    it('writes a guided error when coverage is missing', async () => {
      const result = await invokeCli(['diff', '--base', 'main'], {
        cwd: missingCoverageRepo,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/coverage file missing|coverage-final\.json not found/i);
    });
  });

  describe('tested check', () => {
    it('skips the gate when thresholds are absent', async () => {
      const result = await invokeCli(['check'], { cwd: noThresholdsRepo });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('no thresholds');
    });

    it('evaluates thresholds and exits 1 when patch is under the floor', async () => {
      const result = await invokeCli(['check', '--base', 'main'], { cwd: repo });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('coverage gate');
      expect(result.stdout).toContain('[FAIL]');
    });

    it('emits machine JSON with --json', async () => {
      const result = await invokeCli(['check', '--base', 'main', '--json'], {
        cwd: repo,
      });
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout) as { overall: string };
      expect(parsed.overall).toBe('fail');
    });

    it('writes a CLI error when computeDiff cannot find coverage', async () => {
      const result = await invokeCli(['check', '--base', 'main'], {
        cwd: missingCoverageRepo,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/coverage file missing|coverage-final\.json not found/i);
    });
  });

  describe('tested explain', () => {
    it('explains an uncovered line in human form', async () => {
      const result = await invokeCli(['explain', 'src/auth.ts:3'], { cwd: repo });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('explain');
      expect(result.stdout).toContain('src/auth.ts:3');
      expect(result.stdout).toMatch(/UNCOVERED|no test exercises/);
    });

    it('emits JSON for a covered line', async () => {
      const result = await invokeCli(['explain', 'src/auth.ts:1', '--json'], {
        cwd: repo,
      });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        uncovered: boolean;
        path: string;
        line: number;
      };
      expect(parsed.path).toBe('src/auth.ts');
      expect(parsed.line).toBe(1);
      expect(parsed.uncovered).toBe(false);
    });

    it('exits 2 when the file has no coverage data', async () => {
      const result = await invokeCli(['explain', 'src/missing.ts:1'], { cwd: repo });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/no coverage data/);
    });

    it('exits 1 on a bad location', async () => {
      const result = await invokeCli(['explain', 'not-a-location'], { cwd: repo });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/expected <file>:<line>/);
    });
  });

  describe('tested ignores list', () => {
    it('prints merged ignore patterns', async () => {
      const result = await invokeCli(['ignores', 'list'], { cwd: repo });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/tests\/\*\*|scripts\/\*\*/);
    });

    it('prints JSON with --json', async () => {
      const result = await invokeCli(['ignores', 'list', '--json'], { cwd: repo });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { ignores: string[] };
      expect(parsed.ignores.length).toBeGreaterThan(0);
    });
  });

  describe('tested doctor', () => {
    it('runs against a real repo and prints a checklist', async () => {
      const result = await invokeCli(['doctor'], { cwd: repo });
      expect(result.stdout).toContain('doctor');
      expect(result.stdout).toMatch(/\[PASS\]|\[FAIL\]|\[WARN\]/);
    });

    it('emits JSON with --json', async () => {
      const result = await invokeCli(['doctor', '--json'], { cwd: repo });
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        checks: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(Array.isArray(parsed.checks)).toBe(true);
    });
  });

  describe('tested setup', () => {
    it('skips init when .tested.yaml exists and prints guidance', async () => {
      const result = await invokeCli(['setup'], { cwd: repo });
      expect(result.stdout).toContain('setup');
      expect(result.stdout).toMatch(/already present|CI snippet|tested run/);
    });

    it('emits JSON with --json', async () => {
      const result = await invokeCli(['setup', '--json'], { cwd: repo });
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        initRan: boolean;
        pinnedCli: string;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.initRan).toBe(false);
      expect(parsed.pinnedCli).toBe('@tested/cli');
    });

    it('refuses --hooks in a non-TTY without --force', async () => {
      const result = await invokeCli(['setup', '--hooks'], { cwd: repo });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--hooks/);
    });
  });

  describe('tested init', () => {
    it('writes .tested.yaml in a fresh project', async () => {
      const fresh = await makeTempRepo();
      await rm(join(fresh.repo, '.tested.yaml'), { force: true });
      try {
        const result = await invokeCli(['init', '--no-hooks'], { cwd: fresh.repo });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/init|\.tested\.yaml/);
      } finally {
        await rm(fresh.repo, { recursive: true, force: true });
      }
    });

    it('prints a human error when .tested.yaml already exists', async () => {
      const result = await invokeCli(['init', '--no-hooks'], { cwd: repo });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/already exists/);
    });
  });

  describe('tested push', () => {
    it('exits 1 with token guidance when no token is configured', async () => {
      const envToken = process.env.TESTED_TOKEN;
      const envIngest = process.env.TESTED_INGEST_TOKEN;
      const envFile = process.env.TESTED_TOKEN_FILE;
      delete process.env.TESTED_TOKEN;
      delete process.env.TESTED_INGEST_TOKEN;
      delete process.env.TESTED_TOKEN_FILE;
      try {
        const result = await invokeCli(['push', '--pr', '1'], { cwd: repo });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/missing ingest token|TESTED_TOKEN/i);
      } finally {
        if (envToken !== undefined) process.env.TESTED_TOKEN = envToken;
        if (envIngest !== undefined) process.env.TESTED_INGEST_TOKEN = envIngest;
        if (envFile !== undefined) process.env.TESTED_TOKEN_FILE = envFile;
      }
    });
  });

  describe('tested run (safe-run denylist)', () => {
    it('rejects --watch without spawning a runner', async () => {
      const result = await invokeCli(['run', '--watch'], { cwd: repo });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/watch/);
    });
  });
});

describe('tested explain — source path boundary', () => {
  it('exits 2 when the explained path is not in coverage data', async () => {
    const result = await invokeCli(['explain', '../secret.ts:1'], { cwd: repo });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/no coverage data/);
  });
});
