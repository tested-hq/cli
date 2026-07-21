import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import type { TestRunner } from './init.js';
import { dim, heading, tip } from '../output/ui.js';

export interface ResolvedRun {
  command: string;
  args: string[];
}

export function resolveRunCommand(opts: {
  runner: TestRunner | null;
  extraArgs: readonly string[];
}): ResolvedRun {
  const runner: TestRunner = opts.runner ?? 'vitest';
  switch (runner) {
    case 'vitest':
      return {
        command: 'npx',
        args: ['vitest', 'run', '--coverage', ...opts.extraArgs],
      };
    case 'jest':
      return {
        command: 'npx',
        args: ['jest', '--coverage', ...opts.extraArgs],
      };
    case 'pytest':
      return {
        command: 'python',
        args: ['-m', 'pytest', '--cov', ...opts.extraArgs],
      };
    default: {
      // exhaustiveness check
      const _exhaustive: never = runner;
      void _exhaustive;
      throw new Error(
        `Unsupported runner: ${String(runner)}. Supported: vitest, jest, pytest`,
      );
    }
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description(
      "Run the user's test suite with coverage enabled (runner read from .tested.yaml; defaults to vitest)",
    )
    .allowUnknownOption(true)
    .argument('[args...]', 'Extra arguments forwarded to the runner')
    .action(async (extraArgs: string[]) => {
      const cwd = process.cwd();
      const config = await loadConfig({ cwd });
      const coveragePath = resolve(cwd, config.coverage.path);
      const { command, args } = resolveRunCommand({
        runner: config.testRunner,
        extraArgs,
      });

      process.stderr.write(heading('tested.dev — running tests with coverage') + '\n');
      process.stderr.write(dim(`${command} ${args.join(' ')}`) + '\n\n');

      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('exit', (code) => {
        const exit = code ?? 1;
        const coverageWritten = existsSync(coveragePath);
        if (exit === 0) {
          process.stderr.write('\n');
          process.stderr.write(tip('tested diff') + '\n');
          process.stderr.write(tip('tested check') + '\n');
        } else {
          process.stderr.write('\n');
          process.stderr.write(
            dim(
              coverageWritten
                ? `tests failed (exit ${exit}); coverage still written to ${config.coverage.path}`
                : `tests failed (exit ${exit}); no coverage file at ${config.coverage.path}`,
            ) + '\n',
          );
        }
        process.exit(exit);
      });
    });
}
