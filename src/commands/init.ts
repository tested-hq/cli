import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { simpleGit } from 'simple-git';
import {
  dim,
  errorBlock,
  heading,
  nextSteps,
  successLine,
} from '../output/ui.js';
import pc from 'picocolors';

export type TestRunner = 'vitest' | 'jest' | 'pytest';

export interface DetectedProject {
  hasPackageJson: boolean;
  testRunner: TestRunner | null;
  defaultBranch: string;
}

export interface InitResult {
  configPath: string;
  configWritten: boolean;
  hookInstalled: boolean;
  hookPath: string | null;
  detected: DetectedProject;
  nextSteps: string[];
  warnings: string[];
}

export interface InitJsonOutput extends InitResult {
  schemaVersion: 1;
}

const INIT_YAML_HEADER = '# Config schema — see https://tested.dev/docs/config\n';

const DEFAULT_INIT_IGNORES: readonly string[] = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
];

export function detectTestRunner(cwd: string): TestRunner | null {
  const vitestCandidates = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'];
  for (const f of vitestCandidates) {
    if (existsSync(join(cwd, f))) return 'vitest';
  }
  const jestCandidates = ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'];
  for (const f of jestCandidates) {
    if (existsSync(join(cwd, f))) return 'jest';
  }
  if (existsSync(join(cwd, 'pyproject.toml'))) return 'pytest';
  return null;
}

