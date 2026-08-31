import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../action/run-check.sh');
const actionYml = join(here, '../../action/action.yml');

function mockTested(dir: string): { bin: string; log: string } {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'tested-argv.log');
  writeFileSync(
    join(bin, 'tested'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
`,
  );
  chmodSync(join(bin, 'tested'), 0o755);
  return { bin, log };
}

function runCheck(
  env: Record<string, string>,
  bin: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bash', [script], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      ACTION_PATH: join(here, '../../action'),
      INPUT_BASE: 'HEAD',
      ...env,
    },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

describe('action.yml check wiring', () => {
  it('routes check through run-check.sh with files/parts/complete env', () => {
    const yml = readFileSync(actionYml, 'utf8');
    expect(yml).toContain('run-check.sh');
    expect(yml).toContain('INPUT_FILES: ${{ inputs.files }}');
    expect(yml).toContain('INPUT_PARTS: ${{ inputs.parts }}');
    expect(yml).toContain('INPUT_COMPLETE: ${{ inputs.complete }}');
    expect(yml).toMatch(/files:/);
    expect(yml).toMatch(/parts:/);
    expect(yml).toMatch(/complete:/);
    expect(yml).not.toContain('tested check --base "$BASE"\n');
  });
});

describe('run-check.sh', () => {
  it('passes --file for each coverage path and --parts/--part', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-check-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runCheck(
        {
          INPUT_FILES: 'coverage/lcov.info,coverage/python.xml',
          INPUT_PARTS: '2',
          INPUT_PART: '1',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--file coverage/lcov.info');
      expect(argv).toContain('--file coverage/python.xml');
      expect(argv).toContain('--parts 2');
      expect(argv).toContain('--part 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --incomplete when complete=false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-check-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runCheck({ INPUT_COMPLETE: 'false' }, bin);
      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toContain('--incomplete');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --complete when complete=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-check-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runCheck({ INPUT_COMPLETE: 'true' }, bin);
      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toContain('--complete');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
