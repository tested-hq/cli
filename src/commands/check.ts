import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiffContext } from '../core/computeDiff.js';
import {
  formatIncompleteGateMessage,
  resolveCoverageMerge,
  type CoverageMergeCli,
  type CoverageMergeState,
} from '../core/coverage-merge.js';
import {
  collectCoverageFile,
  existingCoveragePaths,
  resolveCoveragePaths,
} from '../core/coverage-paths.js';
import {
  evaluateFlags,
  flagsPass,
  flagsToJson,
  type FlagCheckResult,
} from '../core/flags.js';
import type { FileCoverage } from '../core/istanbul.js';
import { EMPTY_PATCH_REASON, isEmptyPatch } from '../core/patch.js';
import type { DiffOutput, TestedConfig } from '../schemas.js';
import { badge, dim, heading, tip, formatCliError } from '../output/ui.js';

export interface CheckInput {
  config: TestedConfig;
  diff: DiffOutput;
  json: boolean;
  files?: readonly FileCoverage[];
  addedByFile?: ReadonlyMap<string, ReadonlySet<number>>;
  /** Action `flag` / `--flag`: this coverage file is the named flag. */
  onlyFlag?: string;
}

export interface CheckResult {
  /** True when thresholds were missing from config — gate was not evaluated. */
  skipped: boolean;
  patchPass: boolean;
  projectPass: boolean;
  overall: 'pass' | 'fail';
  flagResults: FlagCheckResult[];
  /** Content the CLI should write to stdout (with trailing newline). */
  stdout: string;
  /** Content the CLI should write to stderr (with trailing newline). */
  stderr: string;
  /** Process exit code (0 = pass / skipped, 1 = fail). */
  exitCode: 0 | 1;
}

export function formatIncompleteCheck(state: CoverageMergeState, json: boolean): CheckResult {
  const message = formatIncompleteGateMessage(state);
  if (json) {
    return {
      skipped: true,
      patchPass: true,
      projectPass: true,
      overall: 'pass',
      flagResults: [],
      stdout:
        JSON.stringify({
          overall: 'pending',
          complete: false,
          ...(state.part !== undefined ? { part: state.part } : {}),
          ...(state.totalParts !== undefined ? { totalParts: state.totalParts } : {}),
          note: message,
        }) + '\n',
      stderr: '',
      exitCode: 0,
    };
  }
  return {
    skipped: true,
    patchPass: true,
    projectPass: true,
    overall: 'pass',
    flagResults: [],
    stdout: '',
    stderr:
      `${dim('tested.dev — coverage gate')}  ${badge('info')}\n` +
      `\n` +
      `${dim(`  ${message}`)}\n` +
      `${tip('tested push --complete  (or --parts N --part N)')}\n`,
    exitCode: 0,
  };
}

export function formatCompleteHandshakeCheck(json: boolean): CheckResult {
  const note =
    'no local coverage files — complete handshake only. ' +
    'The app merges stored shards; this job does not evaluate the gate.';
  if (json) {
    return {
      skipped: true,
      patchPass: true,
      projectPass: true,
      overall: 'pass',
      flagResults: [],
      stdout: JSON.stringify({ overall: 'pending', complete: true, note }) + '\n',
      stderr: '',
      exitCode: 0,
    };
  }
  return {
    skipped: true,
    patchPass: true,
    projectPass: true,
    overall: 'pass',
    flagResults: [],
    stdout: '',
    stderr:
      `${dim('tested.dev — coverage gate')}  ${badge('info')}\n` +
      `\n` +
      `${dim(`  ${note}`)}\n`,
    exitCode: 0,
  };
}

function formatMetricLine(
  label: string,
  pct: number,
  threshold: number,
  pass: boolean,
  indent = '  ',
): string {
  const pctStr = pct.toFixed(1);
  const status = pass ? badge('pass') : badge('fail');
  return `${indent}${label.padEnd(8)}  ${pctStr}%  (threshold ${threshold})  ${status}`;
}

