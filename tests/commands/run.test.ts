import { describe, it, expect } from 'vitest';
import { resolveRunCommand } from '../../src/commands/run.js';

describe('resolveRunCommand', () => {
  it('uses npx vitest with --coverage by default', () => {
    expect(resolveRunCommand({ extraArgs: [] })).toEqual({
      command: 'npx',
      args: ['vitest', 'run', '--coverage'],
    });
  });

  it('appends extra args verbatim', () => {
    expect(resolveRunCommand({ extraArgs: ['src/auth.test.ts', '--reporter=verbose'] }))
      .toEqual({
        command: 'npx',
        args: ['vitest', 'run', '--coverage', 'src/auth.test.ts', '--reporter=verbose'],
      });
  });
});
