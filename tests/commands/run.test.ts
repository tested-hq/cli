import { describe, it, expect } from 'vitest';
import {
  resolveRunCommand,
  shouldEnforceSafeRun,
  assertSafeRunArgs,
} from '../../src/commands/run.js';

describe('resolveRunCommand', () => {
  it('uses npx vitest with --coverage by default', () => {
    expect(resolveRunCommand({ runner: null, extraArgs: [] })).toEqual({
      command: 'npx',
      args: ['vitest', 'run', '--coverage', '--coverage.reportOnFailure'],
    });
  });

  it('appends extra args verbatim', () => {
    expect(
      resolveRunCommand({
        runner: null,
        extraArgs: ['src/auth.test.ts', '--reporter=verbose'],
      }),
    ).toEqual({
      command: 'npx',
      args: [
        'vitest',
        'run',
        '--coverage',
        '--coverage.reportOnFailure',
        'src/auth.test.ts',
        '--reporter=verbose',
      ],
    });
  });
});

describe('resolveRunCommand with runner param', () => {
  it('dispatches vitest correctly', () => {
    const r = resolveRunCommand({ runner: 'vitest', extraArgs: [] });
    expect(r).toEqual({
      command: 'npx',
      args: ['vitest', 'run', '--coverage', '--coverage.reportOnFailure'],
    });
  });

  it('dispatches jest correctly', () => {
    const r = resolveRunCommand({ runner: 'jest', extraArgs: [] });
    expect(r).toEqual({ command: 'npx', args: ['jest', '--coverage'] });
  });

  it('dispatches pytest correctly', () => {
    const r = resolveRunCommand({ runner: 'pytest', extraArgs: [] });
    expect(r).toEqual({
      command: 'python',
      args: ['-m', 'pytest', '--cov'],
    });
  });

  it('throws on unknown runner', () => {
    expect(() =>
      resolveRunCommand({ runner: 'mocha' as never, extraArgs: [] }),
    ).toThrow(/unsupported runner/i);
  });

  it('defaults to vitest when runner is null', () => {
    const r = resolveRunCommand({ runner: null, extraArgs: [] });
    expect(r.args).toContain('vitest');
  });
});

describe('shouldEnforceSafeRun', () => {
  it('enforces when TESTED_SAFE_RUN=1', () => {
    expect(
      shouldEnforceSafeRun({ env: { TESTED_SAFE_RUN: '1' }, isTTY: true }),
    ).toBe(true);
  });

  it('enforces in CI even on a TTY', () => {
    expect(shouldEnforceSafeRun({ env: { CI: 'true' }, isTTY: true })).toBe(
      true,
    );
  });

  it('enforces when non-interactive', () => {
    expect(shouldEnforceSafeRun({ env: {}, isTTY: false })).toBe(true);
  });

  it('allows interactive local use without flags', () => {
    expect(shouldEnforceSafeRun({ env: {}, isTTY: true })).toBe(false);
  });
});

describe('assertSafeRunArgs', () => {
  const root = '/repo';

  it('allows benign args', () => {
    expect(() =>
      assertSafeRunArgs(['src/a.test.ts', '--reporter=verbose'], root),
    ).not.toThrow();
  });

  it('rejects --watch and --watchAll', () => {
    expect(() => assertSafeRunArgs(['--watch'], root)).toThrow(/watch/);
    expect(() => assertSafeRunArgs(['--watchAll'], root)).toThrow(/watch/);
    expect(() => assertSafeRunArgs(['-w'], root)).toThrow(/watch/);
  });

  it('rejects --config paths outside the repo root', () => {
    expect(() =>
      assertSafeRunArgs(['--config', '/etc/evil.config.js'], root),
    ).toThrow(/escapes/);
    expect(() =>
      assertSafeRunArgs(['--config=../outside/vitest.config.ts'], root),
    ).toThrow(/escapes/);
  });

  it('allows --config paths inside the repo', () => {
    expect(() =>
      assertSafeRunArgs(['--config', 'vitest.config.ts'], root),
    ).not.toThrow();
    expect(() =>
      assertSafeRunArgs(['--config=/repo/vitest.config.ts'], root),
    ).not.toThrow();
  });
});