/**
 * Pure function: given a loaded config + a precomputed DiffOutput, decide
 * whether the gate passes and produce stdout/stderr buffers + an exit code.
 *
 * Kept free of process.* / fs / network so it's trivially unit-testable.
 */
function formatFlagLines(results: readonly FlagCheckResult[]): string[] {
  if (results.length === 0) return [];
  const lines: string[] = [''];
  for (const flag of results) {
    if (flag.status === 'missing') {
      lines.push(
        `  ${flag.name}  ${dim(flag.reason ?? 'missing this run')}  ${badge('missing')}`,
      );
      continue;
    }
    lines.push(`  ${flag.name}  ${flag.status === 'pass' ? badge('pass') : badge('fail')}`);
    if (flag.patch.skipped) {
      lines.push(
        `    ${'Patch'.padEnd(8)}  ${dim('-')}  ${EMPTY_PATCH_REASON}  ${badge('skip')}`,
      );
    } else {
      lines.push(
        formatMetricLine('Patch', flag.patch.pct, flag.patch.threshold, flag.patch.pass, '    '),
      );
    }
    lines.push(
      formatMetricLine(
        'Project',
        flag.project.pct,
        flag.project.threshold,
        flag.project.pass,
        '    ',
      ),
    );
  }
  return lines;
}

