import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CoverageFormat } from './coverage.js';
import { parseCoverage } from './coverage.js';
import { assertWithinRoot } from './assert-within-root.js';
import { mergeFileCoverage } from './merge-coverage.js';
import type { FileCoverage } from './coverage-model.js';

/** Normalize `coverage.path` (string or list) to a non-empty path list. */
export function coveragePathList(path: string | readonly string[]): string[] {
  if (Array.isArray(path)) {
    return path.map((p) => p.trim()).filter((p) => p.length > 0);
  }
  const single = path.trim();
  return single ? [single] : [];
}

/**
 * Split a CLI / Action file list. Newline or comma separated.
 * Spaces alone are not separators (paths may contain spaces).
 */
export function parseCoverageFileList(raw: string | undefined | null): string[] {
  if (raw === undefined || raw === null) return [];
  return raw
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function collectCoverageFile(value: string, prev: string[]): string[] {
  const next = value.trim();
  return next ? [...prev, next] : prev;
}

export function resolveCoveragePaths(opts: {
  files?: readonly string[];
  env?: NodeJS.ProcessEnv;
  configPath: string | readonly string[];
}): string[] {
  const fromFlag = (opts.files ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  if (fromFlag.length > 0) return fromFlag;
  const fromEnv = parseCoverageFileList(opts.env?.TESTED_COVERAGE_FILES);
  if (fromEnv.length > 0) return fromEnv;
  return coveragePathList(opts.configPath);
}

export function existingCoveragePaths(
  paths: readonly string[],
  cwd: string,
  existsFn: (p: string) => boolean = existsSync,
): string[] {
  return paths.filter((rel) => {
    const abs = resolve(cwd, rel);
    return existsFn(abs);
  });
}

export async function parseAndMergeCoverage(opts: {
  paths: readonly string[];
  cwd: string;
  repoRoot: string;
  format?: CoverageFormat;
}): Promise<FileCoverage[]> {
  if (opts.paths.length === 0) {
    throw new Error(
      'coverage file missing. Run `tested run` first, or set coverage.path in .tested.yaml.',
    );
  }
  const shards: FileCoverage[][] = [];
  for (const rel of opts.paths) {
    const coveragePath = resolve(opts.cwd, rel);
    assertWithinRoot(opts.repoRoot, coveragePath);
    shards.push(
      await parseCoverage({
        path: coveragePath,
        repoRoot: opts.repoRoot,
        ...(opts.format ? { format: opts.format } : {}),
      }),
    );
  }
  return mergeFileCoverage(shards);
}
