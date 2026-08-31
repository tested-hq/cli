import { minimatch } from 'minimatch';
import type { FlagConfig, FlagMetricJson, FlagsJsonMap, TestedConfig } from '../schemas.js';
import type { FileCoverage } from './istanbul.js';
import {
  computePatchCoverage,
  EMPTY_PATCH_REASON,
  isEmptyPatch,
  type CoverageTotals,
} from './patch.js';
import { computeProjectCoverage } from './project.js';

/** A package not in this run's coverage — never last week's numbers. */
export const MISSING_FLAG_REASON = 'no coverage files matched this flag in this run';

export const SCOPED_MISSING_FLAG_REASON = 'no coverage files in this run for this flag';

export type FlagStatus = 'pass' | 'fail' | 'missing';

export interface FlagMetricResult {
  /** Omitted when this flag had no files this run (`skipped: true`). */
  pct?: number;
  threshold: number;
  /** Omitted when skipped — a missing flag is not a 0% fail. */
  pass?: boolean;
  executable?: number;
  covered?: number;
  skipped?: true;
  reason?: string;
}

export interface FlagCheckResult {
  name: string;
  present: boolean;
  status: FlagStatus;
  reason?: string;
  /** Suggested GitHub check name for tested-hq/app (`tested.dev / patch / frontend`). */
  patchCheck: string;
  projectCheck: string;
  patch: FlagMetricResult;
  project: FlagMetricResult;
}

export interface EvaluateFlagsInput {
  config: TestedConfig;
  files: readonly FileCoverage[];
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>;
  /** Action `flag` / `--flag`: this coverage file is the named flag. */
  onlyFlag?: string;
}

const MATCH_OPTS = { dot: true, matchBase: true } as const;

export function pathMatchesFlag(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some(
    (p) =>
      minimatch(normalized, p, MATCH_OPTS) ||
      minimatch(normalized, `**/${p}`, MATCH_OPTS),
  );
}

export function filterFilesByFlag(
  files: readonly FileCoverage[],
  patterns: readonly string[],
): FileCoverage[] {
  return files.filter((f) => pathMatchesFlag(f.path, patterns));
}

export function configuredFlagNames(config: TestedConfig): string[] {
  return Object.keys(config.flags ?? {});
}

export function resolveFlagThresholds(
  flag: FlagConfig,
  global: NonNullable<TestedConfig['thresholds']>,
): { patch: number; project: number } {
  return {
    patch: flag.thresholds?.patch ?? global.patch,
    project: flag.thresholds?.project ?? global.project,
  };
}

export function unknownFlagError(name: string, configured: readonly string[]): Error {
  const list = configured.length > 0 ? configured.join(', ') : '(none)';
  return new Error(`unknown flag "${name}" — configured flags: ${list}`);
}

function totalsToMetric(
  totals: CoverageTotals,
  threshold: number,
  kind: 'patch' | 'project',
): FlagMetricResult {
  const empty = isEmptyPatch(totals);
  if (kind === 'patch' && empty) {
    return {
      pct: totals.pct,
      threshold,
      pass: true,
      executable: totals.executable,
      covered: totals.covered,
      skipped: true,
      reason: EMPTY_PATCH_REASON,
    };
  }
  const pass = totals.pct >= threshold;
  return {
    pct: totals.pct,
    threshold,
    pass,
    executable: totals.executable,
    covered: totals.covered,
  };
}

function missingMetric(threshold: number, reason: string): FlagMetricResult {
  return {
    threshold,
    skipped: true,
    reason,
  };
}

function checkSlug(kind: 'patch' | 'project', name: string): string {
  return `tested.dev / ${kind} / ${name}`;
}

function evaluatePresentFlag(
  name: string,
  files: readonly FileCoverage[],
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>,
  thresholds: { patch: number; project: number },
): FlagCheckResult {
  const patch = computePatchCoverage(files, addedByFile);
  const project = computeProjectCoverage(files);
  const patchMetric = totalsToMetric(patch.totals, thresholds.patch, 'patch');
  const projectMetric = totalsToMetric(project.totals, thresholds.project, 'project');
  const status: FlagStatus = patchMetric.pass && projectMetric.pass ? 'pass' : 'fail';
  return {
    name,
    present: true,
    status,
    patchCheck: checkSlug('patch', name),
    projectCheck: checkSlug('project', name),
    patch: patchMetric,
    project: projectMetric,
  };
}

