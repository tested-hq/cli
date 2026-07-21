import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiff } from '../core/computeDiff.js';
import type { DiffOutput, TestedConfig } from '../schemas.js';
import { badge, dim, heading, tip } from '../output/ui.js';

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

function formatMetricLine(
  label: string,
  pct: number,
  threshold: number,
  pass: boolean,
): string {
  const pctStr = pct.toFixed(1);
  const status = pass ? badge('pass') : badge('fail');
  return `  ${label.padEnd(8)}  ${pctStr}%  (threshold ${threshold})  ${status}`;
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

  // Single clear layout on stdout (no duplicate FAIL on stderr).
  const lines: string[] = [];
  lines.push(
    `${heading('tested.dev — coverage gate')}  ${overall === 'pass' ? badge('pass') : badge('fail')}`,
  );
  lines.push('');
  lines.push(formatMetricLine('Patch', patchPct, patchThreshold, patchPass));
  lines.push(formatMetricLine('Project', projectPct, projectThreshold, projectPass));
  if (overall === 'fail') {
    lines.push('');
    lines.push(tip('add tests for uncovered ranges: tested diff'));
  } else {
    lines.push('');
    lines.push(dim('thresholds met'));
  }
  lines.push('');

  return {
    skipped: false,
    patchPass,
    projectPass,
    overall,
    stdout: lines.join('\n'),
    stderr: '',
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
      try {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
