import { Command } from 'commander';
import { registerDiffCommand } from './commands/diff.js';
import { registerRunCommand } from './commands/run.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description('Coverage your agent can use.')
    .version('0.0.1');
  registerDiffCommand(program);
  registerRunCommand(program);
  return program;
}
