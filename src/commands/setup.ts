import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  formatInitResultHuman,
  runInit,
  type InitResult,
} from './init.js';
import { runDoctor, type DoctorResult } from './doctor.js';
import {
  dim,
  errorBlock,
  formatCliError,
  heading,
  nextSteps,
  tip,
} from '../output/ui.js';
import pc from 'picocolors';
import {
  INGEST_TOKEN_ENV_NAMES,
  INGEST_TOKEN_SETTINGS_URL_SHAPE,
} from '../token-help.js';

/** npm package name for local / agent installs. */
export const PINNED_CLI = '@tested/cli';

/** CI snippet printed by `tested setup`. */
export function buildCiSnippet(): string {
  return [
    '# .github/workflows/tested.yml',
    'name: tested',
    'on: [pull_request]',
    'jobs:',
    '  coverage:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '      - uses: tested-hq/cli/action@main',
    '        with:',
    '          # pin ref for reproducible installs (do not use floating tags in prod)',
    '          cli-ref: main',
    '          push: true',
    '          pr-number: ${{ github.event.pull_request.number }}',
    '          token: ${{ secrets.TESTED_TOKEN }}',
  ].join('\n');
}

export function buildTokenInstructions(): string {
  return [
    'Ingest token (for tested push):',
    `  Mint: ${INGEST_TOKEN_SETTINGS_URL_SHAPE}`,
    `  Then set ${INGEST_TOKEN_ENV_NAMES.join(' / ')}`,
    '  Never commit the token. Prefer env / file over --token (visible in ps).',
  ].join('\n');
}

export function buildInstallInstructions(): string {
  return [
    'Install CLI:',
    `  pnpm add -D ${PINNED_CLI}`,
    `  # or: npx ${PINNED_CLI}`,
    '',
    '  CI: uses: tested-hq/cli/action@main  (secrets.TESTED_TOKEN)',
    '',
    '  # monorepo / local path:',
    '  pnpm install && pnpm build   # from a clone of tested-hq/cli',
  ].join('\n');
}

export interface SetupResult {
  initRan: boolean;
  initResult: InitResult | null;
  doctor: DoctorResult;
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

export interface SetupDeps {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  hooks?: boolean;
  json?: boolean;
  existsSyncFn?: typeof existsSync;
  runInitFn?: typeof runInit;
  runDoctorFn?: typeof runDoctor;
}

export function formatSetupHuman(opts: {
  initRan: boolean;
  initResult: InitResult | null;
  doctor: DoctorResult;
}): string {
  const lines: string[] = [];
  lines.push(heading('tested.dev — setup'));
  lines.push('');

  if (opts.initRan && opts.initResult) {
    lines.push(formatInitResultHuman(opts.initResult));
    lines.push('');
  } else if (!opts.initRan) {
    lines.push(dim('  .tested.yaml already present — skipped init'));
    lines.push('');
  }

  // Doctor body without re-printing outer heading polish twice: reuse stdout
  // from doctor (includes its own heading).
  lines.push(opts.doctor.stdout.trimEnd());
  lines.push('');

  lines.push(heading('CI snippet'));
  lines.push(pc.dim(buildCiSnippet()));
  lines.push('');

  lines.push(heading('Token'));
  for (const line of buildTokenInstructions().split('\n')) {
    lines.push(dim(`  ${line}`));
  }
  lines.push('');

  lines.push(heading('Install'));
  for (const line of buildInstallInstructions().split('\n')) {
    lines.push(dim(`  ${line}`));
  }
  lines.push('');

  lines.push(
    nextSteps([
      '1. tested run',
      '2. tested diff',
      '3. tested check',
      '4. tested push --pr <n>   (needs TESTED_TOKEN)',
    ]),
  );
  lines.push('');
  lines.push(tip('re-check anytime: tested doctor'));
  lines.push('');

  return lines.join('\n');
}

/**
 * First-10-minutes setup: init if needed, doctor, CI + token guidance.
 */
export async function runSetup(deps: SetupDeps): Promise<SetupResult> {
  const cwd = deps.cwd;
  const env = deps.env ?? process.env;
  const exists = deps.existsSyncFn ?? existsSync;
  const runInitFn = deps.runInitFn ?? runInit;
  const runDoctorFn = deps.runDoctorFn ?? runDoctor;
  const force = deps.force ?? false;
  const hooks = deps.hooks ?? false;
  const json = deps.json ?? false;

  const configPath = join(cwd, '.tested.yaml');
  let initRan = false;
  let initResult: InitResult | null = null;

  if (!exists(configPath) || force) {
    initResult = await runInitFn({
      cwd,
      force: force || exists(configPath),
      hooks,
    });
    initRan = true;
  }

  const doctor = await runDoctorFn({
    cwd,
    env,
    json: false, // always compute structured; re-encode below if needed
  });

  if (json) {
    const payload = {
      schemaVersion: 1,
      initRan,
      init: initResult,
      doctor: {
        ok: doctor.ok,
        exitCode: doctor.exitCode,
        checks: doctor.checks,
      },
      ciSnippet: buildCiSnippet(),
      tokenInstructions: buildTokenInstructions(),
      install: buildInstallInstructions(),
      pinnedCli: PINNED_CLI,
    };
    return {
      initRan,
      initResult,
      doctor,
      exitCode: doctor.exitCode,
      stdout: JSON.stringify(payload, null, 2) + '\n',
      stderr: '',
    };
  }

  const stdout = formatSetupHuman({ initRan, initResult, doctor });
  return {
    initRan,
    initResult,
    doctor,
    exitCode: doctor.exitCode,
    stdout,
    stderr: '',
  };
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description(
      'First-run setup: init if needed, doctor, CI snippet, token instructions',
    )
    .option('--force', 'Re-run init and overwrite .tested.yaml', false)
    .option('--hooks', 'Install husky pre-push hook during init', false)
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { force: boolean; hooks: boolean; json: boolean }) => {
      try {
        if (opts.hooks && !process.stdin.isTTY && !opts.force) {
          process.stderr.write(
            errorBlock(
              '--hooks in a non-TTY environment requires --force to confirm',
              ['Would install a git hook unattended.'],
            ),
          );
          process.exitCode = 1;
          return;
        }
        const result = await runSetup({
          cwd: process.cwd(),
          force: opts.force,
          hooks: opts.hooks,
          json: opts.json,
        });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) process.stdout.write(result.stdout);
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(formatCliError(message));
        process.exitCode = 1;
      }
    });
}
