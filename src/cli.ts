import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerRunCommand } from './commands/run.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerCheckCommand } from './commands/check.js';
import { registerPushCommand } from './commands/push.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerIgnoresCommand } from './commands/ignores.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description(
      [
        'Coverage your agent can use.',
        '',
        'Agent loop:',
        '  tested setup → tested run → tested diff → tested check → tested push --pr <n>',
      ].join('\n'),
    )
    .version('0.1.1');

  // Workflow order: setup/doctor → init → run → diff → check → push → explain → ignores
  registerSetupCommand(program);
  registerDoctorCommand(program);
  registerInitCommand(program);
  registerRunCommand(program);
  registerDiffCommand(program);
  registerCheckCommand(program);
  registerPushCommand(program);
  registerExplainCommand(program);
  registerIgnoresCommand(program);
  return program;
}
