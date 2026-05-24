import { spawn } from 'node:child_process';
import { Command } from 'commander';

export interface ResolvedRun {
  command: string;
  args: string[];
}

export function resolveRunCommand(opts: { extraArgs: readonly string[] }): ResolvedRun {
  return {
    command: 'npx',
    args: ['vitest', 'run', '--coverage', ...opts.extraArgs],
  };
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description("Run the user's vitest suite with coverage enabled")
    .allowUnknownOption(true)
    .argument('[args...]', 'Extra arguments forwarded to vitest')
    .action((extraArgs: string[]) => {
      const { command, args } = resolveRunCommand({ extraArgs });
      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('exit', (code) => {
        process.exit(code ?? 1);
      });
    });
}
