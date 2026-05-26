import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiff } from '../core/computeDiff.js';
import type { DiffOutput, TestedConfig } from '../schemas.js';

export interface CheckInput {
  config: TestedConfig;
  diff: DiffOutput;
  json: boolean;
}

export interface CheckResult {
  /** True when thresholds were missing from config — gate was not evaluated. */
  skipped: boolean;
  patchPass: boolean;
  projectPass: boolean;
  overall: 'pass' | 'fail';
  /** Content the CLI should write to stdout (with trailing newline). */
  stdout: string;
  /** Content the CLI should write to stderr (with trailing newline). */
  stderr: string;
  /** Process exit code (0 = pass / skipped, 1 = fail). */
  exitCode: 0 | 1;
}

/**
 * Pure function: given a loaded config + a precomputed DiffOutput, decide
 * whether the gate passes and produce stdout/stderr buffers + an exit code.
 *
 * Kept free of process.* / fs / network so it's trivially unit-testable.
 */
export function runCheck(input: CheckInput): CheckResult {
  const { config, diff, json } = input;

  if (!config.thresholds) {
    return {
      skipped: true,
      patchPass: true,
      projectPass: true,
      overall: 'pass',
      stdout: '',
      stderr: 'no thresholds configured in .tested.yaml — skipping gate check\n',
      exitCode: 0,
    };
  }

  const patchPct = diff.patch.pct;
  const projectPct = diff.project.pct;
  const patchThreshold = config.thresholds.patch;
  const projectThreshold = config.thresholds.project;

  const patchPass = patchPct >= patchThreshold;
  const projectPass = projectPct >= projectThreshold;
  const overall: 'pass' | 'fail' = patchPass && projectPass ? 'pass' : 'fail';
  const exitCode: 0 | 1 = overall === 'pass' ? 0 : 1;

  if (json) {
    const payload = {
      patch: { pct: patchPct, threshold: patchThreshold, pass: patchPass },
      project: { pct: projectPct, threshold: projectThreshold, pass: projectPass },
      overall,
    };
    return {
      skipped: false,
      patchPass,
      projectPass,
      overall,
      stdout: JSON.stringify(payload) + '\n',
      stderr: '',
      exitCode,
    };
  }

  const patchIcon = patchPass ? '✅' : '❌';
  const projectIcon = projectPass ? '✅' : '❌';
  const patchLabel = patchPass ? 'pass' : 'fail';
  const projectLabel = projectPass ? 'pass' : 'fail';
  const patchPctStr = patchPct.toFixed(1);
  const projectPctStr = projectPct.toFixed(1);

  const stderr =
    `${patchIcon} patch coverage ${patchPctStr}% (threshold ${patchThreshold}) — ${patchLabel}\n` +
    `${projectIcon} project coverage ${projectPctStr}% (threshold ${projectThreshold}) — ${projectLabel}\n`;
  const stdout =
    `PATCH: ${patchPctStr}% / ${patchThreshold}% — ${patchLabel.toUpperCase()}\n` +
    `PROJECT: ${projectPctStr}% / ${projectThreshold}% — ${projectLabel.toUpperCase()}\n`;

  return {
    skipped: false,
    patchPass,
    projectPass,
    overall,
    stdout,
    stderr,
    exitCode,
  };
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description(
      'Exit non-zero if patch or project coverage falls below configured thresholds.',
    )
    .option('--json', 'Emit machine-readable JSON to stdout (exit code unchanged).', false)
    .option('--base <ref>', 'Git base ref to diff against', undefined)
    .action(async (opts: { json: boolean; base?: string }) => {
      const cwd = process.cwd();
      const config = await loadConfig({ cwd });

      // Short-circuit before we spend time on git/coverage parsing when there's
      // nothing to enforce.
      if (!config.thresholds) {
        const result = runCheck({
          config,
          // diff value is unused in the skip path; pass a stub.
          diff: {
            schemaVersion: 1,
            base: '',
            head: '',
            patch: { executable: 0, covered: 0, pct: 0 },
            project: { executable: 0, covered: 0, pct: 0, delta: null },
            files: [],
            ignored: [],
          },
          json: opts.json,
        });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) process.stdout.write(result.stdout);
        process.exitCode = result.exitCode;
        return;
      }

      const diff = await computeDiff({
        cwd,
        config,
        ...(opts.base !== undefined ? { baseRef: opts.base } : {}),
      });
      const result = runCheck({ config, diff, json: opts.json });
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.stdout) process.stdout.write(result.stdout);
      // NB: use exitCode (not process.exit) so buffered stdout fully flushes.
      process.exitCode = result.exitCode;
    });
}
