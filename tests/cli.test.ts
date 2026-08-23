import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  it('exposes name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('tested');
    expect(program.version()).toBe('0.1.5');
  });

  it('registers the push, doctor, and setup commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('push');
    expect(names).toContain('doctor');
    expect(names).toContain('setup');
  });

  it('orders commands by workflow', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual([
      'setup',
      'doctor',
      'init',
      'run',
      'diff',
      'check',
      'push',
      'explain',
      'ignores',
    ]);
  });

  it('description mentions agent loop', () => {
    const program = createProgram();
    expect(program.description()).toMatch(/agent loop/i);
    expect(program.description()).toMatch(/tested run/);
    expect(program.description()).toMatch(/tested setup/);
  });
});
