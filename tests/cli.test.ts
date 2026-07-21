import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  it('exposes name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('tested');
    expect(program.version()).toBe('0.0.1');
  });

  it('registers the push command', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('push');
  });
});