export function runCheck(input: CheckInput): CheckResult {
  const { config, diff, json } = input;

  if (!config.thresholds) {
    return {
      skipped: true,
      patchPass: true,
      projectPass: true,
      overall: 'pass',
      flagResults: [],
      stdout: '',
      stderr:
        `${dim('tested.dev — coverage gate')}  ${badge('info')}\n` +
        `\n` +
        `${dim('  no thresholds in .tested.yaml — gate skipped')}\n` +
        `${tip('add thresholds.patch / thresholds.project to enforce')}\n`,
      exitCode: 0,
    };
  }

  const patchPct = diff.patch.pct;
  const projectPct = diff.project.pct;
  const patchThreshold = config.thresholds.patch;
  const projectThreshold = config.thresholds.project;

  // Empty patch (0 executable lines) is not a gate failure — nothing in
  // scope changed that can be covered (tests-only, docs, comments, ignored).
  const patchSkipped = isEmptyPatch(diff.patch);
  const patchPass = patchSkipped ? true : patchPct >= patchThreshold;
  const projectPass = projectPct >= projectThreshold;

  const flagResults = evaluateFlags({
    config,
    files: input.files ?? [],
    addedByFile: input.addedByFile ?? new Map(),
    ...(input.onlyFlag !== undefined ? { onlyFlag: input.onlyFlag } : {}),
  });
  const flagsOk = flagsPass(flagResults);
  const overall: 'pass' | 'fail' =
    patchPass && projectPass && flagsOk ? 'pass' : 'fail';
  const exitCode: 0 | 1 = overall === 'pass' ? 0 : 1;

  if (json) {
    const payload = {
      patch: {
        pct: patchPct,
        threshold: patchThreshold,
        pass: patchPass,
        ...(patchSkipped
          ? { skipped: true as const, reason: EMPTY_PATCH_REASON }
          : {}),
      },
      project: { pct: projectPct, threshold: projectThreshold, pass: projectPass },
      ...(flagResults.length > 0 ? { flags: flagsToJson(flagResults) } : {}),
      overall,
      ...(patchSkipped ? { note: EMPTY_PATCH_REASON } : {}),
    };
    return {
      skipped: false,
      patchPass,
      projectPass,
      overall,
      flagResults,
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
  if (patchSkipped) {
    lines.push(
      `  ${'Patch'.padEnd(8)}  ${dim('-')}  ${EMPTY_PATCH_REASON}  ${badge('skip')}`,
    );
  } else {
    lines.push(formatMetricLine('Patch', patchPct, patchThreshold, patchPass));
  }
  lines.push(formatMetricLine('Project', projectPct, projectThreshold, projectPass));
  lines.push(...formatFlagLines(flagResults));
  if (overall === 'fail') {
    lines.push('');
    if (patchSkipped) {
      lines.push(dim('No executable lines in the patch — patch gate skipped.'));
    }
    const missing = flagResults.filter((f) => f.status === 'missing');
    if (missing.length > 0) {
      lines.push(
        dim(
          "Missing flags fail this run (no carryforward). Collect that package's coverage or scope the job with --flag.",
        ),
      );
    }
    lines.push(tip('add tests for uncovered ranges: tested diff'));
  } else {
    lines.push('');
    lines.push(
      dim(
        patchSkipped
          ? 'No executable lines in the patch — patch gate skipped. Project threshold met.'
          : 'thresholds met',
      ),
    );
  }
  lines.push('');

  return {
    skipped: false,
    patchPass,
    projectPass,
    overall,
    flagResults,
    stdout: lines.join('\n'),
    stderr: '',
    exitCode,
  };
}

export interface CheckCliOpts extends CoverageMergeCli {
  json: boolean;
  base?: string;
  file?: string[];
  flag?: string;
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description(
      'Exit non-zero if patch or project coverage falls below configured thresholds.',
    )
    .option('--json', 'Emit machine-readable JSON to stdout (exit code unchanged).', false)
    .option('--base <ref>', 'Git base ref to diff against', undefined)
    .option(
      '--file <path>',
      'Coverage file to merge (repeatable). Overrides coverage.path.',
      collectCoverageFile,
      [],
    )
    .option('--complete', 'Conclude the gate (last shard / finish job)', false)
    .option('--incomplete', 'Do not evaluate the gate (shard 1 of N)', false)
    .option('--parts <n>', 'Total shard count (gate waits until last part / --complete)')
    .option('--part <n>', '1-based shard index')
    .option(
      '--flag <name>',
      'Evaluate only this flag (job already scoped — the coverage file is the flag)',
    )
    .action(async (opts: CheckCliOpts) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig({ cwd });

        let merge: CoverageMergeState;
        try {
          merge = resolveCoverageMerge(opts);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(formatCliError(message));
          process.exitCode = 1;
          return;
        }

        // Incomplete shards must not post a passing (or failing) local gate.
        if (!merge.complete) {
          const result = formatIncompleteCheck(merge, opts.json);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.stdout) process.stdout.write(result.stdout);
          process.exitCode = result.exitCode;
          return;
        }

        const coveragePaths = resolveCoveragePaths({
          ...(opts.file && opts.file.length > 0 ? { files: opts.file } : {}),
          configPath: config.coverage.path,
        });
        const existing = existingCoveragePaths(coveragePaths, cwd, existsSync);
        const handshakeOnly =
          merge.complete &&
          existing.length === 0 &&
          (opts.complete || merge.totalParts !== undefined);
        if (handshakeOnly) {
          const result = formatCompleteHandshakeCheck(opts.json);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.stdout) process.stdout.write(result.stdout);
          process.exitCode = result.exitCode;
          return;
        }

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

        const { diff, files, addedByFile } = await computeDiffContext({
          cwd,
          config,
          ...(opts.base !== undefined ? { baseRef: opts.base } : {}),
          ...(coveragePaths.length > 0 ? { coveragePaths } : {}),
        });
        const result = runCheck({
          config,
          diff,
          json: opts.json,
          files,
          addedByFile,
          ...(opts.flag && opts.flag.trim() ? { onlyFlag: opts.flag.trim() } : {}),
        });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) process.stdout.write(result.stdout);
        // NB: use exitCode (not process.exit) so buffered stdout fully flushes.
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(formatCliError(message));
        process.exitCode = 1;
      }
    });
}
