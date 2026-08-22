import { existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import type { TestRunner } from './init.js';
import { dim, errorBlock, heading, tip } from '../output/ui.js';

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
      // reportOnFailure: Vitest default is false, so a failing suite writes
      // no coverage/coverage-final.json and tested diff then errors missing file.
      return {
        command: 'npx',
        args: [
          'vitest',
          'run',
          '--coverage',
          '--coverage.reportOnFailure',
          ...opts.extraArgs,
        ],
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

/**
 * Whether to enforce the safe-run arg denylist.
 *
 * On when:
 *   - TESTED_SAFE_RUN=1 / true, or
 *   - CI is set (CI=1/true or common CI indicators), or
 *   - stdin is not a TTY (non-interactive / scripted)
 */
export function shouldEnforceSafeRun(opts?: {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}): boolean {
  const env = opts?.env ?? process.env;
  const safe = env.TESTED_SAFE_RUN;
  if (safe === '1' || safe === 'true') return true;
  if (safe === '0' || safe === 'false') {
    // Explicit opt-out still honors CI for safety in pipelines.
  }
  const ci = env.CI;
  if (ci === '1' || ci === 'true') return true;
  // Common CI env markers
  if (env.GITHUB_ACTIONS === 'true' || env.GITLAB_CI === 'true') return true;

  const isTTY =
    opts?.isTTY ??
    Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY) return true;
  return false;
}

function configPathEscapesRoot(configPath: string, repoRoot: string): boolean {
  const root = resolve(repoRoot);
  const abs = isAbsolute(configPath)
    ? resolve(configPath)
    : resolve(repoRoot, configPath);
  const safeRoot = root.endsWith(sep) ? root : root + sep;
  return !(abs === root || abs.startsWith(safeRoot));
}

/**
 * Reject runner flags that are dangerous in non-interactive / CI contexts:
 * watch mode (hangs CI) and --config paths that escape the repository root.
 */
export function assertSafeRunArgs(
  extraArgs: readonly string[],
  repoRoot: string,
): void {
  for (let i = 0; i < extraArgs.length; i++) {
    const a = extraArgs[i]!;

    if (
      a === '--watch' ||
      a === '--watchAll' ||
      a === '-w' ||
      a.startsWith('--watch=') ||
      a.startsWith('--watchAll=')
    ) {
      throw new Error(
        `unsafe run arg rejected in non-interactive/CI mode: ${a} ` +
          `(watch mode can hang pipelines; unset TESTED_SAFE_RUN only in interactive use)`,
      );
    }

    let configPath: string | undefined;
    if (a === '--config' || a === '-c') {
      configPath = extraArgs[i + 1];
    } else if (a.startsWith('--config=')) {
      configPath = a.slice('--config='.length);
    }

    if (configPath !== undefined) {
      if (!configPath || configPath.startsWith('-')) {
        throw new Error(
          `unsafe run arg rejected: --config requires a path under the repository root`,
        );
      }
      if (configPathEscapesRoot(configPath, repoRoot)) {
        throw new Error(
          `unsafe run arg rejected: --config path escapes repository root: ${configPath}`,
        );
      }
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
      try {
        if (shouldEnforceSafeRun()) {
          assertSafeRunArgs(extraArgs, cwd);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(errorBlock(message));
        process.exitCode = 1;
        return;
      }

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
