import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('tested')
    .description('Coverage your agent can use.')
    .version('0.0.1');
  return program;
}
