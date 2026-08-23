import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { invokeCli } from '../helpers/invoke-cli.js';

function fakeChild(exitCode: number): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', exitCode));
  return child;
}

function makeCwd(withCoverage: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'tested-run-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  writeFileSync(join(dir, '.tested.yaml'), 'testRunner: vitest\n');
  if (withCoverage) {
    mkdirSync(join(dir, 'coverage'));
    writeFileSync(join(dir, 'coverage/coverage-final.json'), '{}');
  }
  return dir;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe('tested run action', () => {
  it('spawns vitest with coverage and prints next-step tips on success', async () => {
    const cwd = makeCwd(true);
    spawnMock.mockImplementation(() => fakeChild(0));
    try {
      const result = await invokeCli(['run'], { cwd, waitForProcessExit: true });
      expect(result.exitCode).toBe(0);
      expect(spawnMock).toHaveBeenCalledOnce();
      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe('npx');
      expect(args).toEqual(
        expect.arrayContaining(['vitest', 'run', '--coverage', '--coverage.reportOnFailure']),
      );
      expect(result.stderr).toContain('running tests with coverage');
      expect(result.stderr).toContain('tested diff');
      expect(result.stderr).toContain('tested check');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('notes that coverage was still written when tests fail', async () => {
    const cwd = makeCwd(true);
    spawnMock.mockImplementation(() => fakeChild(1));
    try {
      const result = await invokeCli(['run', 'src/a.test.ts'], {
        cwd,
        waitForProcessExit: true,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/tests failed \(exit 1\); coverage still written/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('notes a missing coverage file when tests fail without writing one', async () => {
    const cwd = makeCwd(false);
    spawnMock.mockImplementation(() => fakeChild(2));
    try {
      const result = await invokeCli(['run'], { cwd, waitForProcessExit: true });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/no coverage file/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not forward --json to the runner and prints tested JSON', async () => {
    const cwd = makeCwd(true);
    spawnMock.mockImplementation(() => fakeChild(1));
    try {
      const result = await invokeCli(['run', '--json'], {
        cwd,
        waitForProcessExit: true,
      });
      expect(result.exitCode).toBe(1);
      expect(spawnMock).toHaveBeenCalledOnce();
      const [, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(args).not.toContain('--json');
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        exitCode: number;
        coverageWritten: boolean;
        args: string[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.exitCode).toBe(1);
      expect(parsed.coverageWritten).toBe(true);
      expect(parsed.args).not.toContain('--json');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects --config whose next token is another flag', async () => {
    const cwd = makeCwd(false);
    try {
      const result = await invokeCli(['run', '--config', '--reporter=verbose'], {
        cwd,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--config requires a path/);
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
