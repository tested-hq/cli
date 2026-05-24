import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  it('exposes name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('tested');
    expect(program.version()).toBe('0.0.1');
  });
});
