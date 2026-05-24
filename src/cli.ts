import { Command } from 'commander';
import { registerDiffCommand } from './commands/diff.js';
import { registerRunCommand } from './commands/run.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerIgnoresCommand } from './commands/ignores.js';
import { registerInitCommand } from './commands/init.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description('Coverage your agent can use.')
    .version('0.0.1');
  registerInitCommand(program);
  registerDiffCommand(program);
  registerRunCommand(program);
  registerExplainCommand(program);
  registerIgnoresCommand(program);
  return program;
}
