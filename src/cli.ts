import { Command } from 'commander';
import { registerDiffCommand } from './commands/diff.js';
import { registerRunCommand } from './commands/run.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerIgnoresCommand } from './commands/ignores.js';
import { registerInitCommand } from './commands/init.js';
import { registerCheckCommand } from './commands/check.js';
import { registerPushCommand } from './commands/push.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description('Coverage your agent can use.')
    .version('0.0.1');
  registerInitCommand(program);
  registerDiffCommand(program);
  registerCheckCommand(program);
  registerPushCommand(program);
  registerRunCommand(program);
  registerExplainCommand(program);
  registerIgnoresCommand(program);
  return program;
}