export async function detectDefaultBranch(cwd: string): Promise<string> {
  try {
    const git = simpleGit({ baseDir: cwd });
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return 'main';
    try {
      const ref = (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
      // form: refs/remotes/origin/<branch>
      const branch = ref.replace(/^refs\/remotes\/origin\//, '');
      if (branch) return branch;
    } catch {
      // no origin/HEAD — fall through
    }
    return 'main';
  } catch {
    return 'main';
  }
}

export async function detectProject(cwd: string): Promise<DetectedProject> {
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  const testRunner = detectTestRunner(cwd);
  const defaultBranch = await detectDefaultBranch(cwd);
  return { hasPackageJson, testRunner, defaultBranch };
}

export interface BuildInitYamlArgs {
  base: string;
  testRunner: TestRunner | null;
}

export function buildInitYaml(args: BuildInitYamlArgs): string {
  const lines: string[] = [];
  lines.push(INIT_YAML_HEADER.trimEnd());
  lines.push(`base: ${args.base}`);
  if (args.testRunner) {
    lines.push(`testRunner: ${args.testRunner}`);
  }
  lines.push('# Patch gate is skipped when the diff has no executable lines');
  lines.push('# (tests-only, comments-only, docs-only, or ignored files).');
  lines.push('thresholds:');
  lines.push('  patch: 80');
  lines.push('  project: 60');
  lines.push('ignores:');
  for (const pattern of DEFAULT_INIT_IGNORES) {
    lines.push(`  - "${pattern}"`);
  }
  return lines.join('\n') + '\n';
}

function hasHuskyDevDep(pkgJsonPath: string): boolean {
  try {
    const raw = readFileSync(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(raw) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    return Boolean(pkg.devDependencies?.husky || pkg.dependencies?.husky);
  } catch {
    return false;
  }
}

const PRE_PUSH_HOOK_BODY = `#!/usr/bin/env sh
# Installed by \`tested init\`. Skip with \`git push --no-verify\`.
tested diff
`;

export interface RunInitOpts {
  cwd: string;
  force: boolean;
  hooks: boolean;
}

export async function runInit(opts: RunInitOpts): Promise<InitResult> {
  const { cwd, force, hooks } = opts;
  const pkgJsonPath = join(cwd, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      `No package.json found at ${cwd}. Run \`tested init\` from the root of a Node.js project.`,
    );
  }

  const configPath = join(cwd, '.tested.yaml');
  if (existsSync(configPath) && !force) {
    throw new Error(
      `.tested.yaml already exists at ${configPath}. Pass --force to overwrite.`,
    );
  }

  const detected = await detectProject(cwd);
  const yamlText = buildInitYaml({ base: detected.defaultBranch, testRunner: detected.testRunner });
  writeFileSync(configPath, yamlText, 'utf8');

  const warnings: string[] = [];
  let hookInstalled = false;
  let hookPath: string | null = null;

  if (hooks) {
    if (!hasHuskyDevDep(pkgJsonPath)) {
      warnings.push('husky is not a devDependency; skipped pre-push hook install. Run `pnpm add -D husky` then re-run `tested init --force`.');
    } else {
      const huskyDir = join(cwd, '.husky');
      const huskyHook = join(huskyDir, 'pre-push');
      if (existsSync(huskyHook)) {
        warnings.push(`.husky/pre-push already exists; left untouched. Add \`tested diff\` to it manually if desired.`);
      } else {
        if (!existsSync(huskyDir)) mkdirSync(huskyDir, { recursive: true });
        writeFileSync(huskyHook, PRE_PUSH_HOOK_BODY, 'utf8');
        try {
          chmodSync(huskyHook, 0o755);
        } catch {
          // best effort
        }
        hookInstalled = true;
        hookPath = huskyHook;
      }
    }
  }

  // Real agent loop next steps.
  const nextStepsList = [
    '1. tested run',
    '2. tested diff',
    '3. tested push --pr <n>   (needs TESTED_TOKEN)',
    '4. optional: wire CI (GitHub Actions / husky pre-push)',
  ];

  return {
    configPath,
    configWritten: true,
    hookInstalled,
    hookPath,
    detected,
    nextSteps: nextStepsList,
    warnings,
  };
}

export function buildInitJsonOutput(result: InitResult): InitJsonOutput {
  return { schemaVersion: 1, ...result };
}

export function formatInitResultHuman(result: InitResult): string {
  const lines: string[] = [];
  lines.push(heading('tested.dev — init'));
  lines.push('');
  if (result.configWritten) {
    lines.push(successLine(`wrote ${pc.cyan(result.configPath)}`));
  }
  const runnerLabel = result.detected.testRunner ?? 'none detected';
  lines.push(dim(`  test runner: ${runnerLabel}`));
  lines.push(dim(`  base branch: ${result.detected.defaultBranch}`));
  if (result.hookInstalled && result.hookPath) {
    lines.push(successLine(`installed pre-push hook at ${pc.cyan(result.hookPath)}`));
  }
  if (result.warnings.length > 0) {
    lines.push('');
    for (const w of result.warnings) {
      lines.push(`${pc.yellow('!')} ${w}`);
    }
  }
  if (result.nextSteps.length > 0) {
    lines.push('');
    lines.push(nextSteps(result.nextSteps));
  }
  return lines.join('\n');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize tested.dev in the current project (writes .tested.yaml)')
    .option('--force', 'Overwrite an existing .tested.yaml', false)
    .option('--no-hooks', 'Skip installing the husky pre-push hook')
    .option('--json', 'Emit JSON instead of human text', false)
    .action(async (opts: { force: boolean; hooks: boolean; json: boolean }) => {
      try {
        if (opts.hooks && !process.stdin.isTTY && !opts.force) {
          process.stderr.write(
            errorBlock(
              '--hooks in a non-TTY environment requires --force to confirm',
              ['Would install a git hook unattended.'],
            ),
          );
          process.exit(1);
        }
        const result = await runInit({
          cwd: process.cwd(),
          force: opts.force,
          hooks: opts.hooks,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(buildInitJsonOutput(result), null, 2) + '\n');
        } else {
          process.stdout.write(formatInitResultHuman(result) + '\n');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          process.stderr.write(
            JSON.stringify({ schemaVersion: 1, error: message }, null, 2) + '\n',
          );
        } else {
          process.stderr.write(errorBlock(message));
        }
        process.exit(1);
      }
    });
}
