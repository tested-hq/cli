import { describe, it, expect } from 'vitest';
import { resolveRunCommand } from '../../src/commands/run.js';

describe('resolveRunCommand', () => {
  it('uses npx vitest with --coverage by default', () => {
    expect(resolveRunCommand({ runner: null, extraArgs: [] })).toEqual({
      command: 'npx',
      args: ['vitest', 'run', '--coverage'],
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
        'src/auth.test.ts',
        '--reporter=verbose',
      ],
    });
  });
});

describe('resolveRunCommand with runner param', () => {
  it('dispatches vitest correctly', () => {
    const r = resolveRunCommand({ runner: 'vitest', extraArgs: [] });
    expect(r).toEqual({ command: 'npx', args: ['vitest', 'run', '--coverage'] });
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