function missingFlag(
  name: string,
  thresholds: { patch: number; project: number },
  reason: string,
): FlagCheckResult {
  return {
    name,
    present: false,
    status: 'missing',
    reason,
    patchCheck: checkSlug('patch', name),
    projectCheck: checkSlug('project', name),
    patch: missingMetric(thresholds.patch, reason),
    project: missingMetric(thresholds.project, reason),
  };
}

/**
 * Grade each in-scope flag from this run's coverage files.
 *
 * No `--flag`: every configured flag. Paths that do not appear are `missing`
 * (skipped — not a 0% run, never another flag's totals).
 *
 * `--flag name`: the coverage file is that flag (job already scoped). Other
 * flags are not in this run and are omitted.
 */
export function evaluateFlags(input: EvaluateFlagsInput): FlagCheckResult[] {
  const flags = input.config.flags;
  const global = input.config.thresholds;
  if (!flags || !global) return [];

  const names = Object.keys(flags);
  if (input.onlyFlag !== undefined && input.onlyFlag !== '') {
    const def = flags[input.onlyFlag];
    if (!def) throw unknownFlagError(input.onlyFlag, names);
    const thresholds = resolveFlagThresholds(def, global);
    // Scoped job: the coverage file is the flag. Path globs are not required.
    if (input.files.length === 0) {
      return [missingFlag(input.onlyFlag, thresholds, SCOPED_MISSING_FLAG_REASON)];
    }
    return [evaluatePresentFlag(input.onlyFlag, input.files, input.addedByFile, thresholds)];
  }

  const results: FlagCheckResult[] = [];
  for (const name of names) {
    const def = flags[name]!;
    const thresholds = resolveFlagThresholds(def, global);
    const matched = filterFilesByFlag(input.files, def.paths);
    if (matched.length === 0) {
      results.push(missingFlag(name, thresholds, MISSING_FLAG_REASON));
      continue;
    }
    results.push(evaluatePresentFlag(name, matched, input.addedByFile, thresholds));
  }
  return results;
}

/** Present flags must pass. Missing/skipped flags do not fail the gate. */
export function flagsPass(results: readonly FlagCheckResult[]): boolean {
  return results.every((f) => f.status !== 'fail');
}

/**
 * Check / diff `--json` map. Missing flags stay in the map as
 * `status: missing` + `skipped: true` (no executable/pct). Ingest uses
 * `flagsToIngestJson` and omits those keys.
 */
export function flagsToJson(results: readonly FlagCheckResult[]): FlagsJsonMap {
  const out: FlagsJsonMap = {};
  for (const flag of results) {
    out[flag.name] = {
      status: flag.status,
      present: flag.present,
      ...(flag.status === 'missing' ? { skipped: true as const } : {}),
      ...(flag.reason ? { reason: flag.reason } : {}),
      patchCheck: flag.patchCheck,
      projectCheck: flag.projectCheck,
      patch: metricToJson(flag.patch),
      project: metricToJson(flag.project),
    };
  }
  return out;
}

function metricToJson(metric: FlagMetricResult): FlagMetricJson {
  if (metric.skipped) {
    return {
      threshold: metric.threshold,
      skipped: true,
      ...(metric.reason ? { reason: metric.reason } : {}),
    };
  }
  return {
    pct: metric.pct ?? 0,
    threshold: metric.threshold,
    pass: metric.pass ?? false,
    executable: metric.executable ?? 0,
    covered: metric.covered ?? 0,
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

/**
 * Ingest map: omit flags that had no files this run.
 * The app treats absence as "not in this upload" and keeps last success.
 * Check/diff JSON still lists them as `status: missing` + `skipped: true`.
 */
export function flagsToIngestJson(results: readonly FlagCheckResult[]): FlagsJsonMap | undefined {
  const present = results.filter((f) => f.present);
  return present.length > 0 ? flagsToJson(present) : undefined;
}

/** Grade flags for check / diff JSON. `undefined` when none are configured. */
export function resolveFlagsJson(input: EvaluateFlagsInput): FlagsJsonMap | undefined {
  const results = evaluateFlags(input);
  return results.length > 0 ? flagsToJson(results) : undefined;
}

/** Grade flags for ingest. Missing flags are omitted (not sent as 0%). */
export function resolveIngestFlagsJson(input: EvaluateFlagsInput): FlagsJsonMap | undefined {
  return flagsToIngestJson(evaluateFlags(input));
}
