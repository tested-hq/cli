import { Command } from 'commander';
import { registerDiffCommand } from './commands/diff.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description('Coverage your agent can use.')
    .version('0.0.1');
  registerDiffCommand(program);
  return program;
}
